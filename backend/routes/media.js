// Project media: drawings, bids, photos and documents that travel with the work (Estimator bid -> PM project).
// Files live on the server's own disk (FILES_DIR: point it at a Railway volume so deploys never wipe them); everything about a file is in MySQL.
// NOTHING IS EVER DELETED. A file can only be HIDDEN (and restored) by the Owner or Builder: hidden files drop into a collapsed
// "Hidden files" group below the core documents, still on disk, still on record. Nobody else can remove or replace a file.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const { requireAuth, blockUntilPasswordChanged } = require('../lib/auth');
const { lvl } = require('../lib/catalog');
const { audit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth, blockUntilPasswordChanged);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => { console.error('[media]', e); res.status(500).json({ error: 'server_error' }); });

const DIR = process.env.FILES_DIR || path.join(__dirname, '..', 'data', 'files');
const MAX_MB = Number(process.env.MEDIA_MAX_MB) || 100;
const KINDS = ['Drawings', 'Bid documents', 'Contracts', 'Photos', 'Reports', 'Other'];
const EXT_OK = new Set(['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'ppt', 'pptx', 'dwg', 'dxf', 'zip', 'eml', 'msg', 'mp4', 'mov']);
const INLINE = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const MIME = { ...INLINE, heic: 'image/heic', heif: 'image/heif', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', txt: 'text/plain', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', dwg: 'application/octet-stream', dxf: 'application/octet-stream', zip: 'application/zip', eml: 'message/rfc822', msg: 'application/octet-stream', mp4: 'video/mp4', mov: 'video/quicktime' };
const MAGIC = { pdf: b => b.slice(0, 5).toString() === '%PDF-', jpg: b => b[0] === 0xFF && b[1] === 0xD8, jpeg: b => b[0] === 0xFF && b[1] === 0xD8, png: b => b.slice(1, 4).toString() === 'PNG', gif: b => b.slice(0, 3).toString() === 'GIF' };
const isBuilder = u => u.role_key === 'builder';
const isOwnerLike = u => isBuilder(u) || u.role_key === 'owner' || (u.roles || []).includes('owner');
const extOf = n => (String(n).toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1] || '';
const cleanName = n => String(n || 'file').replace(/[\\/\0]/g, '_').replace(/[^\w.\- ()&,#+]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 180) || 'file';
const str = (v, n) => v == null ? null : String(v).slice(0, n);

const shape = (f, extra) => ({ id: Number(f.id), name: f.name, size: Number(f.size), mime: f.mime, kind: f.kind, caption: f.caption || '', ext: extOf(f.name),
  uploadedBy: f.uploaded_by_name || '', uploadedByUsername: f.uploaded_by_username || '', uploadedById: f.uploaded_by == null ? null : Number(f.uploaded_by), uploadedAt: Number(f.uploaded_at),
  hidden: !!f.hidden, hiddenBy: f.hidden_by_name || '', hiddenAt: f.hidden_at ? Number(f.hidden_at) : null, hiddenReason: f.hidden_reason || '',
  source: f.entity_type, ...(extra || {}) });

const can = (req, key, level) => lvl(req.perms && req.perms[key]) >= lvl(level);
// Who may open / add to which folder. A bid's files are the Estimator's; a project's files belong to the project pane. Bid files also
// show inside the project the bid became, for anyone who can see that project (a PM never sees the bid itself, only its documents there).
async function folderAccess(req, type, id){
  if(type === 'bid'){
    const [b] = await pool.query('SELECT id, name, project_id FROM est_bids WHERE id = ?', [id]); if(!b.length) return null;
    return { name: b[0].name, view: can(req, 'estimator.estimates', 'read') || (!!b[0].project_id && can(req, 'pm.projects', 'read')), add: can(req, 'estimator.estimates', 'write'), projectId: b[0].project_id };
  }
  if(type === 'project') return { name: '', view: can(req, 'pm.projects', 'read'), add: can(req, 'pm.projects', 'write') };
  return null;
}
const fileAccess = async (req, f) => { const a = await folderAccess(req, f.entity_type, f.entity_id); return a && a.view ? a : null; };

router.get('/', wrap(async (req, res) => {
  const type = String(req.query.type || ''), id = String(req.query.id || '').slice(0, 64);
  if(!id) return res.status(400).json({ error: 'missing_id' });
  const a = await folderAccess(req, type, id);
  if(!a) return res.status(404).json({ error: 'not_found' });
  if(!a.view) return res.status(403).json({ error: 'forbidden' });
  let rows;
  if(type === 'project'){
    [rows] = await pool.query(`SELECT m.*, b.name AS bid_name FROM media_files m LEFT JOIN est_bids b ON m.entity_type = 'bid' AND b.id = m.entity_id
      WHERE (m.entity_type = 'project' AND m.entity_id = ?) OR (m.entity_type = 'bid' AND b.project_id = ?) ORDER BY m.uploaded_at DESC`, [id, id]);
  }else [rows] = await pool.query('SELECT m.*, NULL AS bid_name FROM media_files m WHERE m.entity_type = ? AND m.entity_id = ? ORDER BY m.uploaded_at DESC', [type, id]);
  res.json({ files: rows.map(f => shape(f, { fromBid: f.entity_type === 'bid' && type === 'project' ? (f.bid_name || 'Bid') : null })), canAdd: a.add, canHide: isOwnerLike(req.user), kinds: KINDS, maxMb: MAX_MB });
}));

router.post('/', express.raw({ type: () => true, limit: MAX_MB + 'mb' }), wrap(async (req, res) => {
  const type = String(req.query.type || ''), id = String(req.query.id || '').slice(0, 64);
  const a = await folderAccess(req, type, id);
  if(!a) return res.status(404).json({ error: 'not_found' });
  if(!a.add) return res.status(403).json({ error: 'forbidden' });
  const name = cleanName(req.query.name), ext = extOf(name), body = req.body;
  if(!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'empty_file' });
  if(!EXT_OK.has(ext)) return res.status(415).json({ error: 'file_type_not_allowed', allowed: [...EXT_OK] });
  if(MAGIC[ext] && !MAGIC[ext](body)) return res.status(415).json({ error: 'file_does_not_match_its_type' });
  const kind = KINDS.includes(req.query.kind) ? req.query.kind : (/^(jpe?g|png|gif|webp|heic|heif)$/.test(ext) ? 'Photos' : 'Other');
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  const stored = Date.now().toString(36) + '-' + crypto.randomBytes(8).toString('hex') + '.' + ext;
  await fs.promises.mkdir(DIR, { recursive: true });
  await fs.promises.writeFile(path.join(DIR, stored), body, { flag: 'wx' });
  const u = req.user;
  const [r] = await pool.query('INSERT INTO media_files (entity_type, entity_id, name, stored_name, mime, size, sha256, kind, caption, uploaded_by, uploaded_by_name, uploaded_by_username, uploaded_at, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
    [type, id, name, stored, MIME[ext] || 'application/octet-stream', body.length, sha, kind, str(req.query.caption, 500), u.id, u.name, u.username || null, Date.now()]);
  const [dup] = await pool.query('SELECT id, name FROM media_files WHERE sha256 = ? AND id <> ? AND entity_type = ? AND entity_id = ? LIMIT 1', [sha, r.insertId, type, id]);
  await audit(u, 'media.upload', type, id, { fileId: r.insertId, name, size: body.length, kind }, req.ip);
  const [row] = await pool.query('SELECT m.* FROM media_files m WHERE id = ?', [r.insertId]);
  res.json({ file: shape(row[0]), duplicateOf: dup.length ? dup[0].name : null });
}));

async function load(req, res){
  const [rows] = await pool.query('SELECT * FROM media_files WHERE id = ?', [Number(req.params.id) || 0]);
  if(!rows.length){ res.status(404).json({ error: 'not_found' }); return null; }
  if(!(await fileAccess(req, rows[0]))){ res.status(403).json({ error: 'forbidden' }); return null; }
  return rows[0];
}
router.get('/storage', wrap(async (req, res) => {
  if(!isBuilder(req.user)) return res.status(403).json({ error: 'forbidden' });
  let writable = true; try{ await fs.promises.mkdir(DIR, { recursive: true }); await fs.promises.access(DIR, fs.constants.W_OK); }catch(e){ writable = false; }
  const [t] = await pool.query('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM media_files');
  res.json({ dir: DIR, writable, persistentConfigured: !!process.env.FILES_DIR, files: Number(t[0].n), bytes: Number(t[0].bytes), maxMb: MAX_MB });
}));
router.get('/:id/file', wrap(async (req, res) => {
  const f = await load(req, res); if(!f) return;
  const ext = extOf(f.name), inline = !!INLINE[ext] && !req.query.download;
  const full = path.join(DIR, path.basename(f.stored_name));
  if(!fs.existsSync(full)) return res.status(410).json({ error: 'file_missing_on_disk' });
  res.set({ 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': f.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': (inline ? 'inline' : 'attachment') + '; filename="' + encodeURIComponent(f.name) + '"' });
  await audit(req.user, 'media.view', f.entity_type, f.entity_id, { fileId: f.id, name: f.name, download: !inline }, req.ip);
  fs.createReadStream(full).pipe(res);
}));
// Note / category: the person who uploaded it, or the Owner / Builder. (Files themselves can never be replaced or removed.)
router.patch('/:id', wrap(async (req, res) => {
  const f = await load(req, res); if(!f) return;
  if(!(isOwnerLike(req.user) || Number(f.uploaded_by) === Number(req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const sets = [], vals = [];
  if(req.body.caption !== undefined){ sets.push('caption = ?'); vals.push(str(req.body.caption, 500)); }
  if(req.body.kind !== undefined && KINDS.includes(req.body.kind)){ sets.push('kind = ?'); vals.push(req.body.kind); }
  if(!sets.length) return res.json({ ok: true });
  await pool.query('UPDATE media_files SET ' + sets.join(', ') + ' WHERE id = ?', [...vals, f.id]);
  await audit(req.user, 'media.edit', f.entity_type, f.entity_id, { fileId: f.id, ...req.body }, req.ip);
  res.json({ ok: true });
}));
router.post('/:id/hide', wrap(async (req, res) => {
  if(!isOwnerLike(req.user)) return res.status(403).json({ error: 'forbidden', message: 'Only the Owner can hide a file.' });
  const f = await load(req, res); if(!f) return;
  await pool.query('UPDATE media_files SET hidden = 1, hidden_by_name = ?, hidden_at = ?, hidden_reason = ? WHERE id = ?', [req.user.name, Date.now(), str(req.body && req.body.reason, 300), f.id]);
  await audit(req.user, 'media.hide', f.entity_type, f.entity_id, { fileId: f.id, name: f.name, reason: req.body && req.body.reason }, req.ip);
  res.json({ ok: true });
}));
router.post('/:id/unhide', wrap(async (req, res) => {
  if(!isOwnerLike(req.user)) return res.status(403).json({ error: 'forbidden', message: 'Only the Owner can restore a hidden file.' });
  const f = await load(req, res); if(!f) return;
  await pool.query('UPDATE media_files SET hidden = 0, hidden_by_name = NULL, hidden_at = NULL, hidden_reason = NULL WHERE id = ?', [f.id]);
  await audit(req.user, 'media.unhide', f.entity_type, f.entity_id, { fileId: f.id, name: f.name }, req.ip);
  res.json({ ok: true });
}));
module.exports = router;
