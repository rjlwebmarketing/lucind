const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePerm, blockUntilPasswordChanged, revokeSessions } = require('../lib/auth');
const { hashPassword, randomPassword } = require('../lib/password');
const { newToken, sha256 } = require('../lib/tokens');
const { SECTIONS, PANE_KEYS, LEVELS, BUILDER_ONLY } = require('../lib/catalog');
const { audit } = require('../lib/audit');
const { sendMail, resetEmail } = require('../lib/mailer');
const { USERNAME_RE, usernameFromEmail, freeUsername } = require('../lib/schema');

const router = express.Router();
router.use(requireAuth, blockUntilPasswordChanged);
const R = requirePerm('admin.users', 'read'), W = requirePerm('admin.users', 'write');
const emailOk = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 190;
const wrap = fn => async (req, res) => { try{ await fn(req, res); }catch(e){ console.error('[admin]', e); res.status(500).json({ error: 'server_error' }); } };

async function sendInvite(u, ip, by){
  const token = newToken(), now = Date.now();
  await pool.query('INSERT INTO password_resets (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [sha256(token), u.id, 'invite', now, now + 72 * 3600 * 1000]);
  const link = (process.env.APP_URL || 'https://go.lucasindustrial.us') + '/reset?token=' + token;
  const m = resetEmail({ name: u.name, link, hours: 72, invite: true, username: u.username });
  await sendMail({ to: u.email, subject: m.subject, text: m.text, html: m.html });
  await audit(by, 'user.invite_sent', 'user', u.id, null, ip);
}
const shape = (u, ov, extra) => ({ id: Number(u.id), username: u.username || null, email: u.email, name: u.name, role: u.role_key, extraRoles: extra || [], status: u.status, mustChangePassword: !!u.must_change_password, lastLoginAt: u.last_login_at == null ? null : Number(u.last_login_at), createdAt: Number(u.created_at), overrides: ov || {} });

const anyOf = (...keys) => (req, res, next) => keys.some(k => req.perms && req.perms[k] && req.perms[k] !== 'none') ? next() : res.status(403).json({ error: 'forbidden' });
router.get('/catalog', anyOf('admin.users', 'builder.roles'), wrap(async (req, res) => {
  const [roles] = await pool.query('SELECT role_key, label, is_system FROM roles ORDER BY role_key');
  res.json({ sections: SECTIONS, levels: LEVELS, roles: roles.map(r => ({ key: r.role_key, label: r.label, system: !!r.is_system })) });
}));

// Extra roles for someone who does more than one job. Never Builder; never the same as the primary role.
async function cleanExtraRoles(list, primary){
  const want = [...new Set((Array.isArray(list) ? list : []).map(String))].filter(k => k !== primary);
  if(want.includes('builder')) return { error: 'forbidden' };
  if(!want.length) return { roles: [] };
  const [rows] = await pool.query('SELECT role_key FROM roles WHERE role_key IN (' + want.map(() => '?').join(',') + ')', want);
  if(rows.length !== want.length) return { error: 'unknown_role' };
  return { roles: want };
}
async function saveExtraRoles(userId, roles){
  await pool.query('DELETE FROM user_roles WHERE user_id = ?', [userId]);
  for(const k of roles) await pool.query('INSERT INTO user_roles (user_id, role_key) VALUES (?, ?)', [userId, k]);
}
router.get('/users', R, wrap(async (req, res) => {
  const [us] = await pool.query('SELECT * FROM users ORDER BY id');
  const [ov] = await pool.query('SELECT user_id, perm_key, level FROM user_permissions');
  const by = {}; ov.forEach(o => { (by[o.user_id] = by[o.user_id] || {})[o.perm_key] = o.level; });
  const [xr] = await pool.query('SELECT user_id, role_key FROM user_roles');
  const ex = {}; xr.forEach(x => { (ex[x.user_id] = ex[x.user_id] || []).push(x.role_key); });
  res.json({ users: us.map(u => shape(u, by[u.id], ex[u.id])) });
}));

// Create a person. mode 'invite' emails a link; mode 'temp' returns a one-time temporary password to hand over.
router.post('/users', W, wrap(async (req, res) => {
  const b = req.body || {}, email = String(b.email || '').trim().toLowerCase(), name = String(b.name || '').trim();
  if(!emailOk(email) || !name) return res.status(400).json({ error: 'name_and_valid_email_required' });
  const [role] = await pool.query('SELECT role_key FROM roles WHERE role_key = ?', [b.role]);
  if(!role.length) return res.status(400).json({ error: 'unknown_role' });
  if(b.role === 'builder' && req.user.role_key !== 'builder') return res.status(403).json({ error: 'forbidden' });
  const xr = await cleanExtraRoles(b.extraRoles, b.role); if(xr.error) return res.status(xr.error === 'forbidden' ? 403 : 400).json({ error: xr.error });
  const [dupe] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if(dupe.length) return res.status(409).json({ error: 'email_in_use' });
  let username = String(b.username || '').trim().toLowerCase();
  if(username){ if(!USERNAME_RE.test(username)) return res.status(400).json({ error: 'bad_username' }); const [d2] = await pool.query('SELECT id FROM users WHERE username = ?', [username]); if(d2.length) return res.status(409).json({ error: 'username_in_use' }); }
  else username = await freeUsername(usernameFromEmail(email));
  const temp = b.mode === 'temp' ? randomPassword() : null;
  const [ins] = await pool.query('INSERT INTO users (email, username, name, role_key, status, password_hash, must_change_password, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [email, username, name, b.role, 'active', temp ? await hashPassword(temp) : null, 1, Date.now(), req.user.id]);
  const u = { id: ins.insertId, email, username, name, role_key: b.role };
  await saveExtraRoles(u.id, xr.roles);
  await audit(req.user, 'user.create', 'user', u.id, { email, username, name, role: b.role, extraRoles: xr.roles }, req.ip);
  if(!temp) await sendInvite(u, req.ip, req.user);
  res.json({ id: Number(u.id), username, temporaryPassword: temp });
}));

router.patch('/users/:id', W, wrap(async (req, res) => {
  const id = Number(req.params.id), b = req.body || {};
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]); const u = rows[0];
  if(!u) return res.status(404).json({ error: 'not_found' });
  if(u.role_key === 'builder' && req.user.role_key !== 'builder') return res.status(403).json({ error: 'forbidden' });
  const sets = [], vals = [], changed = {};
  if(b.name !== undefined){ const n = String(b.name).trim(); if(!n) return res.status(400).json({ error: 'name_required' }); sets.push('name = ?'); vals.push(n); changed.name = n; }
  if(b.email !== undefined){
    const e = String(b.email).trim().toLowerCase(); if(!emailOk(e)) return res.status(400).json({ error: 'bad_email' });
    const [d] = await pool.query('SELECT id FROM users WHERE email = ? AND id <> ?', [e, id]); if(d.length) return res.status(409).json({ error: 'email_in_use' });
    sets.push('email = ?'); vals.push(e); changed.email = e;
  }
  if(b.username !== undefined){
    const un = String(b.username).trim().toLowerCase(); if(!USERNAME_RE.test(un)) return res.status(400).json({ error: 'bad_username' });
    const [d] = await pool.query('SELECT id FROM users WHERE username = ? AND id <> ?', [un, id]); if(d.length) return res.status(409).json({ error: 'username_in_use' });
    sets.push('username = ?'); vals.push(un); changed.username = un; changed.revokeSessions = false;
  }
  if(b.role !== undefined){
    const [r] = await pool.query('SELECT role_key FROM roles WHERE role_key = ?', [b.role]); if(!r.length) return res.status(400).json({ error: 'unknown_role' });
    if((b.role === 'builder' || u.role_key === 'builder') && req.user.role_key !== 'builder') return res.status(403).json({ error: 'forbidden' });
    if(u.role_key === 'builder' && b.role !== 'builder'){ const [c] = await pool.query("SELECT COUNT(*) AS c FROM users WHERE role_key = 'builder' AND status = 'active'"); if(Number(c[0].c) <= 1) return res.status(409).json({ error: 'last_builder' }); }
    sets.push('role_key = ?'); vals.push(b.role); changed.role = b.role;
  }
  if(b.extraRoles !== undefined){
    if(u.role_key === 'builder') return res.status(409).json({ error: 'builder_is_always_full_access' });
    const xr = await cleanExtraRoles(b.extraRoles, b.role !== undefined ? b.role : u.role_key); if(xr.error) return res.status(xr.error === 'forbidden' ? 403 : 400).json({ error: xr.error });
    await saveExtraRoles(id, xr.roles); changed.extraRoles = xr.roles; changed.rolesChanged = true;
  }
  if(!sets.length && !changed.rolesChanged){ return res.json({ ok: true }); }
  delete changed.revokeSessions;
  if(sets.length) await pool.query('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?', vals.concat([id]));
  if(changed.role || changed.rolesChanged) await revokeSessions(id);
  delete changed.rolesChanged;
  await audit(req.user, 'user.update', 'user', id, changed, req.ip);
  res.json({ ok: true });
}));

router.post('/users/:id/disable', W, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]); const u = rows[0];
  if(!u) return res.status(404).json({ error: 'not_found' });
  if(id === Number(req.user.id)) return res.status(409).json({ error: 'cannot_disable_self' });
  if(u.role_key === 'builder'){
    if(req.user.role_key !== 'builder') return res.status(403).json({ error: 'forbidden' });
    const [c] = await pool.query("SELECT COUNT(*) AS c FROM users WHERE role_key = 'builder' AND status = 'active'"); if(Number(c[0].c) <= 1) return res.status(409).json({ error: 'last_builder' });
  }
  await pool.query("UPDATE users SET status = 'disabled', disabled_at = ? WHERE id = ?", [Date.now(), id]);
  await revokeSessions(id);
  await audit(req.user, 'user.disable', 'user', id, { username: u.username, name: u.name }, req.ip);
  res.json({ ok: true });
}));

router.post('/users/:id/enable', W, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]); const u = rows[0];
  if(!u) return res.status(404).json({ error: 'not_found' });
  if(u.role_key === 'builder' && req.user.role_key !== 'builder') return res.status(403).json({ error: 'forbidden' });
  if(u.status === 'active') return res.json({ ok: true });
  await pool.query("UPDATE users SET status = 'active', disabled_at = NULL, failed_count = 0, locked_until = 0 WHERE id = ?", [id]);
  await audit(req.user, 'user.enable', 'user', id, { username: u.username }, req.ip);
  res.json({ ok: true });
}));

// Builder fallback: set a temporary password, or email a fresh link.
router.post('/users/:id/reset-password', W, wrap(async (req, res) => {
  const id = Number(req.params.id), mode = (req.body && req.body.mode) === 'email' ? 'email' : 'temp';
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]); const u = rows[0];
  if(!u) return res.status(404).json({ error: 'not_found' });
  if(u.role_key === 'builder' && req.user.role_key !== 'builder') return res.status(403).json({ error: 'forbidden' });
  if(mode === 'email'){ await sendInvite(u, req.ip, req.user); return res.json({ ok: true }); }
  const temp = randomPassword();
  await pool.query('UPDATE users SET password_hash = ?, must_change_password = 1, failed_count = 0, locked_until = 0 WHERE id = ?', [await hashPassword(temp), id]);
  await revokeSessions(id);
  await audit(req.user, 'user.temp_password', 'user', id, null, req.ip);
  res.json({ ok: true, temporaryPassword: temp });
}));

// Per-person overrides on top of the role template. body: { perms: { 'pm.dispatch': 'read', 'pm.people': null } } (null removes the override)
router.put('/users/:id/permissions', W, wrap(async (req, res) => {
  const id = Number(req.params.id), perms = (req.body && req.body.perms) || {};
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]); const u = rows[0];
  if(!u) return res.status(404).json({ error: 'not_found' });
  if(u.role_key === 'builder') return res.status(409).json({ error: 'builder_is_always_full_access' });
  for(const [k, v] of Object.entries(perms)){ if(!PANE_KEYS.includes(k) || (v !== null && !LEVELS.includes(v))) return res.status(400).json({ error: 'bad_permission', key: k }); }
  if(Object.keys(perms).some(k => BUILDER_ONLY(k) && perms[k] !== null)) return res.status(400).json({ error: 'builder_only_pane' });
  // Only a Builder may grant or change the admin panes and the sensitive panes.
  if(req.user.role_key !== 'builder' && Object.keys(perms).some(k => k.startsWith('admin.') || k.startsWith('sensitive.'))) return res.status(403).json({ error: 'forbidden' });
  for(const [k, v] of Object.entries(perms)){
    await pool.query('DELETE FROM user_permissions WHERE user_id = ? AND perm_key = ?', [id, k]);
    if(v !== null) await pool.query('INSERT INTO user_permissions (user_id, perm_key, level) VALUES (?, ?, ?)', [id, k, v]);
  }
  await audit(req.user, 'user.permissions', 'user', id, perms, req.ip);
  res.json({ ok: true });
}));

router.get('/roles', requirePerm('builder.roles', 'read'), wrap(async (req, res) => {
  const [roles] = await pool.query('SELECT * FROM roles ORDER BY role_key');
  const [rp] = await pool.query('SELECT role_key, perm_key, level FROM role_permissions');
  res.json({ roles: roles.map(r => { const p = {}; PANE_KEYS.forEach(k => { p[k] = 'none'; }); rp.filter(x => x.role_key === r.role_key).forEach(x => { p[x.perm_key] = x.level; }); return { key: r.role_key, label: r.label, system: !!r.is_system, perms: r.role_key === 'builder' ? Object.fromEntries(PANE_KEYS.map(k => [k, 'write'])) : p }; }) });
}));

// Edit a role template (Builder only). Builder's own template is fixed.
router.put('/roles/:key', requirePerm('builder.roles', 'write'), wrap(async (req, res) => {
  if(req.user.role_key !== 'builder') return res.status(403).json({ error: 'forbidden' });
  const key = req.params.key, perms = (req.body && req.body.perms) || {};
  const [r] = await pool.query('SELECT * FROM roles WHERE role_key = ?', [key]);
  if(!r.length) return res.status(404).json({ error: 'not_found' });
  if(key === 'builder') return res.status(409).json({ error: 'builder_template_is_fixed' });
  for(const [k, v] of Object.entries(perms)) if(!PANE_KEYS.includes(k) || !LEVELS.includes(v)) return res.status(400).json({ error: 'bad_permission', key: k });
  if(Object.keys(perms).some(BUILDER_ONLY)) return res.status(400).json({ error: 'builder_only_pane' });
  for(const [k, v] of Object.entries(perms)){
    await pool.query('DELETE FROM role_permissions WHERE role_key = ? AND perm_key = ?', [key, k]);
    await pool.query('INSERT INTO role_permissions (role_key, perm_key, level) VALUES (?, ?, ?)', [key, k, v]);
  }
  await audit(req.user, 'role.update', 'role', key, perms, req.ip);
  res.json({ ok: true });
}));

// Builder-only health page: yes/no and names only. Never returns a secret value.
router.get('/system', requirePerm('builder.settings', 'read'), wrap(async (req, res) => {
  let db = false; try{ await pool.query('SELECT 1'); db = true; }catch(e){}
  const [uc] = await pool.query("SELECT status, COUNT(*) n FROM users GROUP BY status");
  const env = process.env, has = k => !!(env[k] && String(env[k]).length);
  res.json({
    node: process.version, uptimeSeconds: Math.round(process.uptime()), time: Date.now(),
    database: { ok: db },
    mail: { provider: env.MAIL_PROVIDER || 'console', from: env.MAIL_FROM || null, keySet: has('RESEND_API_KEY'), live: (env.MAIL_PROVIDER || '') === 'resend' && has('RESEND_API_KEY') },
    ai: { keySet: has('ANTHROPIC_API_KEY') },
    google: { oauthConfigured: has('GOOGLE_OAUTH_CLIENT_ID') && has('GOOGLE_OAUTH_CLIENT_SECRET'), driveKeySet: has('DRIVE_TOKEN_KEY'), publicBackendUrl: env.PUBLIC_BACKEND_URL || null },
    app: { appUrl: env.APP_URL || 'https://go.lucasindustrial.us', allowedOrigins: env.ALLOWED_ORIGINS || null },
    users: Object.fromEntries(uc.map(r => [r.status, Number(r.n)]))
  });
}));

router.get('/audit', requirePerm('admin.audit', 'read'), wrap(async (req, res) => {
  const q = req.query || {}, where = [], vals = [];
  if(q.user) { where.push('user_id = ?'); vals.push(Number(q.user)); }
  if(q.action) { where.push('action LIKE ?'); vals.push(String(q.action).replace(/[%_]/g, '') + '%'); }
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
  const [rows] = await pool.query('SELECT * FROM audit_log' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC LIMIT ' + limit, vals);
  res.json({ entries: rows.map(r => ({ id: Number(r.id), at: Number(r.at), userId: r.user_id == null ? null : Number(r.user_id), name: r.user_name, username: r.user_username, email: r.user_email, action: r.action, entityType: r.entity_type, entityId: r.entity_id, detail: r.detail ? (() => { try{ return JSON.parse(r.detail); }catch(e){ return r.detail; } })() : null, ip: r.ip })) });
}));
module.exports = router;
