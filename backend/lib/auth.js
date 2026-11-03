const pool = require('../config/db');
const { sha256, newToken } = require('./tokens');
const { lvl, expand, PANE_KEYS } = require('./catalog');

const IDLE_MS = 8 * 3600 * 1000;          // signed out after 8 hours of no use
const MAX_MS = 7 * 24 * 3600 * 1000;      // and never kept longer than 7 days in total

async function createSession(userId, ip, ua){
  const token = newToken(), now = Date.now();
  await pool.query('INSERT INTO sessions (token_hash, user_id, created_at, last_seen, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [sha256(token), userId, now, now, now + IDLE_MS, ip || null, ua ? String(ua).slice(0, 250) : null]);
  return token;
}
async function revokeSessions(userId, exceptHash){
  if(exceptHash) await pool.query('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [userId, exceptHash]);
  else await pool.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
}
// Effective permissions: the role's template, with any per-person overrides on top. Builder is always full write.
async function effectivePerms(user){
  if(user.role_key === 'builder'){ const all = {}; PANE_KEYS.forEach(k => { all[k] = 'write'; }); return all; }
  const out = {}; PANE_KEYS.forEach(k => { out[k] = 'none'; });
  const [tpl] = await pool.query('SELECT perm_key, level FROM role_permissions WHERE role_key = ?', [user.role_key]);
  tpl.forEach(r => { if(r.perm_key in out) out[r.perm_key] = r.level; });
  const [ov] = await pool.query('SELECT perm_key, level FROM user_permissions WHERE user_id = ?', [user.id]);
  ov.forEach(r => { if(r.perm_key in out) out[r.perm_key] = r.level; });
  return out;
}
const publicUser = u => ({ id: Number(u.id), username: u.username || null, email: u.email, name: u.name, role: u.role_key, seat: u.seat_id == null ? null : Number(u.seat_id), mustChangePassword: !!u.must_change_password });

// Express middleware: who is calling? Sets req.user, req.perms, req.sessionHash.
async function requireAuth(req, res, next){
  try{
    const h = String(req.headers.authorization || '');
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if(!token) return res.status(401).json({ error: 'not_signed_in' });
    const th = sha256(token), now = Date.now();
    const [rows] = await pool.query('SELECT s.token_hash, s.created_at, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', [th]);
    const r = rows[0];
    if(!r || Number(r.expires_at) < now || now - Number(r.created_at) > MAX_MS){ if(r) await pool.query('DELETE FROM sessions WHERE token_hash = ?', [th]); return res.status(401).json({ error: 'session_expired' }); }
    if(r.status !== 'active') return res.status(401).json({ error: 'account_disabled' });
    await pool.query('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?', [now, now + IDLE_MS, th]);
    req.user = r; req.sessionHash = th; req.perms = await effectivePerms(r);
    return next();
  }catch(e){ console.error('[auth]', e); return res.status(500).json({ error: 'server_error' }); }
}
// Every API route that touches a section checks it here, on the server (hiding a menu item is not security).
const requirePerm = (key, level) => (req, res, next) => {
  if(!req.perms || lvl(req.perms[key]) < lvl(level)) return res.status(403).json({ error: 'forbidden', need: key + ':' + level });
  return next();
};
// A person who still has a temporary password may only change it.
const blockUntilPasswordChanged = (req, res, next) => (req.user && req.user.must_change_password) ? res.status(403).json({ error: 'password_change_required' }) : next();
module.exports = { createSession, revokeSessions, effectivePerms, publicUser, requireAuth, requirePerm, blockUntilPasswordChanged, IDLE_MS };
