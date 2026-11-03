const express = require('express');
const pool = require('../config/db');
const { hashPassword, verifyPassword, burnTime, passwordProblem } = require('../lib/password');
const { newToken, sha256 } = require('../lib/tokens');
const { createSession, revokeSessions, effectivePerms, publicUser, requireAuth } = require('../lib/auth');
const { MENU, SECTIONS, lvl } = require('../lib/catalog');
const { limiter } = require('../lib/throttle');
const { audit } = require('../lib/audit');
const { sendMail, resetEmail } = require('../lib/mailer');

const router = express.Router();
const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000, RESET_HOURS = 1;
const emailOf = v => String(v || '').trim().toLowerCase();
// Sign in (or ask for a reset) with a username or an email address.
const findUser = async id => { const k = emailOf(id); const [rows] = await pool.query(k.includes('@') ? 'SELECT * FROM users WHERE email = ?' : 'SELECT * FROM users WHERE username = ?', [k]); return rows[0]; };

// The global menu: top-level items, each with the panes this person may open (the server still checks every call).
function menuFor(perms){
  return MENU.map(m => ({ key: m.key, label: m.label, sections: SECTIONS.filter(s => s.menu === m.key)
      .map(s => ({ key: s.key, label: s.label, panes: s.panes.filter(p => lvl(perms[p.key]) >= 1).map(p => ({ key: p.key, label: p.label, level: perms[p.key] })) }))
      
      .filter(s => s.panes.length) }))
    // The Admin menu belongs to people who hold an admin pane; a lone sensitive-data grant (e.g. PM reading contract values) does not open it.
    .filter(m => m.sections.length && (m.key !== 'admin' || m.sections.some(s => s.key === 'admin')));
}

router.post('/login', limiter('login', 30, 15 * 60 * 1000), async (req, res) => {
  try{
    const email = emailOf(req.body && (req.body.login || req.body.email)), pw = String((req.body && req.body.password) || '');
    const u = await findUser(email), now = Date.now();
    if(!u || !u.password_hash){ await burnTime(); await audit(null, 'login.fail', 'user', null, { email }, req.ip); return res.status(401).json({ error: 'bad_credentials' }); }
    if(Number(u.locked_until) > now) return res.status(429).json({ error: 'locked', retryAfterSec: Math.ceil((Number(u.locked_until) - now) / 1000) });
    const ok = await verifyPassword(pw, u.password_hash);
    if(!ok){
      const f = Number(u.failed_count) + 1;
      if(f >= MAX_FAILS){ await pool.query('UPDATE users SET failed_count = 0, locked_until = ? WHERE id = ?', [now + LOCK_MS, u.id]); await audit(u, 'login.locked', 'user', u.id, null, req.ip); }
      else await pool.query('UPDATE users SET failed_count = ? WHERE id = ?', [f, u.id]);
      await audit(u, 'login.fail', 'user', u.id, null, req.ip);
      return res.status(401).json({ error: 'bad_credentials' });
    }
    if(u.status !== 'active') return res.status(403).json({ error: 'account_disabled' });
    await pool.query('UPDATE users SET failed_count = 0, locked_until = 0, last_login_at = ? WHERE id = ?', [now, u.id]);
    const token = await createSession(u.id, req.ip, req.headers['user-agent'], !!(req.body && req.body.remember));
    await audit(u, 'login.ok', 'user', u.id, null, req.ip);
    res.json({ token, user: publicUser(u) });
  }catch(e){ console.error('[login]', e); res.status(500).json({ error: 'server_error' }); }
});

router.post('/logout', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM sessions WHERE token_hash = ?', [req.sessionHash]);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: publicUser(req.user), permissions: req.perms, menu: menuFor(req.perms) });
});

// Always answers the same way, whether or not the address has an account.
router.post('/forgot', limiter('forgot', 10, 60 * 60 * 1000), async (req, res) => {
  const generic = { ok: true, message: 'If that address has an account, a reset link is on its way.' };
  try{
    const u = await findUser(req.body && (req.body.login || req.body.email));
    if(u && u.status === 'active'){
      const token = newToken(), now = Date.now();
      await pool.query('INSERT INTO password_resets (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [sha256(token), u.id, 'reset', now, now + RESET_HOURS * 3600 * 1000]);
      const link = (process.env.APP_URL || 'https://go.lucasindustrial.us') + '/#/reset?token=' + token;
      const m = resetEmail({ name: u.name, link, hours: RESET_HOURS, invite: false, username: u.username });
      await sendMail({ to: u.email, subject: m.subject, text: m.text, html: m.html });
      await audit(u, 'password.reset_requested', 'user', u.id, null, req.ip);
    }
  }catch(e){ console.error('[forgot]', e.message); }
  res.json(generic);
});

router.post('/reset', limiter('reset', 20, 60 * 60 * 1000), async (req, res) => {
  try{
    const token = String((req.body && req.body.token) || ''), pw = String((req.body && req.body.password) || '');
    const [rows] = await pool.query('SELECT * FROM password_resets WHERE token_hash = ?', [sha256(token)]);
    const r = rows[0], now = Date.now();
    if(!r || r.used_at || Number(r.expires_at) < now) return res.status(400).json({ error: 'link_invalid_or_expired' });
    const [us] = await pool.query('SELECT * FROM users WHERE id = ?', [r.user_id]);
    const u = us[0];
    if(!u || u.status !== 'active') return res.status(400).json({ error: 'link_invalid_or_expired' });
    const problem = passwordProblem(pw, u.email);
    if(problem) return res.status(400).json({ error: 'weak_password', message: problem });
    await pool.query('UPDATE users SET password_hash = ?, must_change_password = 0, failed_count = 0, locked_until = 0 WHERE id = ?', [await hashPassword(pw), u.id]);
    await pool.query('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', [now, r.token_hash]);
    await revokeSessions(u.id);
    await audit(u, 'password.reset_done', 'user', u.id, null, req.ip);
    res.json({ ok: true });
  }catch(e){ console.error('[reset]', e); res.status(500).json({ error: 'server_error' }); }
});

router.post('/change-password', requireAuth, limiter('chpw', 20, 60 * 60 * 1000), async (req, res) => {
  try{
    const cur = String((req.body && req.body.current) || ''), pw = String((req.body && req.body.password) || '');
    if(!(await verifyPassword(cur, req.user.password_hash))) return res.status(400).json({ error: 'wrong_current_password' });
    const problem = passwordProblem(pw, req.user.email);
    if(problem) return res.status(400).json({ error: 'weak_password', message: problem });
    await pool.query('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [await hashPassword(pw), req.user.id]);
    await revokeSessions(req.user.id, req.sessionHash);
    await audit(req.user, 'password.changed', 'user', req.user.id, null, req.ip);
    res.json({ ok: true });
  }catch(e){ console.error('[chpw]', e); res.status(500).json({ error: 'server_error' }); }
});
module.exports = router;
