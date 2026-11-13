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
const cs = require('../lib/chunkstore');
const { shareState } = require('../lib/sharing');

const router = express.Router();
// Opening/downloading uses a short-lived link so big PDFs stream straight from disk (with range requests) instead of through the page's memory.
router.get('/dl/:token', async (req, res) => {
  const l = LINKS.get(req.params.token);
  if(!l || l.exp < Date.now()) return res.status(410).send('This link has expired. Go back and open the file again.');
  const [rows] = await pool.query('SELECT * FROM media_files WHERE id = ?', [l.fileId]).catch(() => [[]]);
  if(!rows.length) return res.status(404).send('Not found');
  const f = rows[0], ext = extOf(f.name), full = path.join(DIR, path.basename(f.stored_name));
  if(!fs.existsSync(full)) return res.status(410).send('File is missing on disk');
  const inline = !!INLINE[ext] && !req.query.download;
  res.sendFile(full, { headers: { 'Content-Type': MIME[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Disposition': (inline ? 'inline' : 'attachment') + '; filename="' + encodeURIComponent(f.name) + '"' }, dotfiles: 'allow' });
});
router.use(requireAuth, blockUntilPasswordChanged);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => { console.error('[media]', e); res.status(500).json({ error: 'server_error' }); });

const DIR = process.env.FILES_DIR || path.join(__dirname, '..', 'data', 'files');
const MAX_MB = Number(process.env.MEDIA_MAX_MB) || 5120;   // per file; drawing sets run 200-300 MB
const CHUNK = 8 * 1024 * 1024;
const LINKS = new Map();   // short-lived download links: token -> { fileId, userId, exp }
const KINDS = ['Drawings', 'Bid documents', 'Contracts', 'Photos', 'Reports', 'Other'];
// Material we deliver while a sub does the work: the driver's bill of lading and the delivery photos belong to the job.
const PROJECT_KINDS = ['Drawings', 'Bid documents', 'Contracts', 'Bill of Lading', 'Delivery Photos', 'Photos', 'Reports', 'Other'];
// A crew member's / subcontractor's own folder (certificates of insurance, licenses, W-9s). These documents are replaced over time, so the old ones stay on record (hidden, never deleted).
const PERSON_KINDS = ['Certificate of Insurance (COI)', 'Business License', 'W-9', 'Other'];
const ALL_KINDS = PROJECT_KINDS.concat(PERSON_KINDS.filter(k => !PROJECT_KINDS.includes(k)));
const kindsFor = type => type === 'person' ? PERSON_KINDS : type === 'project' ? PROJECT_KINDS : KINDS;
const EXT_OK = new Set(['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'ppt', 'pptx', 'dwg', 'dxf', 'zip', 'eml', 'msg', 'mp4', 'mov']);
const INLINE = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const MIME = { ...INLINE, heic: 'image/heic', heif: 'image/heif', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', txt: 'text/plain', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', dwg: 'application/octet-stream', dxf: 'application/octet-stream', zip: 'application/zip', eml: 'message/rfc822', msg: 'application/octet-stream', mp4: 'video/mp4', mov: 'video/quicktime' };
const MAGIC = { pdf: b => b.slice(0, 5).toString() === '%PDF-', jpg: b => b[0] === 0xFF && b[1] === 0xD8, jpeg: b => b[0] === 0xFF && b[1] === 0xD8, png: b => b.slice(1, 4).toString() === 'PNG', gif: b => b.slice(0, 3).toString() === 'GIF' };
const isBuilder = u => u.role_key === 'builder';
const isOwnerLike = u => isBuilder(u) || u.role_key === 'owner' || (u.roles || []).includes('owner');
// Who may hide/restore/edit a file: the Owner and Builder anywhere; for a person's own folder (insurance, license, W-9) also the PM, since those documents get replaced regularly. Nothing is ever deleted: every hide/restore is recorded with who and why.
const canManage = (req, f) => isOwnerLike(req.user) || (f && f.entity_type === 'person' && can(req, 'pm.people', 'write'));
const extOf = n => (String(n).toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1] || '';
const cleanName = n => String(n || 'file').replace(/[\\/\0]/g, '_').replace(/[^\w.\- ()&,#+]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 180) || 'file';
const str = (v, n) => v == null ? null : String(v).slice(0, n);

const shape = (f, extra) => ({ id: Number(f.id), name: f.name, size: Number(f.size), mime: f.mime, kind: f.kind, caption: f.caption || '', ext: extOf(f.name),
  uploadedBy: f.uploaded_by_name || '', uploadedByUsername: f.uploaded_by_username || '', uploadedById: f.uploaded_by == null ? null : Number(f.uploaded_by), uploadedAt: Number(f.uploaded_at),
  hidden: !!f.hidden, hiddenBy: f.hidden_by_name || '', hiddenAt: f.hidden_at ? Number(f.hidden_at) : null, hiddenReason: f.hidden_reason || '',
  source: f.entity_type, share: shareState(f), shareRule: f.share_ok == null ? 'default' : (Number(f.share_ok) === 1 ? 'allow' : 'block'), ...(extra || {}) });

// A clone ("Rev 2") sees its ancestors' documents without copying them: one file on disk, one record, listed in both places. Never the other way round,
// so what is added to a revision never appears on the original submission. A project sees the documents of the bid it came from AND that bid's ancestors.
async function ancestorsOf(id){
  const out = []; let cur = Number(id);
  for(let i = 0; i < 25 && cur; i++){
    const [r] = await pool.query('SELECT cloned_parent FROM est_bids WHERE id = ?', [cur]);
    cur = r.length && r[0].cloned_parent ? Number(r[0].cloned_parent) : 0;
    if(cur && !out.includes(cur)) out.push(cur); else break;
  }
  return out;
}
async function descendantsOf(id){
  let level = [Number(id)]; const out = [];
  for(let i = 0; i < 25 && level.length; i++){
    const [r] = await pool.query('SELECT id FROM est_bids WHERE cloned_parent IN (' + level.map(() => '?').join(',') + ')', level);
    level = r.map(x => Number(x.id)).filter(x => !out.includes(x)); out.push(...level);
  }
  return out;
}
const can = (req, key, level) => lvl(req.perms && req.perms[key]) >= lvl(level);
// Who may open / add to which folder. A bid's files are the Estimator's; a project's files belong to the project pane. Bid files also
// show inside the project the bid became, for anyone who can see that project (a PM never sees the bid itself, only its documents there).
async function folderAccess(req, type, id){
  if(type === 'bid'){
    const [b] = await pool.query('SELECT id, name, project_id FROM est_bids WHERE id = ?', [id]); if(!b.length) return null;
    let viaProject = !!b[0].project_id;
    if(!viaProject && can(req, 'pm.projects', 'read')){   // an earlier revision's files are visible to the PM of the project a later revision became
      const d = await descendantsOf(id);
      if(d.length){ const [p] = await pool.query('SELECT id FROM est_bids WHERE project_id IS NOT NULL AND id IN (' + d.map(() => '?').join(',') + ') LIMIT 1', d); viaProject = p.length > 0; }
    }
    return { name: b[0].name, view: can(req, 'estimator.estimates', 'read') || (viaProject && can(req, 'pm.projects', 'read')), add: can(req, 'estimator.estimates', 'write'), projectId: b[0].project_id };
  }
  if(type === 'project') return { name: '', view: can(req, 'pm.projects', 'read'), add: can(req, 'pm.projects', 'write') };
  if(type === 'person') return /^[\w.\-:]{1,64}$/.test(String(id)) ? { name: '', view: can(req, 'pm.people', 'read'), add: can(req, 'pm.people', 'write') } : null;   // the PM, Owner and Builder keep these documents
  return null;
}
const fileAccess = async (req, f) => {
  const a = await folderAccess(req, f.entity_type, f.entity_id); if(a && a.view) return a;
  if(f.entity_type === 'project' && can(req, 'estimator.estimates', 'read')){   // the Estimator may open the contract they added, and nothing else in the project
    const [c] = await pool.query('SELECT 1 FROM est_contracts WHERE file_id = ? LIMIT 1', [Number(f.id)]); if(c.length) return { name: '', view: true, add: false };
  }
  return null;
};

router.get('/', wrap(async (req, res) => {
  const type = String(req.query.type || ''), id = String(req.query.id || '').slice(0, 64);
  if(!id) return res.status(400).json({ error: 'missing_id' });
  const a = await folderAccess(req, type, id);
  if(!a) return res.status(404).json({ error: 'not_found' });
  if(!a.view) return res.status(403).json({ error: 'forbidden' });
  let rows;
  if(type === 'project'){
    const [mine] = await pool.query('SELECT id FROM est_bids WHERE project_id = ?', [id]);
    let bidIds = mine.map(x => Number(x.id)); for(const b of [...bidIds]) for(const x of await ancestorsOf(b)) if(!bidIds.includes(x)) bidIds.push(x);
    [rows] = await pool.query(`SELECT m.*, b.name AS bid_name, b.project_code AS bid_code FROM media_files m LEFT JOIN est_bids b ON m.entity_type = 'bid' AND b.id = m.entity_id
      WHERE (m.entity_type = 'project' AND m.entity_id = ?)` + (bidIds.length ? ` OR (m.entity_type = 'bid' AND m.entity_id IN (${bidIds.map(() => '?').join(',')}))` : '') + ' ORDER BY m.uploaded_at DESC, m.id DESC', [id, ...bidIds]);
  }else if(type === 'bid'){
    const ids = [Number(id), ...(await ancestorsOf(id))];
    [rows] = await pool.query(`SELECT m.*, b.name AS bid_name, b.project_code AS bid_code FROM media_files m LEFT JOIN est_bids b ON b.id = m.entity_id WHERE m.entity_type = 'bid' AND m.entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY m.uploaded_at DESC, m.id DESC`, ids);
  }else [rows] = await pool.query('SELECT m.*, NULL AS bid_name, NULL AS bid_code FROM media_files m WHERE m.entity_type = ? AND m.entity_id = ? ORDER BY m.uploaded_at DESC, m.id DESC', [type, id]);
  res.json({ files: rows.map(f => shape(f, { fromBid: f.entity_type === 'bid' && (type === 'project' || String(f.entity_id) !== String(id)) ? (f.bid_name || 'Bid') : null, fromCode: f.entity_type === 'bid' && String(f.entity_id) !== String(id) ? (f.bid_code || '') : '' })), canAdd: a.add, canHide: isOwnerLike(req.user) || (type === 'person' && can(req, 'pm.people', 'write')), canShare: type === 'project' && can(req, 'pm.projects', 'write'), kinds: kindsFor(type), maxMb: MAX_MB });
}));

router.post('/', express.raw({ type: () => true, limit: '25mb' }), wrap(async (req, res) => {
  const type = String(req.query.type || ''), id = String(req.query.id || '').slice(0, 64);
  const a = await folderAccess(req, type, id);
  if(!a) return res.status(404).json({ error: 'not_found' });
  if(!a.add) return res.status(403).json({ error: 'forbidden' });
  const name = cleanName(req.query.name), ext = extOf(name), body = req.body;
  if(!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'empty_file' });
  if(!EXT_OK.has(ext)) return res.status(415).json({ error: 'file_type_not_allowed', allowed: [...EXT_OK] });
  if(MAGIC[ext] && !MAGIC[ext](body)) return res.status(415).json({ error: 'file_does_not_match_its_type' });
  const kind = ALL_KINDS.includes(req.query.kind) ? req.query.kind : (/^(jpe?g|png|gif|webp|heic|heif)$/.test(ext) ? 'Photos' : 'Other');
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
// ---- Large files: start -> send 8 MB pieces in order (resumable) -> finish ----
router.post('/upload', wrap(async (req, res) => {
  const b = req.body || {}, type = String(b.type || ''), id = String(b.id || '').slice(0, 64);
  const a = await folderAccess(req, type, id);
  if(!a) return res.status(404).json({ error: 'not_found' });
  if(!a.add) return res.status(403).json({ error: 'forbidden' });
  const name = cleanName(b.name), ext = extOf(name), size = Number(b.size);
  if(!EXT_OK.has(ext)) return res.status(415).json({ error: 'file_type_not_allowed', allowed: [...EXT_OK] });
  if(!(size > 0)) return res.status(400).json({ error: 'empty_file' });
  if(size > MAX_MB * 1048576) return res.status(413).json({ error: 'too_large', maxMb: MAX_MB });
  const uid = crypto.randomBytes(12).toString('hex');
  await cs.begin(DIR, uid);
  await pool.query('INSERT INTO media_uploads (id, user_id, entity_type, entity_id, name, kind, caption, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [uid, req.user.id, type, id, name, ALL_KINDS.includes(b.kind) ? b.kind : null, str(b.caption, 500), size, Date.now()]);
  res.json({ uploadId: uid, chunk: CHUNK, received: 0 });
}));
async function mine(req, res){
  const [r] = await pool.query('SELECT * FROM media_uploads WHERE id = ?', [String(req.params.uid).replace(/[^\w]/g, '')]);
  if(!r.length || Number(r[0].user_id) !== Number(req.user.id)){ res.status(404).json({ error: 'unknown_upload' }); return null; }
  return r[0];
}
router.get('/upload/:uid', wrap(async (req, res) => { const u = await mine(req, res); if(!u) return; res.json({ received: Math.max(0, await cs.received(DIR, u.id)), size: Number(u.size), chunk: CHUNK }); }));
router.put('/upload/:uid', express.raw({ type: () => true, limit: '16mb' }), wrap(async (req, res) => {
  const u = await mine(req, res); if(!u) return;
  const buf = req.body; if(!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'empty_chunk' });
  const r = await cs.append(DIR, u.id, Number(req.query.offset) || 0, buf);
  if(!r.ok) return res.status(r.error === 'wrong_offset' ? 409 : 404).json(r);
  if(r.received > Number(u.size)){ await cs.abort(DIR, u.id); return res.status(400).json({ error: 'more_data_than_declared' }); }
  res.json({ received: r.received });
}));
router.post('/upload/:uid/finish', wrap(async (req, res) => {
  const u = await mine(req, res); if(!u) return;
  const got = await cs.received(DIR, u.id);
  if(got !== Number(u.size)) return res.status(409).json({ error: 'incomplete', received: got, size: Number(u.size) });
  const ext = extOf(u.name);
  if(MAGIC[ext] && !MAGIC[ext](await cs.head(DIR, u.id, 16))){ await cs.abort(DIR, u.id); await pool.query('DELETE FROM media_uploads WHERE id = ?', [u.id]); return res.status(415).json({ error: 'file_does_not_match_its_type' }); }
  const stored = Date.now().toString(36) + '-' + crypto.randomBytes(8).toString('hex') + '.' + ext;
  const { sha, size } = await cs.finish(DIR, u.id, stored);
  const kind = u.kind || (/^(jpe?g|png|gif|webp|heic|heif)$/.test(ext) ? 'Photos' : 'Other'), usr = req.user;
  const [r] = await pool.query('INSERT INTO media_files (entity_type, entity_id, name, stored_name, mime, size, sha256, kind, caption, uploaded_by, uploaded_by_name, uploaded_by_username, uploaded_at, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
    [u.entity_type, u.entity_id, u.name, stored, MIME[ext] || 'application/octet-stream', size, sha, kind, u.caption, usr.id, usr.name, usr.username || null, Date.now()]);
  await pool.query('DELETE FROM media_uploads WHERE id = ?', [u.id]);
  const [dup] = await pool.query('SELECT id, name FROM media_files WHERE sha256 = ? AND id <> ? AND entity_type = ? AND entity_id = ? LIMIT 1', [sha, r.insertId, u.entity_type, u.entity_id]);
  await audit(usr, 'media.upload', u.entity_type, u.entity_id, { fileId: r.insertId, name: u.name, size, kind }, req.ip);
  const [row] = await pool.query('SELECT m.* FROM media_files m WHERE id = ?', [r.insertId]);
  res.json({ file: shape(row[0]), duplicateOf: dup.length ? dup[0].name : null });
}));
// ---- The GC contract: the Estimator receives it from the customer and owns the upload and its details (Mike). It can arrive before or after
// hand-off. After hand-off the Estimator has NO general access to the project's files; this narrow door lets them add the contract, open that one
// file, and keep its details (received date, retention, ...) up to date. The PM is not notified; the file shows in the project's Files and the
// PM's Money screen offers the details. Every upload and every edit is kept in est_contract_history.
const DETAIL_KEYS = ['receivedOn', 'contractDate', 'retentionPct', 'contractNumber', 'contractAmount', 'paymentTerms'];
const dOk = v => v == null || v === '' || /^\d{4}-\d\d-\d\d$/.test(v);
const numOrNull = v => v === '' || v == null ? null : Number(v);
const cShape = r => r ? { fileId: Number(r.file_id), receivedOn: r.received_on || '', contractDate: r.contract_date || '', retentionPct: r.retention_pct == null ? '' : Number(r.retention_pct), contractNumber: r.contract_number || '', contractAmount: r.contract_amount == null ? '' : Number(r.contract_amount), paymentTerms: r.payment_terms || '',
  aiFields: r.ai_fields ? r.ai_fields.split(',').filter(Boolean) : [], addedBy: r.created_by_name || '', addedAt: Number(r.created_at), updatedBy: r.updated_by_name || '', updatedAt: Number(r.updated_at) } : null;
const COLS = { receivedOn: 'received_on', contractDate: 'contract_date', retentionPct: 'retention_pct', contractNumber: 'contract_number', contractAmount: 'contract_amount', paymentTerms: 'payment_terms' };
async function contractBid(req, res){
  const id = Number(req.query.bidId || (req.body && req.body.bidId)) || 0;
  const [b] = await pool.query('SELECT id, name, project_id, status, archived FROM est_bids WHERE id = ?', [id]);
  if(!b.length){ res.status(404).json({ error: 'not_found' }); return null; }
  if(!can(req, 'estimator.estimates', 'read')){ res.status(403).json({ error: 'forbidden' }); return null; }
  return b[0];
}
const contractRow = async projectId => { const [r] = await pool.query('SELECT c.*, m.name AS file_name FROM est_contracts c LEFT JOIN media_files m ON m.id = c.file_id WHERE c.project_id = ?', [String(projectId)]); return r[0] || null; };
const cHist = (projectId, u, action, changes) => pool.query('INSERT INTO est_contract_history (project_id, at, user_id, user_name, action, changes) VALUES (?, ?, ?, ?, ?, ?)', [String(projectId), Date.now(), u.id, u.name, action, JSON.stringify(changes || {})]);
router.get('/contract', wrap(async (req, res) => {
  const b = await contractBid(req, res); if(!b) return;
  if(!b.project_id) return res.json({ handedOff: false });
  const r = await contractRow(b.project_id);
  if(!r) return res.json({ handedOff: true, onFile: null, canUpload: can(req, 'estimator.estimates', 'write') });
  const [h] = await pool.query('SELECT at, user_name, action, changes FROM est_contract_history WHERE project_id = ? ORDER BY at DESC, id DESC LIMIT 100', [String(b.project_id)]);
  res.json({ handedOff: true, canEdit: can(req, 'estimator.estimates', 'write'), onFile: { name: r.file_name || 'Contract', ...cShape(r) },
    history: h.map(x => { let c = {}; try{ c = JSON.parse(x.changes || '{}'); }catch(e){} return { at: Number(x.at), by: x.user_name || '', action: x.action, changes: c }; }) });
}));
// the Project Manager's Money screen reads the details (never the history) to offer them next to its own retention fields
router.get('/contract-info', wrap(async (req, res) => {
  if(!can(req, 'pm.projects', 'read')) return res.status(403).json({ error: 'forbidden' });
  const r = await contractRow(String(req.query.projectId || '').slice(0, 64));
  res.json({ contract: r ? { name: r.file_name || 'Contract', ...cShape(r) } : null });
}));
router.post('/contract', express.raw({ type: () => true, limit: '25mb' }), wrap(async (req, res) => {
  const b = await contractBid(req, res); if(!b) return;
  if(!can(req, 'estimator.estimates', 'write')) return res.status(403).json({ error: 'forbidden' });
  if(!b.project_id) return res.status(409).json({ error: 'not_handed_off' });
  if(await contractRow(b.project_id)) return res.status(409).json({ error: 'contract_on_file' });
  const name = cleanName(req.query.name), ext = extOf(name), body = req.body;
  if(!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'empty_file' });
  if(!EXT_OK.has(ext)) return res.status(415).json({ error: 'file_type_not_allowed', allowed: [...EXT_OK] });
  if(MAGIC[ext] && !MAGIC[ext](body)) return res.status(415).json({ error: 'file_does_not_match_its_type' });
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  const stored = Date.now().toString(36) + '-' + crypto.randomBytes(8).toString('hex') + '.' + ext;
  await fs.promises.mkdir(DIR, { recursive: true });
  await fs.promises.writeFile(path.join(DIR, stored), body, { flag: 'wx' });
  const u = req.user, pid = String(b.project_id), now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  const [r] = await pool.query('INSERT INTO media_files (entity_type, entity_id, name, stored_name, mime, size, sha256, kind, caption, uploaded_by, uploaded_by_name, uploaded_by_username, uploaded_at, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
    ['project', pid, name, stored, MIME[ext] || 'application/octet-stream', body.length, sha, 'Contracts', 'GC contract (added by the Estimator)', u.id, u.name, u.username || null, now]);
  await pool.query('INSERT INTO est_contracts (project_id, bid_id, file_id, received_on, created_by, created_by_name, created_at, updated_by, updated_by_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [pid, b.id, r.insertId, day, u.id, u.name, now, u.id, u.name, now]);
  await cHist(pid, u, 'upload', { file: name, receivedOn: day });
  await audit(u, 'media.contract_upload', 'project', pid, { fileId: r.insertId, name, size: body.length, bidId: b.id }, req.ip);   // no notify(): the PM is not told
  res.json({ ok: true });
}));
// Details: received date defaults to the upload day; everything is editable. Each save keeps who/when and the before -> after of every field.
router.put('/contract/details', express.json({ limit: '20kb' }), wrap(async (req, res) => {
  const b = await contractBid(req, res); if(!b) return;
  if(!can(req, 'estimator.estimates', 'write')) return res.status(403).json({ error: 'forbidden' });
  const cur = b.project_id ? await contractRow(b.project_id) : null; if(!cur) return res.status(409).json({ error: 'no_contract' });
  const inp = req.body || {}, want = {};
  for(const k of DETAIL_KEYS) if(k in inp) want[k] = inp[k];
  if(!dOk(want.receivedOn) || !dOk(want.contractDate)) return res.status(400).json({ error: 'bad_date' });
  if('retentionPct' in want){ const n = numOrNull(want.retentionPct); if(n != null && !(n >= 0 && n <= 100)) return res.status(400).json({ error: 'bad_retention' }); want.retentionPct = n; }
  if('contractAmount' in want){ const n = numOrNull(want.contractAmount); if(n != null && !(n >= 0 && n < 1e12)) return res.status(400).json({ error: 'bad_amount' }); want.contractAmount = n; }
  for(const k of ['contractNumber', 'paymentTerms']) if(k in want) want[k] = String(want[k] || '').trim().slice(0, k === 'paymentTerms' ? 300 : 120) || null;
  for(const k of ['receivedOn', 'contractDate']) if(k in want) want[k] = want[k] || null;
  const before = cShape(cur), changes = {}, sets = [], vals = [];
  for(const k of Object.keys(want)){
    const was = before[k] === '' ? null : before[k], now = want[k] === '' ? null : want[k];
    if(String(was == null ? '' : was) === String(now == null ? '' : now)) continue;
    changes[k] = { from: was, to: now }; sets.push(COLS[k] + ' = ?'); vals.push(now);
  }
  // fields the Estimator AI suggested and the person accepted unchanged stay marked "AI"; editing one removes the mark
  const aiIn = Array.isArray(inp.ai) ? inp.ai.filter(k => DETAIL_KEYS.includes(k)) : [], aiKeep = new Set(before.aiFields.filter(k => !(k in changes)));
  aiIn.forEach(k => aiKeep.add(k));
  const aiStr = [...aiKeep].join(',') || null;
  if(!sets.length && aiStr === (cur.ai_fields || null)) return res.json({ ok: true, changed: 0 });
  const u = req.user;
  await pool.query('UPDATE est_contracts SET ' + sets.concat(['ai_fields = ?', 'updated_by = ?', 'updated_by_name = ?', 'updated_at = ?']).join(', ') + ' WHERE project_id = ?', vals.concat([aiStr, u.id, u.name, Date.now(), String(b.project_id)]));
  if(Object.keys(changes).length){ await cHist(b.project_id, u, aiIn.length ? 'ai_fill' : 'edit', { ...changes, ...(aiIn.length ? { aiFilled: aiIn } : {}) }); await audit(u, 'media.contract_edit', 'project', String(b.project_id), { fields: Object.keys(changes) }, req.ip); }
  res.json({ ok: true, changed: Object.keys(changes).length });
}));
// Estimator AI: reads the contract (PDF or picture) and SUGGESTS the details. Nothing is saved until the person looks them over and saves.
router.post('/contract/autofill', express.json({ limit: '10kb' }), wrap(async (req, res) => {
  const b = await contractBid(req, res); if(!b) return;
  if(!can(req, 'estimator.estimates', 'write')) return res.status(403).json({ error: 'forbidden' });
  const cur = b.project_id ? await contractRow(b.project_id) : null; if(!cur) return res.status(409).json({ error: 'no_contract' });
  const key = process.env.ANTHROPIC_API_KEY; if(!key) return res.status(503).json({ error: 'ai_not_configured' });
  const [fr] = await pool.query('SELECT name, stored_name, size FROM media_files WHERE id = ?', [cur.file_id]); if(!fr.length) return res.status(404).json({ error: 'not_found' });
  const ext = extOf(fr[0].name), kind = ext === 'pdf' ? 'document' : /^(jpe?g|png|gif|webp)$/.test(ext) ? 'image' : null;
  if(!kind) return res.status(415).json({ error: 'ai_needs_pdf_or_picture' });
  if(Number(fr[0].size) > 18 * 1048576) return res.status(413).json({ error: 'file_too_big_for_ai' });
  const data = (await fs.promises.readFile(path.join(DIR, path.basename(fr[0].stored_name)))).toString('base64');
  const media_type = ext === 'pdf' ? 'application/pdf' : MIME[ext];
  const model = process.env.AI_CONTRACT_MODEL || (process.env.AI_ALLOWED_MODELS || 'claude-sonnet-4-6').split(',')[0].trim();
  const prompt = 'This is a construction subcontract between a general contractor and Lucas Industrial. Read it and reply with ONLY a JSON object with these keys (use null when the document does not say): contractDate (YYYY-MM-DD, the date of the agreement), retentionPct (number, percent withheld from each payment), contractNumber (the GC\'s subcontract / PO number, text), contractAmount (number, the total subcontract price in dollars), paymentTerms (short text, e.g. "Net 45 after GC is paid"). Do not guess; null is better than a wrong value.';
  let out;
  try{
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: 'user', content: [{ type: kind, source: { type: 'base64', media_type, data } }, { type: 'text', text: prompt }] }] }) });
    const j = await r.json(); if(!r.ok) throw new Error((j.error && j.error.message) || 'ai_failed');
    const txt = (j.content || []).map(c => c.text || '').join(''), m = /\{[\s\S]*\}/.exec(txt); out = m ? JSON.parse(m[0]) : {};
  }catch(e){ console.error('contract autofill failed', e.message); return res.status(502).json({ error: 'ai_failed' }); }
  const sug = {};
  if(typeof out.contractDate === 'string' && dOk(out.contractDate) && out.contractDate) sug.contractDate = out.contractDate;
  const rp = Number(out.retentionPct); if(out.retentionPct != null && rp >= 0 && rp <= 100) sug.retentionPct = rp;
  if(out.contractNumber) sug.contractNumber = String(out.contractNumber).slice(0, 120);
  const am = Number(out.contractAmount); if(out.contractAmount != null && am >= 0 && am < 1e12) sug.contractAmount = am;
  if(out.paymentTerms) sug.paymentTerms = String(out.paymentTerms).slice(0, 300);
  await audit(req.user, 'media.contract_autofill', 'project', String(b.project_id), { fields: Object.keys(sug) }, req.ip);
  res.json({ suggestions: sug });
}));

router.post('/:id/link', wrap(async (req, res) => {
  const f = await load(req, res); if(!f) return;
  const token = crypto.randomBytes(24).toString('hex'); LINKS.set(token, { fileId: f.id, userId: req.user.id, exp: Date.now() + 10 * 60 * 1000 });
  for(const [k, v] of LINKS) if(v.exp < Date.now()) LINKS.delete(k);
  await audit(req.user, 'media.view', f.entity_type, f.entity_id, { fileId: f.id, name: f.name, download: !!(req.body && req.body.download) }, req.ip);
  res.json({ url: '/api/media/dl/' + token });
}));
setTimeout(() => cs.sweep(DIR, 3 * 24 * 3600 * 1000).catch(() => {}), 60 * 1000).unref();

router.get('/storage', wrap(async (req, res) => {
  if(!isBuilder(req.user)) return res.status(403).json({ error: 'forbidden' });
  let writable = true; try{ await fs.promises.mkdir(DIR, { recursive: true }); await fs.promises.access(DIR, fs.constants.W_OK); }catch(e){ writable = false; }
  const [t] = await pool.query('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM media_files');
  let freeBytes = null; try{ const st = await fs.promises.statfs(DIR); freeBytes = Number(st.bavail) * Number(st.bsize); }catch(e){}
  res.json({ freeBytes, dir: DIR, writable, persistentConfigured: !!process.env.FILES_DIR, files: Number(t[0].n), bytes: Number(t[0].bytes), maxMb: MAX_MB });
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
  if(!(canManage(req, f) || Number(f.uploaded_by) === Number(req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const sets = [], vals = [];
  if(req.body.caption !== undefined){ sets.push('caption = ?'); vals.push(str(req.body.caption, 500)); }
  if(req.body.kind !== undefined && ALL_KINDS.includes(req.body.kind)){ sets.push('kind = ?'); vals.push(req.body.kind); }
  if(!sets.length) return res.json({ ok: true });
  await pool.query('UPDATE media_files SET ' + sets.join(', ') + ' WHERE id = ?', [...vals, f.id]);
  await audit(req.user, 'media.edit', f.entity_type, f.entity_id, { fileId: f.id, ...req.body }, req.ip);
  res.json({ ok: true });
}));
router.post('/:id/hide', wrap(async (req, res) => {
  const f = await load(req, res); if(!f) return;
  if(!canManage(req, f)) return res.status(403).json({ error: 'forbidden', message: 'Only the Owner can hide a file.' });
  await pool.query('UPDATE media_files SET hidden = 1, hidden_by_name = ?, hidden_at = ?, hidden_reason = ? WHERE id = ?', [req.user.name, Date.now(), str(req.body && req.body.reason, 300), f.id]);
  await audit(req.user, 'media.hide', f.entity_type, f.entity_id, { fileId: f.id, name: f.name, reason: req.body && req.body.reason }, req.ip);
  res.json({ ok: true });
}));
router.post('/:id/unhide', wrap(async (req, res) => {
  const f = await load(req, res); if(!f) return;
  if(!canManage(req, f)) return res.status(403).json({ error: 'forbidden', message: 'Only the Owner can restore a hidden file.' });
  await pool.query('UPDATE media_files SET hidden = 0, hidden_by_name = NULL, hidden_at = NULL, hidden_reason = NULL WHERE id = ?', [f.id]);
  await audit(req.user, 'media.unhide', f.entity_type, f.entity_id, { fileId: f.id, name: f.name }, req.ip);
  res.json({ ok: true });
}));
// Owner/Builder decide, file by file, what may be shared outside: allow (even a contract), block, or back to the default rule.
router.post('/:id/share-rule', wrap(async (req, res) => {
  if(!isOwnerLike(req.user)) return res.status(403).json({ error: 'forbidden', message: 'Only the Owner can change what may be shared outside.' });
  const f = await load(req, res); if(!f) return;
  const rule = String(req.body && req.body.rule || ''); if(!['allow', 'block', 'default'].includes(rule)) return res.status(400).json({ error: 'bad_rule' });
  await pool.query('UPDATE media_files SET share_ok = ? WHERE id = ?', [rule === 'allow' ? 1 : rule === 'block' ? 0 : null, f.id]);
  await audit(req.user, 'media.share_rule', f.entity_type, f.entity_id, { fileId: f.id, name: f.name, rule }, req.ip);
  res.json({ ok: true });
}));
module.exports = router;
