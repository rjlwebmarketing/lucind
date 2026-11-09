// Share links: a PM (or Owner) sends a project file to someone outside the company without Google Drive.
//   Authenticated API  : /api/shares   (create, list, open-log, revoke)
//   Public pages       : /s/:token     (what the outside person opens; no sign-in)
// The link's secret is shown once and only its hash is stored, so a lost link is replaced, never recovered. Every open is logged.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const { requireAuth, requirePerm, blockUntilPasswordChanged } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { shareState } = require('../lib/sharing');
const { render } = require('../lib/sharepage');
const { hashPassword, verifyPassword } = require('../lib/password');
const { sha256, newToken } = require('../lib/tokens');
const { limiter, hit } = require('../lib/throttle');

const DIR = process.env.FILES_DIR || path.join(__dirname, '..', 'data', 'files');
const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };   // only these open in the browser; everything else downloads
const extOf = n => (String(n).toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1] || '';
const isOwnerLike = u => u.role_key === 'builder' || u.role_key === 'owner' || (u.roles || []).includes('owner');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => { console.error('[shares]', e); res.status(500).json({ error: 'server_error' }); });
const str = (v, n) => v == null ? '' : String(v).slice(0, n);
const base = req => (process.env.PUBLIC_API_URL || (req.protocol + '://' + req.get('host'))).replace(/\/$/, '');

// ---------- authenticated API ----------
const api = express.Router();
api.use(requireAuth, blockUntilPasswordChanged, requirePerm('pm.projects', 'write'));

api.post('/', wrap(async (req, res) => {
  const b = req.body || {}, projectId = str(b.projectId, 64), ids = [...new Set((Array.isArray(b.fileIds) ? b.fileIds : []).map(Number).filter(Boolean))];
  if(!projectId || !ids.length || ids.length > 20) return res.status(400).json({ error: 'bad_request', message: 'Pick one to twenty files.' });
  const [rows] = await pool.query('SELECT * FROM media_files WHERE id IN (' + ids.map(() => '?').join(',') + ')', ids);
  if(rows.length !== ids.length) return res.status(404).json({ error: 'not_found' });
  for(const f of rows){
    if(String(f.entity_id) !== projectId) return res.status(400).json({ error: 'wrong_project', message: 'Those files are not all from this project.' });
    const st = shareState(f); if(!st.ok) return res.status(403).json({ error: 'not_shareable', file: f.name, message: f.name + ': ' + st.reason });
  }
  const days = Math.min(30, Math.max(1, Math.round(Number(b.days) || 7))), now = Date.now(), pass = str(b.passcode, 80);
  if(pass && pass.length < 4) return res.status(400).json({ error: 'weak_passcode', message: 'A passcode needs at least 4 characters.' });
  const token = newToken(), ph = pass ? await hashPassword(pass) : null;
  const [r] = await pool.query('INSERT INTO media_shares (token_hash, project_id, file_ids, recipient, note, allow_download, passcode_hash, created_at, expires_at, created_by, created_by_name, created_by_username) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [sha256(token), projectId, JSON.stringify(ids), str(b.recipient, 120) || null, str(b.note, 1000) || null, b.allowDownload === false ? 0 : 1, ph, now, now + days * 86400000, req.user.id, req.user.name, req.user.username || null]);
  await audit(req.user, 'share.create', 'project', projectId, { shareId: Number(r.insertId), files: rows.map(f => f.name), days, passcode: !!pass, recipient: str(b.recipient, 120) }, req.ip);
  res.json({ id: Number(r.insertId), url: base(req) + '/s/' + token, expiresAt: now + days * 86400000 });
}));

api.get('/', wrap(async (req, res) => {
  const pid = str(req.query.projectId, 64); if(!pid) return res.status(400).json({ error: 'missing_id' });
  const all = isOwnerLike(req.user);
  const [rows] = await pool.query('SELECT s.*, (SELECT COUNT(*) FROM media_share_log l WHERE l.share_id = s.id AND l.action IN (\'open\',\'view\',\'download\')) AS opens, (SELECT MAX(at) FROM media_share_log l WHERE l.share_id = s.id AND l.action IN (\'open\',\'view\',\'download\')) AS last_at FROM media_shares s WHERE s.project_id = ?' + (all ? '' : ' AND s.created_by = ?') + ' ORDER BY s.id DESC LIMIT 100', all ? [pid] : [pid, req.user.id]);
  const ids = [...new Set(rows.flatMap(s => { try{ return JSON.parse(s.file_ids); }catch(e){ return []; } }))];
  const names = {}; if(ids.length){ const [f] = await pool.query('SELECT id, name FROM media_files WHERE id IN (' + ids.map(() => '?').join(',') + ')', ids); f.forEach(x => { names[x.id] = x.name; }); }
  const now = Date.now();
  res.json({ shares: rows.map(s => ({ id: Number(s.id), recipient: s.recipient || '', note: s.note || '', files: (() => { try{ return JSON.parse(s.file_ids).map(i => names[i] || 'file'); }catch(e){ return []; } })(), allowDownload: !!Number(s.allow_download), passcode: !!s.passcode_hash,
    createdAt: Number(s.created_at), expiresAt: Number(s.expires_at), by: s.created_by_name || '', status: s.revoked_at ? 'revoked' : Number(s.expires_at) < now ? 'expired' : 'active', opens: Number(s.opens), lastOpenAt: s.last_at ? Number(s.last_at) : null })) });
}));
async function mine(req, res){
  const [r] = await pool.query('SELECT * FROM media_shares WHERE id = ?', [Number(req.params.id) || 0]);
  if(!r.length){ res.status(404).json({ error: 'not_found' }); return null; }
  if(!isOwnerLike(req.user) && Number(r[0].created_by) !== Number(req.user.id)){ res.status(403).json({ error: 'forbidden' }); return null; }
  return r[0];
}
api.get('/:id/log', wrap(async (req, res) => {
  const s = await mine(req, res); if(!s) return;
  const [l] = await pool.query('SELECT at, action, ip, file_name FROM media_share_log WHERE share_id = ? ORDER BY id DESC LIMIT 200', [s.id]);
  res.json({ log: l.map(x => ({ at: Number(x.at), action: x.action, ip: x.ip || '', file: x.file_name || '' })) });
}));
api.post('/:id/revoke', wrap(async (req, res) => {
  const s = await mine(req, res); if(!s) return;
  await pool.query('UPDATE media_shares SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL', [Date.now(), req.user.name, s.id]);
  await audit(req.user, 'share.revoke', 'project', s.project_id, { shareId: Number(s.id) }, req.ip);
  res.json({ ok: true });
}));

// ---------- public pages ----------
const pub = express.Router();
pub.use((req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }); next(); });
const page = (res, status, o) => { res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" }).send(render(o)); };
const sign = (s, fileId, exp) => crypto.createHmac('sha256', s.token_hash).update(fileId + '.' + exp).digest('hex');
async function find(token){
  const [r] = await pool.query('SELECT * FROM media_shares WHERE token_hash = ?', [sha256(String(token || '').slice(0, 200))]);
  if(!r.length) return null; const s = r[0];
  return (s.revoked_at || Number(s.expires_at) < Date.now()) ? null : s;
}
async function filesOf(s){
  let ids = []; try{ ids = JSON.parse(s.file_ids); }catch(e){}
  if(!ids.length) return [];
  const [rows] = await pool.query('SELECT * FROM media_files WHERE id IN (' + ids.map(() => '?').join(',') + ')', ids);
  return rows.filter(f => shareState(f).ok);   // a file hidden or blocked after the link was made stops being offered
}
const log = (s, action, req, file) => pool.query('INSERT INTO media_share_log (share_id, at, action, ip, ua, file_name) VALUES (?, ?, ?, ?, ?, ?)', [s.id, Date.now(), action, str(req.ip, 64), str(req.get('user-agent'), 200), file ? str(file, 200) : null]).catch(e => console.error('[shares] log', e.message));
async function showFiles(req, res, s, token){
  const files = await filesOf(s); if(!files.length) return page(res, 410, { state: 'gone' });
  const exp = Date.now() + 15 * 60 * 1000, b = base(req) + '/s/' + token + '/f/';
  await log(s, 'open', req);
  page(res, 200, { state: 'files', from: s.created_by_name, recipient: s.recipient, note: s.note, expiresAt: Number(s.expires_at), allowDownload: !!Number(s.allow_download),
    files: files.map(f => { const q = '?exp=' + exp + '&k=' + sign(s, f.id, exp); return { name: f.name, size: Number(f.size), viewUrl: b + f.id + q, downloadUrl: b + f.id + q + '&download=1' }; }) });
}
pub.get('/:token', wrap(async (req, res) => {
  const s = await find(req.params.token); if(!s) return page(res, 410, { state: 'gone' });
  if(s.passcode_hash){ const n = (await filesOf(s)).length; return page(res, 200, { state: 'passcode', from: s.created_by_name, count: n || 1, action: '/s/' + req.params.token }); }
  await showFiles(req, res, s, req.params.token);
}));
pub.post('/:token', express.urlencoded({ extended: false, limit: '4kb' }), wrap(async (req, res) => {
  const s = await find(req.params.token); if(!s) return page(res, 410, { state: 'gone' });
  if(!s.passcode_hash) return res.redirect(303, '/s/' + req.params.token);
  const n = (await filesOf(s)).length || 1, again = error => page(res, 200, { state: 'passcode', from: s.created_by_name, count: n, action: '/s/' + req.params.token, error });
  if(hit('sharepw:' + s.id, 8, 15 * 60 * 1000)) return again('Too many attempts. Please wait a few minutes and try again.');
  if(!(await verifyPassword(String(req.body.passcode || ''), s.passcode_hash))){ await log(s, 'passcode_fail', req); return again('That passcode is not right.'); }
  await showFiles(req, res, s, req.params.token);
}));
pub.get('/:token/f/:id', limiter('sharefile', 120, 10 * 60 * 1000), wrap(async (req, res) => {
  const s = await find(req.params.token); if(!s) return page(res, 410, { state: 'gone' });
  const id = Number(req.params.id) || 0, exp = Number(req.query.exp) || 0, k = String(req.query.k || '');
  const want = sign(s, id, exp);
  if(exp < Date.now() || k.length !== want.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(want))) return res.redirect(303, '/s/' + req.params.token);   // stale: back to the page for fresh links
  const f = (await filesOf(s)).find(x => Number(x.id) === id); if(!f) return page(res, 410, { state: 'gone' });
  const ext = extOf(f.name), dl = !!req.query.download;
  if(dl && !Number(s.allow_download)) return res.status(403).send('Downloads are turned off for this link.');
  const inline = !!MIME[ext] && !dl, full = path.join(DIR, path.basename(f.stored_name));
  if(!fs.existsSync(full)) return res.status(410).send('This file is temporarily unavailable.');
  await log(s, dl ? 'download' : 'view', req, f.name);
  res.sendFile(full, { headers: { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Disposition': (inline ? 'inline' : 'attachment') + '; filename*=UTF-8\'\'' + encodeURIComponent(f.name), 'Content-Security-Policy': "default-src 'none'; sandbox" } });
}));

module.exports = { api, pub };
