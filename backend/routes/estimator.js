// Estimator: bids, each estimator's monthly quota, and the read-only views the estimator needs of the PM board
// (active jobs for the map/calendar, crew & subs). Nothing is ever deleted: a bid is archived, and every change is kept with the person who made it.
const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePerm, blockUntilPasswordChanged } = require('../lib/auth');
const { audit } = require('../lib/audit');
const handoff = require('../lib/handoff');
const codes = require('../lib/codes');
const tasksLib = require('../lib/tasks');
const { notify } = require('../lib/notify');
const estAi = require('../lib/estimatorAi');

const router = express.Router();
router.use(requireAuth, blockUntilPasswordChanged);
const R = requirePerm('estimator.estimates', 'read'), W = requirePerm('estimator.estimates', 'write');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => { console.error('[estimator]', e); res.status(500).json({ error: 'server_error' }); });

const STATUSES = ['Draft', 'Bidding', 'Won', 'Lost', 'No Bid'];
const SUBMITTED = ['Bidding', 'Won', 'Lost'];          // counts toward "bid this month"
const DEFAULT_QUOTA = { bidTarget: 2200000, convTarget: 12 };
const today = () => new Date().toISOString().slice(0, 10);
const dateOk = v => v == null || v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const str = (v, n) => v == null ? null : String(v).slice(0, n);

const shape = b => ({ id: Number(b.id), name: b.name, storeNumber: b.store_number || '', customer: b.customer || '', address: b.address || '', city: b.city || '', state: b.state || '',
  lat: b.lat == null ? null : Number(b.lat), lon: b.lon == null ? null : Number(b.lon), amount: Number(b.amount), status: b.status,
  ownerId: b.owner_id == null ? null : Number(b.owner_id), ownerName: b.owner_name || '', ownerUsername: b.owner_username || '',
  bidDue: b.bid_due || '', bidSubmitted: b.bid_submitted || '', decidedOn: b.decided_on || '', startDate: b.start_date || '', endDate: b.end_date || '',
  notes: b.notes || '', projectId: b.project_id || null, code: b.project_code || '', clonedFrom: b.cloned_from == null ? null : Number(b.cloned_from), archived: !!b.archived, deleted: !!b.deleted_at, deletedAt: b.deleted_at ? Number(b.deleted_at) : null, createdAt: Number(b.created_at), updatedAt: Number(b.updated_at) });

// field name in the API -> column, with a cleaner for each
const FIELDS = {
  name: ['name', v => str(v, 200)], storeNumber: ['store_number', v => str(v, 40)], customer: ['customer', v => str(v, 200)], address: ['address', v => str(v, 255)],
  city: ['city', v => str(v, 100)], state: ['state', v => str(v, 40)], lat: ['lat', num], lon: ['lon', num], amount: ['amount', v => Math.max(0, num(v) || 0)],
  bidDue: ['bid_due', v => v || null], bidSubmitted: ['bid_submitted', v => v || null], decidedOn: ['decided_on', v => v || null],
  startDate: ['start_date', v => v || null], endDate: ['end_date', v => v || null], notes: ['notes', v => str(v, 20000)]
};
const DATE_KEYS = ['bidDue', 'bidSubmitted', 'decidedOn', 'startDate', 'endDate'];

async function history(bidId, user, action, changes){
  await pool.query('INSERT INTO est_bid_history (bid_id, at, user_id, user_name, user_username, action, changes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [bidId, Date.now(), user.id, user.name, user.username || null, action, changes ? JSON.stringify(changes) : null]);
}
// Status moves fill in the dates that go with them, so quota and conversion stay honest without extra typing.
function statusDates(next, status){
  if(SUBMITTED.includes(status) && !next.bid_submitted) next.bid_submitted = today();
  if((status === 'Won' || status === 'Lost') && !next.decided_on) next.decided_on = today();
  if(status === 'Draft' || status === 'Bidding'){ if(status === 'Draft') next.bid_submitted = null; next.decided_on = null; }
}

// A bid (Draft or Bidding) whose work was supposed to start is treated as Lost (it stays on record and can be cloned; nothing is deleted). Its documents carry into any clone without being copied (see routes/media.js).
// Runs whenever the list is read; the bid keeps its dates and the change is written to its history as "auto_lost".
async function autoLose(){
  const [rows] = await pool.query("SELECT id, status, start_date FROM est_bids WHERE status IN ('Draft', 'Bidding') AND archived = 0 AND start_date IS NOT NULL AND start_date <> '' AND start_date <= ?", [today()]);
  for(const b of rows){
    const [u] = await pool.query("UPDATE est_bids SET status = 'Lost', decided_on = ?, updated_at = ? WHERE id = ? AND status = ?", [b.start_date, Date.now(), b.id, b.status]);
    if(u.affectedRows){ await history(b.id, { id: null, name: 'System', username: null }, 'auto_lost', { status: { from: b.status, to: 'Lost' }, reason: 'project start date ' + b.start_date + ' arrived' }); await audit(null, 'bid.auto_lost', 'bid', b.id, { startDate: b.start_date }, null); }
  }
}

router.get('/bids', R, wrap(async (req, res) => {
  await autoLose();
  const [rows] = await pool.query('SELECT * FROM est_bids' + (req.query.archived === '1' ? '' : ' WHERE archived = 0') + ' ORDER BY id DESC');   // deleted bids are archived too, so they show only under Archived (flagged "deleted")
  // Won + handed off but no GC contract on file yet -> awaitingContract (drives the "Awaiting Contract" bubble and the Add Contract button)
  const have = new Set((await pool.query('SELECT project_id FROM est_contracts'))[0].map(x => String(x.project_id)));
  res.json({ statuses: STATUSES, bids: rows.map(r => Object.assign(shape(r), { awaitingContract: r.status === 'Won' && !!r.project_id && !have.has(String(r.project_id)) })) });
}));

router.post('/bids', W, wrap(async (req, res) => {
  const b = req.body || {};
  if(!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'name_required' });
  if(DATE_KEYS.some(k => !dateOk(b[k]))) return res.status(400).json({ error: 'bad_date' });
  const status = b.status == null ? 'Draft' : b.status;
  if(!STATUSES.includes(status)) return res.status(400).json({ error: 'bad_status' });
  const row = {}; for(const [k, [col, clean]] of Object.entries(FIELDS)) if(b[k] !== undefined) row[col] = clean(b[k]);
  row.name = str(String(b.name).trim(), 200); row.status = status;
  statusDates(row, status);
  let owner = req.user;
  if(b.ownerId && Number(b.ownerId) !== Number(req.user.id)){
    if(!(req.perms['admin.users'] && req.perms['admin.users'] !== 'none')) return res.status(403).json({ error: 'forbidden' });
    const [o] = await pool.query('SELECT id, name, username FROM users WHERE id = ?', [Number(b.ownerId)]);
    if(!o.length) return res.status(400).json({ error: 'bad_owner' });
    owner = o[0];
  }
  row.owner_id = owner.id; row.owner_name = owner.name; row.owner_username = owner.username || null;
  row.created_at = row.updated_at = Date.now();
  row.project_code = (await codes.nextCodes(1))[0];   // the company-wide project number, from the first moment the bid exists
  const cols = Object.keys(row);
  const [ins] = await pool.query('INSERT INTO est_bids (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')', cols.map(c => row[c]));
  await history(ins.insertId, req.user, 'create', { name: row.name, amount: row.amount || 0, status });
  await audit(req.user, 'bid.create', 'bid', ins.insertId, { name: row.name }, req.ip);
  const [r] = await pool.query('SELECT * FROM est_bids WHERE id = ?', [ins.insertId]);
  res.json({ bid: shape(r[0]) });
}));

router.patch('/bids/:id', W, wrap(async (req, res) => {
  const [r] = await pool.query('SELECT * FROM est_bids WHERE id = ?', [Number(req.params.id)]);
  if(!r.length) return res.status(404).json({ error: 'not_found' });
  const cur = r[0], b = req.body || {};
  if(DATE_KEYS.some(k => !dateOk(b[k]))) return res.status(400).json({ error: 'bad_date' });
  if(b.status !== undefined && !STATUSES.includes(b.status)) return res.status(400).json({ error: 'bad_status' });
  if(b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: 'name_required' });
  const next = {}, changes = {};
  for(const [k, [col, clean]] of Object.entries(FIELDS)){
    if(b[k] === undefined) continue;
    const v = clean(b[k]);
    if(String(v == null ? '' : v) !== String(cur[col] == null ? '' : cur[col])){ next[col] = v; changes[k] = { from: cur[col] == null ? null : cur[col], to: v }; }
  }
  if(b.status !== undefined && b.status !== cur.status){ next.status = b.status; changes.status = { from: cur.status, to: b.status }; const merged = Object.assign({ bid_submitted: cur.bid_submitted, decided_on: cur.decided_on }, next); statusDates(merged, b.status);
    for(const c of ['bid_submitted', 'decided_on']) if(merged[c] !== cur[c]){ next[c] = merged[c]; } }
  if(!Object.keys(next).length) return res.json({ bid: shape(cur), unchanged: true });
  next.updated_at = Date.now();
  const cols = Object.keys(next);
  await pool.query('UPDATE est_bids SET ' + cols.map(c => c + ' = ?').join(', ') + ' WHERE id = ?', cols.map(c => next[c]).concat([cur.id]));
  await history(cur.id, req.user, 'update', changes);
  await audit(req.user, 'bid.update', 'bid', cur.id, changes, req.ip);
  const [n] = await pool.query('SELECT * FROM est_bids WHERE id = ?', [cur.id]);
  res.json({ bid: shape(n[0]) });
}));

for(const [verb, flag] of [['archive', 1], ['unarchive', 0]]){
  router.post('/bids/:id/' + verb, W, wrap(async (req, res) => {
    const [r] = await pool.query('SELECT id FROM est_bids WHERE id = ?', [Number(req.params.id)]);
    if(!r.length) return res.status(404).json({ error: 'not_found' });
    await pool.query('UPDATE est_bids SET archived = ?, updated_at = ? WHERE id = ?', [flag, Date.now(), r[0].id]);
    await history(r[0].id, req.user, verb, null); await audit(req.user, 'bid.' + verb, 'bid', r[0].id, null, req.ip);
    res.json({ ok: true });
  }));
}

// Delete / undo delete (Owner and Builder). A "delete" hides the bid everywhere (lists, search, numbers, analytics) with a short Undo on screen. The record itself is kept
// (deleted_at + history + audit), so nothing is ever truly lost. A bid that was handed off to the PM cannot be deleted (a project depends on it).
const DEL = requirePerm('admin.users', 'write');
router.post('/bids/delete', DEL, wrap(async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(Number).filter(n => n > 0))].slice(0, 500);
  if(!ids.length) return res.status(400).json({ error: 'no_bids' });
  const [rows] = await pool.query('SELECT id, name, project_id, deleted_at FROM est_bids WHERE id IN (' + ids.map(() => '?').join(',') + ')', ids);
  const deleted = [], blocked = [], now = Date.now();
  for(const b of rows){
    if(b.deleted_at) continue;
    if(b.project_id){ blocked.push({ id: Number(b.id), name: b.name, why: 'handed off to the Project Manager' }); continue; }
    await pool.query('UPDATE est_bids SET archived = 1, deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, b.id]);
    await history(b.id, req.user, 'deleted', { name: b.name }); deleted.push(Number(b.id));
  }
  if(deleted.length) await audit(req.user, 'bid.delete', 'bid', deleted.join(','), { count: deleted.length }, req.ip);
  res.json({ ok: true, deleted, blocked });
}));
router.post('/bids/undelete', DEL, wrap(async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(Number).filter(n => n > 0))].slice(0, 500);
  if(!ids.length) return res.status(400).json({ error: 'no_bids' });
  const [rows] = await pool.query('SELECT id FROM est_bids WHERE deleted_at IS NOT NULL AND id IN (' + ids.map(() => '?').join(',') + ')', ids); const back = [], now = Date.now();
  for(const b of rows){ await pool.query('UPDATE est_bids SET archived = 0, deleted_at = NULL, updated_at = ? WHERE id = ?', [now, b.id]); await history(b.id, req.user, 'undeleted', null); back.push(Number(b.id)); }
  if(back.length) await audit(req.user, 'bid.undelete', 'bid', back.join(','), { count: back.length }, req.ip);
  res.json({ ok: true, restored: back });
}));

router.get('/bids/:id/history', R, wrap(async (req, res) => {
  const [h] = await pool.query('SELECT * FROM est_bid_history WHERE bid_id = ? ORDER BY id DESC', [Number(req.params.id)]);
  res.json({ history: h.map(x => ({ at: Number(x.at), name: x.user_name, username: x.user_username, action: x.action, changes: x.changes ? JSON.parse(x.changes) : null })) });
}));

// ---- quota -----------------------------------------------------------------
async function quotaFor(userId){
  const [q] = await pool.query('SELECT * FROM est_quotas WHERE user_id = ?', [userId]);
  const bidTarget = q.length ? Number(q[0].bid_target) : DEFAULT_QUOTA.bidTarget, convTarget = q.length ? Number(q[0].conv_target) : DEFAULT_QUOTA.convTarget;
  const now = new Date(), month = now.toISOString().slice(0, 7);
  const since = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
  const [mine] = await pool.query('SELECT status, amount, bid_submitted, decided_on FROM est_bids WHERE owner_id = ? AND archived = 0', [userId]);
  let bidThisMonth = 0, bidCount = 0, wonAmt = 0, lostAmt = 0, won = 0, lost = 0;
  for(const b of mine){
    const amt = Number(b.amount);
    if(SUBMITTED.includes(b.status) && b.bid_submitted && b.bid_submitted.slice(0, 7) === month){ bidThisMonth += amt; bidCount++; }
    if(b.decided_on && b.decided_on >= since){ if(b.status === 'Won'){ wonAmt += amt; won++; } if(b.status === 'Lost'){ lostAmt += amt; lost++; } }
  }
  const decidedAmt = wonAmt + lostAmt, decided = won + lost;
  return { userId, month, bidTarget, convTarget, bidThisMonth, bidCount, pctOfQuota: bidTarget ? Math.round(bidThisMonth / bidTarget * 1000) / 10 : 0,
    // Conversion = dollars won / dollars decided (won + lost) over the trailing 12 months. Counts are returned too.
    conversion: decidedAmt ? Math.round(wonAmt / decidedAmt * 1000) / 10 : null, conversionByCount: decided ? Math.round(won / decided * 1000) / 10 : null,
    wonAmount: wonAmt, lostAmount: lostAmt, won, lost, windowStart: since, custom: q.length > 0 };
}
router.get('/quota', R, wrap(async (req, res) => {
  let uid = req.user.id;
  if(req.query.userId && Number(req.query.userId) !== Number(req.user.id)){
    if(!(req.perms['admin.users'] && req.perms['admin.users'] !== 'none')) return res.status(403).json({ error: 'forbidden' });
    uid = Number(req.query.userId);
  }
  res.json(await quotaFor(uid));
}));
// Everyone's standing, for the Owner / Builder.
router.get('/quota/all', requirePerm('admin.users', 'read'), wrap(async (req, res) => {
  const [us] = await pool.query("SELECT DISTINCT u.id, u.name, u.username FROM users u JOIN est_bids b ON b.owner_id = u.id WHERE u.status = 'active'");
  const [q] = await pool.query("SELECT u.id, u.name, u.username FROM users u WHERE u.status = 'active' AND (u.role_key = 'estimator' OR u.id IN (SELECT user_id FROM user_roles WHERE role_key = 'estimator'))");
  const seen = {}; const people = [...q, ...us].filter(u => !seen[u.id] && (seen[u.id] = 1));
  res.json({ people: await Promise.all(people.map(async u => Object.assign({ name: u.name, username: u.username }, await quotaFor(Number(u.id))))) });
}));
router.put('/quota/:userId', requirePerm('admin.users', 'write'), wrap(async (req, res) => {
  const uid = Number(req.params.userId), bt = num(req.body && req.body.bidTarget), ct = num(req.body && req.body.convTarget);
  if(bt == null || bt < 0 || ct == null || ct < 0 || ct > 100) return res.status(400).json({ error: 'bad_quota' });
  const [u] = await pool.query('SELECT id FROM users WHERE id = ?', [uid]);
  if(!u.length) return res.status(404).json({ error: 'not_found' });
  await pool.query('DELETE FROM est_quotas WHERE user_id = ?', [uid]);
  await pool.query('INSERT INTO est_quotas (user_id, bid_target, conv_target, updated_at) VALUES (?, ?, ?, ?)', [uid, bt, ct, Date.now()]);
  await audit(req.user, 'quota.set', 'user', uid, { bidTarget: bt, convTarget: ct }, req.ip);
  res.json(await quotaFor(uid));
}));

// ---- read-only windows into the PM board -------------------------------------
async function board(){
  const [rows] = await pool.query('SELECT data_json FROM board_data WHERE id = 1').catch(() => [[]]);
  if(!rows.length) return { projects: [], people: [] };
  try{ const o = JSON.parse(rows[0].data_json); return { projects: Array.isArray(o.projects) ? o.projects : [], people: Array.isArray(o.people) ? o.people : [] }; }catch(e){ return { projects: [], people: [] }; }
}
// Only names, places and dates: no contract prices, no crew assignments, no notes.
router.get('/active-jobs', requirePerm('pm.projects', 'read'), wrap(async (req, res) => {
  const b = await board();
  res.json({ jobs: b.projects.filter(p => !p.closed && p.status !== 'Completed').map(p => ({ id: String(p.id), name: p.name || '', customer: p.customer || '', city: p.city || '', state: p.state || '',
    lat: typeof p.lat === 'number' ? p.lat : null, lon: typeof p.lon === 'number' ? p.lon : null, status: p.status || '', start: p.plannedStart || '', end: p.plannedEnd || '' })) });
}));
// No pay rates, no contact details: the PM manages the workforce.
router.get('/crew', requirePerm('pm.people', 'read'), wrap(async (req, res) => {
  const b = await board();
  res.json({ people: b.people.map(p => ({ id: String(p.id), type: p.type || '', name: p.name || '', trade: p.trade || '', city: p.city || '', state: p.state || '', availability: p.availability || '' })) });
}));

// The estimate itself (lines, rows, tax, notes) is stored whole, as the customer sees it. Saves are refused if someone saved a newer copy meanwhile.
router.get('/bids/:id/estimate', R, wrap(async (req, res) => {
  const [e] = await pool.query('SELECT doc, updated_at FROM est_estimates WHERE bid_id = ?', [Number(req.params.id) || 0]);
  if(!e.length) return res.json({ estimate: null, updatedAt: null });
  let doc = null; try{ doc = JSON.parse(e[0].doc); }catch(x){}
  res.json({ estimate: doc, updatedAt: Number(e[0].updated_at) });
}));
router.put('/bids/:id/estimate', W, wrap(async (req, res) => {
  const id = Number(req.params.id) || 0, est = req.body && req.body.estimate;
  const [b] = await pool.query('SELECT id, archived, status FROM est_bids WHERE id = ?', [id]);
  if(!b.length) return res.status(404).json({ error: 'not_found' });
  if(Number(b[0].archived)) return res.status(409).json({ error: 'archived' });
  if(b[0].status === 'Lost') return res.status(409).json({ error: 'lost_clone_instead' });   // a Lost bid is kept exactly as submitted; clone it to revise
  if(!est || !Array.isArray(est.lines) || est.lines.length > 400) return res.status(400).json({ error: 'bad_estimate' });
  const doc = JSON.stringify(est); if(doc.length > 2000000) return res.status(413).json({ error: 'too_large' });
  const [cur] = await pool.query('SELECT updated_at FROM est_estimates WHERE bid_id = ?', [id]); const now = Date.now();
  if(cur.length){
    if(req.body.updatedAt != null && Number(req.body.updatedAt) !== Number(cur[0].updated_at)) return res.status(409).json({ error: 'changed_elsewhere' });
    await pool.query('UPDATE est_estimates SET doc = ?, updated_at = ?, updated_by = ? WHERE bid_id = ?', [doc, now, req.user.name, id]);
  }else await pool.query('INSERT INTO est_estimates (bid_id, doc, updated_at, updated_by) VALUES (?, ?, ?, ?)', [id, doc, now, req.user.name]);
  const sub = est.lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  await history(id, req.user, 'estimate', { lines: est.lines.length, subtotal: Math.round(sub * 100) / 100 });
  await audit(req.user, 'estimator.estimate_save', 'bid', id, { lines: est.lines.length }, req.ip);
  res.json({ ok: true, updatedAt: now });
}));

// ---------- Estimator AI: draft the estimate from the bid's email and documents ----------
// A draft takes a few minutes, so it runs as a background job (a row in est_ai_runs) that the screen polls. Nothing is put into the estimate here:
// the screen loads the finished draft for the Estimator to review. A run that is still "running" after 15 minutes is treated as failed.
const AI_STALE_MS = 15 * 60 * 1000;
const runShape = (r, withResult) => {
  let res = null; if(r.result){ try{ res = JSON.parse(r.result); }catch(e){} }
  return { id: Number(r.id), status: r.status, stage: r.stage || '', startedAt: Number(r.started_at), finishedAt: r.finished_at ? Number(r.finished_at) : null, startedBy: r.started_by_name || '', model: r.model || '',
    error: r.error_code ? { code: r.error_code, message: r.error_msg || '' } : null, files: res ? res.files : [], skipped: res ? res.skipped : [], draft: withResult && res ? res.draft : undefined };
};
async function latestRun(bidId){
  const [r] = await pool.query('SELECT * FROM est_ai_runs WHERE bid_id = ? ORDER BY id DESC LIMIT 1', [bidId]); const run = r[0]; if(!run) return null;
  if(run.status === 'running' && Date.now() - Number(run.started_at) > AI_STALE_MS){
    await pool.query("UPDATE est_ai_runs SET status = 'failed', finished_at = ?, error_code = 'timed_out', error_msg = ? WHERE id = ? AND status = 'running'", [Date.now(), 'The draft took too long and was stopped. Try again.', run.id]);
    run.status = 'failed'; run.error_code = 'timed_out'; run.error_msg = 'The draft took too long and was stopped. Try again.'; run.finished_at = Date.now();
  }
  return run;
}
const AI_MSG = { ai_not_configured: 'Estimator AI is not set up on the server yet (the Anthropic key is missing).', no_documents: 'There is nothing the AI can read yet. Add the GC email and the plan set (PDF) to the bid\'s files.', ai_too_long: 'The draft was too long for one pass. Try with fewer documents.', ai_bad_answer: 'The AI answer could not be read. Try again.' };
async function runAiJob(runId, bidId, user){
  try{
    const out = await estAi.draftForBid(bidId, stage => pool.query('UPDATE est_ai_runs SET stage = ? WHERE id = ?', [stage, runId]).catch(() => {}));
    await pool.query("UPDATE est_ai_runs SET status = 'done', stage = NULL, finished_at = ?, model = ?, result = ? WHERE id = ?", [Date.now(), out.model, JSON.stringify({ draft: out.draft, files: out.files, skipped: out.skipped }), runId]);
    await history(bidId, user, 'ai_draft', { lines: out.draft.lines.length, files: out.files.length, skipped: out.skipped.length });
    await audit(user, 'estimator.ai_draft', 'bid', bidId, { run: runId, lines: out.draft.lines.length, model: out.model }, null);
  }catch(e){
    const code = e.code || (e.status === 401 ? 'ai_key_rejected' : e.status === 404 ? 'ai_model_not_found' : e.status === 429 ? 'ai_busy' : e.status === 413 ? 'ai_too_big' : 'ai_failed');
    const msg = AI_MSG[code] || (code === 'ai_key_rejected' ? 'The Anthropic key was rejected.' : code === 'ai_model_not_found' ? 'The AI model name is not available to this key (' + estAi.modelName() + '). Set AI_ESTIMATOR_MODEL on the server.' : code === 'ai_busy' ? 'The AI service is busy. Try again in a minute.' : code === 'ai_too_big' ? 'The documents together are too large for the AI. Try with fewer or smaller files.' : 'The AI could not finish (' + String(e.message || 'error').slice(0, 200) + ').');
    console.error('[estimator-ai]', code, e.message);
    await pool.query("UPDATE est_ai_runs SET status = 'failed', stage = NULL, finished_at = ?, error_code = ?, error_msg = ? WHERE id = ?", [Date.now(), code, msg.slice(0, 500), runId]).catch(() => {});
  }
}
router.post('/bids/:id/ai-draft', W, wrap(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const [b] = await pool.query('SELECT id, archived, status FROM est_bids WHERE id = ?', [id]); if(!b.length) return res.status(404).json({ error: 'not_found' });
  if(Number(b[0].archived)) return res.status(409).json({ error: 'archived' });
  if(b[0].status === 'Lost') return res.status(409).json({ error: 'lost_clone_instead' });
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ai_not_configured', message: AI_MSG.ai_not_configured });
  const cur = await latestRun(id); if(cur && cur.status === 'running') return res.json({ run: runShape(cur, false), already: true });
  const [ins] = await pool.query('INSERT INTO est_ai_runs (bid_id, status, stage, started_by, started_by_name, started_at) VALUES (?, ?, ?, ?, ?, ?)', [id, 'running', 'Starting', req.user.id, req.user.name, Date.now()]);
  runAiJob(ins.insertId, id, req.user);   // background: not awaited
  const [r] = await pool.query('SELECT * FROM est_ai_runs WHERE id = ?', [ins.insertId]);
  res.json({ run: runShape(r[0], false) });
}));
router.get('/bids/:id/ai-draft', R, wrap(async (req, res) => {
  const run = await latestRun(Number(req.params.id) || 0);
  res.json({ configured: !!process.env.ANTHROPIC_API_KEY, run: run ? runShape(run, run.status === 'done') : null });
}));

// ---------- Demo data (Builder only): sample bids and catalog items so people can click around before real jobs are in ----------
// Every demo bid is named "DEMO · ..." and every demo catalog item has a source starting "DEMO ·". Loading twice is refused. "Archive" tucks the demo bids away
// (archived, nothing deleted) and retires the demo catalog items. Demo bids are ordinary bids otherwise (they can be opened, edited, handed off, cloned).
const DEMO_PREFIX = 'DEMO · ';
const isBuilderUser = u => u && u.role_key === 'builder';
async function demoState(){
  const [b] = await pool.query("SELECT COUNT(*) AS n, SUM(archived = 0) AS live FROM est_bids WHERE name LIKE ?", [DEMO_PREFIX + '%']);
  const [c] = await pool.query("SELECT COUNT(*) AS n, SUM(active = 1) AS live FROM est_catalog WHERE source LIKE ?", ['DEMO ·%']);
  return { bids: Number(b[0].n), liveBids: Number(b[0].live || 0), items: Number(c[0].n), liveItems: Number(c[0].live || 0) };
}
router.get('/demo-data', R, wrap(async (req, res) => { res.json(Object.assign({ canManage: isBuilderUser(req.user) }, await demoState())); }));
router.post('/demo-data', W, wrap(async (req, res) => {
  if(!isBuilderUser(req.user)) return res.status(403).json({ error: 'forbidden' });
  const action = req.body && req.body.action, now = Date.now();
  if(action === 'archive'){
    const [u1] = await pool.query("UPDATE est_bids SET archived = 1, updated_at = ? WHERE name LIKE ? AND archived = 0", [now, DEMO_PREFIX + '%']);
    const [u2] = await pool.query("UPDATE est_catalog SET active = 0, updated_at = ?, updated_by = ? WHERE source LIKE ? AND active = 1", [now, req.user.name, 'DEMO ·%']);
    await audit(req.user, 'demo.archive', 'demo', 0, { bids: u1.affectedRows, items: u2.affectedRows }, req.ip);
    return res.json({ ok: true, archivedBids: u1.affectedRows, retiredItems: u2.affectedRows, state: await demoState() });
  }
  if(action !== 'load') return res.status(400).json({ error: 'bad_action' });
  const st = await demoState(); if(st.bids || st.items) return res.status(409).json({ error: 'already_loaded', state: st });
  const demo = require('../lib/demoData');
  const day = 86400000, at = n => new Date(now + n * day).toISOString().slice(0, 10);
  const cc = await codes.nextCodes(demo.bids.length);
  let nb = 0, ne = 0, ni = 0;
  for(let i = 0; i < demo.bids.length; i++){
    const d = demo.bids[i], row = {};
    const val = k => d[k + 'Rel'] != null ? at(d[k + 'Rel']) : (d[k] || null);
    row.name = str(DEMO_PREFIX + d.name, 200); row.store_number = str(d.storeNumber, 40); row.customer = str(d.customer, 200); row.address = str(d.address, 255); row.city = str(d.city, 100); row.state = str(d.state, 40);
    row.lat = d.lat; row.lon = d.lon; row.amount = Math.max(0, num(d.amount) || 0); row.status = STATUSES.includes(d.status) ? d.status : 'Draft';
    row.bid_due = val('bidDue'); row.bid_submitted = val('bidSubmitted'); row.decided_on = val('decidedOn'); row.start_date = val('startDate'); row.end_date = val('endDate'); row.notes = str(d.notes, 20000);
    row.owner_id = req.user.id; row.owner_name = req.user.name; row.owner_username = req.user.username || null; row.created_at = row.updated_at = now; row.project_code = cc[i];
    const cols = Object.keys(row);
    const [ins] = await pool.query('INSERT INTO est_bids (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(',') + ')', cols.map(c => row[c]));
    nb++; await history(ins.insertId, req.user, 'create', { name: row.name, amount: row.amount, status: row.status, demo: true });
    const est = demo.estimates[String(d.key)];
    if(est){ await pool.query('INSERT INTO est_estimates (bid_id, doc, updated_at, updated_by) VALUES (?, ?, ?, ?)', [ins.insertId, JSON.stringify(est), now, req.user.name]); ne++; }
  }
  const cats = await catList();
  for(const it of demo.catalog){
    const o = catClean(it, false, cats); o.source = str(it.source, 120);
    await pool.query('INSERT INTO est_catalog (category, name, stock_no, description, unit, unit_price, taxable, notes, source, icon, active, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
      [o.category, o.name, o.stock_no, o.description, o.unit, o.unit_price, o.taxable, o.notes, o.source, o.icon || null, now, now, req.user.name]); ni++;
  }
  await audit(req.user, 'demo.load', 'demo', 0, { bids: nb, estimates: ne, items: ni }, req.ip);
  res.json({ ok: true, bids: nb, estimates: ne, items: ni, state: await demoState() });
}));

// Hand-off hook: tie a bid to the PM project it became, so the bid's documents show up inside that project. Needs write on both sides.
router.post('/bids/:id/link-project', W, requirePerm('pm.projects', 'write'), wrap(async (req, res) => {
  const pid = req.body && req.body.projectId != null ? String(req.body.projectId).slice(0, 64) : '';
  const [b] = await pool.query('SELECT id FROM est_bids WHERE id = ?', [Number(req.params.id) || 0]);
  if(!b.length) return res.status(404).json({ error: 'not_found' });
  await pool.query('UPDATE est_bids SET project_id = ? WHERE id = ?', [pid || null, b[0].id]);
  await history(b[0].id, req.user, 'link_project', { projectId: pid || null });
  await audit(req.user, 'estimator.link_project', 'bid', b[0].id, { projectId: pid || null }, req.ip);
  res.json({ ok: true });
}));

// ---- Hand-off: Won bid -> PM project --------------------------------------------------------------
// Needs only estimator write: it builds the project from this bid's own estimate (the person never touches the PM board directly),
// and it is recorded in the bid history and the audit log. It refuses to run twice for one bid.
router.get('/bids/:id/handoff', R, wrap(async (req, res) => {
  const [b] = await pool.query('SELECT * FROM est_bids WHERE id = ?', [Number(req.params.id) || 0]);
  if(!b.length) return res.status(404).json({ error: 'not_found' });
  const [e] = await pool.query('SELECT doc FROM est_estimates WHERE bid_id = ?', [b[0].id]);
  let doc = null; try{ doc = e.length ? JSON.parse(e[0].doc) : null; }catch(x){}
  const c = doc ? handoff.contractFrom(b[0], doc, '', 0) : null;
  res.json({ status: b[0].status, projectId: b[0].project_id || null, code: b[0].project_code || '', hasEstimate: !!c,
    scopes: doc ? handoff.scopeBreak(doc) : [],
    preview: c ? { lines: c.lines.length, subtotal: c.subtotal, tax: c.tax, total: c.total, estimateNumber: c.source.estimateNumber } : null });
}));
// Clone: a new Draft bid (own project number) with the old bid's details and estimate, so the original submission is never touched.
// Used when a GC comes back months later (new terms, addendums, a different scope, or after trouble with another contractor) and prices have moved.
router.post('/bids/:id/clone', W, wrap(async (req, res) => {
  const [r] = await pool.query('SELECT * FROM est_bids WHERE id = ?', [Number(req.params.id)]);
  if(!r.length) return res.status(404).json({ error: 'not_found' });
  const o = r[0], root = o.cloned_from || o.id;
  const [cnt] = await pool.query('SELECT COUNT(*) AS n FROM est_bids WHERE cloned_from = ?', [root]);
  const rev = Number(cnt[0].n) + 2;
  const base = String(o.name).replace(/\s+[\u2013-]\s+Rev \d+$/i, '');
  const now = Date.now(), row = {
    name: str(base + ' \u2013 Rev ' + rev, 200), store_number: o.store_number, customer: o.customer, address: o.address, city: o.city, state: o.state, lat: o.lat, lon: o.lon,
    amount: o.amount, status: 'Draft', owner_id: req.user.id, owner_name: req.user.name, owner_username: req.user.username || null,
    start_date: o.start_date, end_date: o.end_date, notes: o.notes, cloned_from: root, cloned_parent: o.id, created_at: now, updated_at: now
  };
  row.project_code = (await codes.nextCodes(1))[0];
  const cols = Object.keys(row);
  const [ins] = await pool.query('INSERT INTO est_bids (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')', cols.map(c => row[c]));
  const [e] = await pool.query('SELECT doc FROM est_estimates WHERE bid_id = ?', [o.id]);
  let lines = 0;
  if(e.length){
    let doc = null; try{ doc = JSON.parse(e[0].doc); }catch(x){}
    if(doc){
      doc.clonedFrom = { bidId: Number(o.id), code: o.project_code || '', number: doc.number || '', date: doc.date || '' };
      doc.number = ''; doc.date = today(); delete doc.submissions;          // new estimate number/date; the old Sent history stays with the original
      (doc.lines || []).forEach(l => { l.repriceCheck = true; });             // every line is flagged "check prices" until the estimator clears it
      lines = (doc.lines || []).length;
      await pool.query('INSERT INTO est_estimates (bid_id, doc, updated_at, updated_by) VALUES (?, ?, ?, ?)', [ins.insertId, JSON.stringify(doc), now, req.user.name]);
    }
  }
  await history(ins.insertId, req.user, 'clone', { from: Number(o.id), fromCode: o.project_code || '', rev, lines });
  await history(o.id, req.user, 'cloned', { to: Number(ins.insertId), rev });
  await audit(req.user, 'bid.clone', 'bid', ins.insertId, { from: Number(o.id), rev }, req.ip);
  const [n] = await pool.query('SELECT * FROM est_bids WHERE id = ?', [ins.insertId]);
  res.json({ bid: shape(n[0]) });
}));

router.post('/bids/:id/handoff', W, wrap(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const [b] = await pool.query('SELECT * FROM est_bids WHERE id = ?', [id]);
  if(!b.length) return res.status(404).json({ error: 'not_found' });
  const bid = b[0];
  if(Number(bid.archived)) return res.status(409).json({ error: 'archived' });
  if(bid.status !== 'Won') return res.status(409).json({ error: 'not_won', message: 'Mark the bid Won first.' });
  if(bid.project_id) return res.status(409).json({ error: 'already_handed_off', projectId: bid.project_id });
  const [e] = await pool.query('SELECT doc FROM est_estimates WHERE bid_id = ?', [id]);
  let doc = null; try{ doc = e.length ? JSON.parse(e[0].doc) : null; }catch(x){}
  if(!doc || !Array.isArray(doc.lines) || !doc.lines.length) return res.status(409).json({ error: 'no_estimate', message: 'Build the estimate first; its lines become the contract.' });
  const now = Date.now();
  const names = handoff.scopeBreak(doc).map(x => x.scope);
  const want = Array.isArray(req.body && req.body.scopes) ? req.body.scopes.map(String).filter(x => names.includes(x)) : [];
  if(Array.isArray(req.body && req.body.scopes) && req.body.scopes.length && !want.length) return res.status(400).json({ error: 'bad_scopes', message: 'None of those scopes are on the estimate.' });
  const contract = handoff.contractFrom(bid, doc, req.user.name, now, want.length ? want : null);
  const project = handoff.projectFrom(bid, contract, now);
  let out;
  try{ out = await handoff.addToBoard(project, req.user.role_key === 'builder' ? 'builder' : (req.user.role_key === 'owner' ? 'owner' : 'manager')); }
  catch(x){ if(x && x.status === 503) return res.status(503).json({ error: 'busy' }); throw x; }
  // claim the bid only if nobody else did meanwhile
  const [u] = await pool.query('UPDATE est_bids SET project_id = ?, updated_at = ? WHERE id = ? AND project_id IS NULL', [out.projectId, now, id]);
  await history(id, req.user, 'handoff', { projectId: out.projectId, code: out.code, lines: contract.lines.length, total: contract.total, scopes: contract.scopes ? contract.scopes.map(x => x.scope) : undefined });
  await audit(req.user, 'estimator.handoff', 'bid', id, { projectId: out.projectId, code: out.code, total: contract.total }, req.ip);
  try{ await notify({ kind: 'handoff', text: (bid.name || 'A project') + ' was handed off from the Estimator (' + out.code + ').', route: '/pm', toPane: 'pm.projects', toLevel: 'write', from: req.user }); }catch(x){ console.error('handoff notify failed', x); }
  res.json({ ok: true, projectId: out.projectId, code: out.code, lines: contract.lines.length, total: contract.total, claimed: u.affectedRows === 1 });
}));

// ---- Dashboard: next steps worked out from each bid, the person's own to-dos, and the monthly analytics ----
const canSeeAll = req => !!(req.perms && req.perms['admin.users'] && req.perms['admin.users'] !== 'none');
router.get('/tasks', R, wrap(async (req, res) => {
  const all = req.query.all === '1' && canSeeAll(req);
  const [bids] = await pool.query("SELECT * FROM est_bids WHERE archived = 0 AND status IN ('Draft', 'Bidding', 'Won')" + (all ? '' : ' AND owner_id = ?'), all ? [] : [req.user.id]);
  const ids = bids.map(b => Number(b.id)), docs = {}, hasFiles = new Set();
  if(ids.length){
    const ph = ids.map(() => '?').join(',');
    const [d] = await pool.query('SELECT bid_id, doc FROM est_estimates WHERE bid_id IN (' + ph + ')', ids);
    d.forEach(x => { try{ docs[x.bid_id] = JSON.parse(x.doc); }catch(e){} });
    const [all2] = await pool.query('SELECT id, cloned_parent FROM est_bids WHERE cloned_parent IS NOT NULL OR id IN (' + ph + ')', ids);
    const parent = {}; all2.forEach(x => { parent[Number(x.id)] = x.cloned_parent ? Number(x.cloned_parent) : 0; });
    const [fc] = await pool.query("SELECT DISTINCT entity_id FROM media_files WHERE entity_type = 'bid' AND hidden = 0");
    const withFiles = new Set(fc.map(x => Number(x.entity_id)));
    for(const id of ids){ let cur = id, n = 0; while(cur && n++ < 25){ if(withFiles.has(cur)){ hasFiles.add(id); break; } cur = parent[cur] || 0; } }
  }
  const noContract = new Set();
  const pids = bids.filter(b => b.status === 'Won' && b.project_id).map(b => String(b.project_id));
  if(pids.length){ const [have] = await pool.query('SELECT project_id FROM est_contracts WHERE project_id IN (' + pids.map(() => '?').join(',') + ')', pids); const got = new Set(have.map(x => String(x.project_id))); pids.forEach(x => { if(!got.has(x)) noContract.add(x); }); }
  const auto = tasksLib.autoTasks({ bids, docs, hasFiles, today: today(), noContract });
  const [mine] = await pool.query('SELECT t.*, b.name AS bid_name, b.project_code AS bid_code FROM est_tasks t LEFT JOIN est_bids b ON b.id = t.bid_id WHERE t.user_id = ? AND (t.done = 0 OR t.done_at > ?) ORDER BY t.done, t.due IS NULL, t.due, t.id', [req.user.id, Date.now() - 24 * 3600 * 1000]);
  res.json({ auto, mine: mine.map(t => ({ id: Number(t.id), text: t.text, due: t.due || '', done: !!Number(t.done), bidId: t.bid_id == null ? null : Number(t.bid_id), bidName: t.bid_name || '', code: t.bid_code || '' })), all, canAll: canSeeAll(req) });
}));
router.post('/tasks', W, wrap(async (req, res) => {
  const b = req.body || {}, text = str(String(b.text || '').trim(), 300); if(!text) return res.status(400).json({ error: 'text_required' });
  if(!dateOk(b.due)) return res.status(400).json({ error: 'bad_date' });
  let bidId = null; if(b.bidId){ const [x] = await pool.query('SELECT id FROM est_bids WHERE id = ?', [Number(b.bidId)]); if(!x.length) return res.status(400).json({ error: 'bad_bid' }); bidId = x[0].id; }
  const [r] = await pool.query('INSERT INTO est_tasks (user_id, bid_id, text, due, created_at) VALUES (?, ?, ?, ?, ?)', [req.user.id, bidId, text, b.due || null, Date.now()]);
  res.json({ id: Number(r.insertId) });
}));
router.patch('/tasks/:id', W, wrap(async (req, res) => {
  const b = req.body || {}, sets = [], vals = [];
  if(b.done !== undefined){ sets.push('done = ?', 'done_at = ?'); vals.push(b.done ? 1 : 0, b.done ? Date.now() : null); }
  if(b.text !== undefined){ const t = str(String(b.text).trim(), 300); if(!t) return res.status(400).json({ error: 'text_required' }); sets.push('text = ?'); vals.push(t); }
  if(b.due !== undefined){ if(!dateOk(b.due)) return res.status(400).json({ error: 'bad_date' }); sets.push('due = ?'); vals.push(b.due || null); }
  if(!sets.length) return res.json({ ok: true });
  const [r] = await pool.query('UPDATE est_tasks SET ' + sets.join(', ') + ' WHERE id = ? AND user_id = ?', [...vals, Number(req.params.id) || 0, req.user.id]);
  if(!r.affectedRows) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
}));
router.delete('/tasks/:id', W, wrap(async (req, res) => {
  await pool.query('DELETE FROM est_tasks WHERE id = ? AND user_id = ?', [Number(req.params.id) || 0, req.user.id]);
  res.json({ ok: true });
}));
// Analytics: bid totals, conversion and awards by month. Counts archived bids too (history); "mine" unless the person may see everyone.
router.get('/analytics', R, wrap(async (req, res) => {
  const all = req.query.all === '1' && canSeeAll(req), n = [6, 12, 24].includes(Number(req.query.months)) ? Number(req.query.months) : 12;
  const [rows] = await pool.query('SELECT status, amount, bid_submitted, decided_on, owner_id FROM est_bids WHERE deleted_at IS NULL' + (all ? '' : ' AND owner_id = ?'), all ? [] : [req.user.id]);
  res.json(Object.assign({ all, canAll: canSeeAll(req), monthsBack: n }, tasksLib.monthly(rows, today().slice(0, 7), n)));
}));

// ---- Product catalog (Price Book & Rates pane) ----------------------------------------------------
const { lvl } = require('../lib/catalog');
// Reading the catalog: Price Book access (Owner/Estimator) or the PM's view-only catalog pane. Editing stays with the Price Book.
const PB_R = (req, res, next) => (req.perms && (lvl(req.perms['estimator.pricebook']) >= 1 || lvl(req.perms['pm.catalog']) >= 1)) ? next() : res.status(403).json({ error: 'forbidden', need: 'pm.catalog:read' });
const PB_W = requirePerm('estimator.pricebook', 'write');
const UNITS = ['ea', 'ft', 'lb', 'hr', 'day', 'ls', 'sf', 'ton', 'mi'];
const ICONS = ['steel', 'bolt', 'tool', 'wrench', 'truck', 'bed', 'fuel', 'paint', 'forklift', 'crane', 'doc', 'box'];   // built-in pictograms (the screen draws them) for items with no photo
const CATS = ['Materials', 'Consumables', 'Fabrication', 'Installation', 'Transport', 'Lodging & Per Diem', 'Coatings', 'Other'];
const catOne = async id => { const [x] = await pool.query('SELECT c.*, i.updated_at AS image_at FROM est_catalog c LEFT JOIN est_catalog_images i ON i.item_id = c.id WHERE c.id = ?', [id]); return x[0]; };
const catShape = r => ({ id: Number(r.id), category: r.category, name: r.name, stockNo: r.stock_no || '', description: r.description || '', unit: r.unit, unitPrice: r.unit_price == null ? null : Number(r.unit_price),
  taxable: !!Number(r.taxable), notes: r.notes || '', source: r.source || '', icon: r.icon || '', imageAt: r.image_at ? Number(r.image_at) : null, active: !!Number(r.active), updatedAt: Number(r.updated_at), updatedBy: r.updated_by || '' });
// Categories (the filter bubbles on the Catalog pane) live in est_catalog_cats; the first read seeds the standard set plus any category an item already uses.
async function catList(){
  let [rows] = await pool.query('SELECT name FROM est_catalog_cats ORDER BY sort_no, name');
  if(!rows.length){
    const [used] = await pool.query('SELECT DISTINCT category FROM est_catalog');
    const names = CATS.concat(used.map(u => u.category).filter(c => c && !CATS.includes(c))); const now = Date.now();
    for(let i = 0; i < names.length; i++) await pool.query('INSERT IGNORE INTO est_catalog_cats (name, sort_no, created_at, created_by) VALUES (?, ?, ?, ?)', [names[i], i, now, 'System']);
    rows = names.map(name => ({ name }));
  }
  return rows.map(r => r.name);
}
function catClean(b, partial, cats){
  const o = {};
  const set = (k, col, v) => { if(!partial || b[k] !== undefined) o[col] = v; };
  set('category', 'category', cats.includes(b.category) ? b.category : (cats.includes('Materials') ? 'Materials' : cats[0]));
  set('name', 'name', str(b.name, 200) || '');
  set('stockNo', 'stock_no', str(b.stockNo, 80) || null);
  set('description', 'description', str(b.description, 4000) || null);
  set('unit', 'unit', UNITS.includes(b.unit) ? b.unit : 'ea');
  set('unitPrice', 'unit_price', b.unitPrice === '' || b.unitPrice == null ? null : Math.max(0, num(b.unitPrice) || 0));
  set('taxable', 'taxable', b.taxable === false || b.taxable === 0 ? 0 : 1);
  set('notes', 'notes', str(b.notes, 2000) || null);
  set('source', 'source', str(b.source, 120) || null);
  set('icon', 'icon', ICONS.includes(b.icon) ? b.icon : null);
  return o;
}
router.get('/catalog', PB_R, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT c.*, i.updated_at AS image_at FROM est_catalog c LEFT JOIN est_catalog_images i ON i.item_id = c.id ORDER BY c.active DESC, c.category, c.name');
  res.json({ items: rows.map(catShape), categories: await catList(), units: UNITS });
}));
router.post('/catalog', PB_W, wrap(async (req, res) => {
  const o = catClean(req.body || {}, false, await catList());
  if(!o.name) return res.status(400).json({ error: 'name_required' });
  const now = Date.now();
  const [r] = await pool.query('INSERT INTO est_catalog (category, name, stock_no, description, unit, unit_price, taxable, notes, source, icon, active, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
    [o.category, o.name, o.stock_no, o.description, o.unit, o.unit_price, o.taxable, o.notes, o.source, o.icon || null, now, now, req.user.name]);
  await audit(req.user, 'catalog.add', 'catalog', r.insertId, { name: o.name, unitPrice: o.unit_price }, req.ip);
  res.json(catShape(await catOne(r.insertId)));
}));
router.patch('/catalog/:id', PB_W, wrap(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const [cur] = await pool.query('SELECT * FROM est_catalog WHERE id = ?', [id]);
  if(!cur.length) return res.status(404).json({ error: 'not_found' });
  const cats = await catList();
  if(req.body && req.body.category !== undefined && !cats.includes(req.body.category)) return res.status(400).json({ error: 'bad_category' });
  const o = catClean(req.body || {}, true, cats);
  if('name' in o && !o.name) return res.status(400).json({ error: 'name_required' });
  const keys = Object.keys(o); const ch = {};
  keys.forEach(k => { if(String(cur[0][k] == null ? '' : cur[0][k]) !== String(o[k] == null ? '' : o[k])) ch[k] = { from: cur[0][k], to: o[k] }; });
  if(!Object.keys(ch).length) return res.json(catShape(await catOne(id)));
  await pool.query('UPDATE est_catalog SET ' + keys.map(k => k + ' = ?').join(', ') + ', updated_at = ?, updated_by = ? WHERE id = ?', keys.map(k => o[k]).concat([Date.now(), req.user.name, id]));
  await audit(req.user, 'catalog.edit', 'catalog', id, ch, req.ip);
  res.json(catShape(await catOne(id)));
}));
// Item picture: the screen shrinks the photo (max 1600 px, JPEG) before sending; the server still checks type, size and the file's own signature.
const IMG_OK = { 'image/jpeg': b => b[0] === 0xFF && b[1] === 0xD8, 'image/png': b => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])), 'image/webp': b => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' };
router.put('/catalog/:id/image', PB_W, express.raw({ type: () => true, limit: '4mb' }), wrap(async (req, res) => {
  const id = Number(req.params.id) || 0, body = req.body, mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const [it] = await pool.query('SELECT id, name FROM est_catalog WHERE id = ?', [id]); if(!it.length) return res.status(404).json({ error: 'not_found' });
  if(!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'empty_file' });
  if(!IMG_OK[mime]) return res.status(415).json({ error: 'use_jpg_png_or_webp' });
  if(!IMG_OK[mime](body)) return res.status(415).json({ error: 'file_does_not_match_its_type' });
  const now = Date.now();
  await pool.query('INSERT INTO est_catalog_images (item_id, mime, size, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE mime = VALUES(mime), size = VALUES(size), data = VALUES(data), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)', [id, mime, body.length, body, now, req.user.name]);
  await audit(req.user, 'catalog.image_set', 'catalog', id, { name: it[0].name, bytes: body.length }, req.ip);
  res.json(catShape(await catOne(id)));
}));
router.post('/catalog/:id/image/remove', PB_W, wrap(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const [r] = await pool.query('DELETE FROM est_catalog_images WHERE item_id = ?', [id]);
  if(r.affectedRows) await audit(req.user, 'catalog.image_remove', 'catalog', id, null, req.ip);
  res.json({ ok: true });
}));
router.get('/catalog/:id/image', PB_R, wrap(async (req, res) => {
  const [r] = await pool.query('SELECT mime, data, updated_at FROM est_catalog_images WHERE item_id = ?', [Number(req.params.id) || 0]);
  if(!r.length) return res.status(404).json({ error: 'no_image' });
  res.set({ 'Content-Type': r[0].mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  res.send(r[0].data);   // the screen asks for ?v=<imageAt>, so a replaced picture is a new address and the old one can be cached for good
}));
// Add / rename / delete a category (filter bubble). Delete only when no item (retired ones included) is filed under it, so nothing is ever orphaned.
const catName = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 40);
router.post('/catalog-categories', PB_W, wrap(async (req, res) => {
  const name = catName(req.body && req.body.name); if(!name) return res.status(400).json({ error: 'name_required' });
  const cats = await catList(); if(cats.some(c => c.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'already_exists' });
  await pool.query('INSERT INTO est_catalog_cats (name, sort_no, created_at, created_by) VALUES (?, ?, ?, ?)', [name, cats.length, Date.now(), req.user.name]);
  await audit(req.user, 'catalog.category_add', 'catalog', null, { name }, req.ip);
  res.json({ categories: await catList() });
}));
router.patch('/catalog-categories', PB_W, wrap(async (req, res) => {
  const from = catName(req.body && req.body.from), to = catName(req.body && req.body.to); if(!from || !to) return res.status(400).json({ error: 'name_required' });
  const cats = await catList(); if(!cats.includes(from)) return res.status(404).json({ error: 'not_found' });
  if(from !== to && cats.some(c => c.toLowerCase() === to.toLowerCase() && c !== from)) return res.status(409).json({ error: 'already_exists' });
  if(from !== to){
    await pool.query('UPDATE est_catalog_cats SET name = ? WHERE name = ?', [to, from]);
    await pool.query('UPDATE est_catalog SET category = ? WHERE category = ?', [to, from]);
    await audit(req.user, 'catalog.category_rename', 'catalog', null, { from, to }, req.ip);
  }
  res.json({ categories: await catList() });
}));
router.post('/catalog-categories/delete', PB_W, wrap(async (req, res) => {
  const name = catName(req.body && req.body.name); const cats = await catList(); if(!cats.includes(name)) return res.status(404).json({ error: 'not_found' });
  const [n] = await pool.query('SELECT COUNT(*) AS n FROM est_catalog WHERE category = ?', [name]);
  if(Number(n[0].n) > 0) return res.status(409).json({ error: 'category_in_use', count: Number(n[0].n) });
  await pool.query('DELETE FROM est_catalog_cats WHERE name = ?', [name]);
  await audit(req.user, 'catalog.category_delete', 'catalog', null, { name }, req.ip);
  res.json({ categories: await catList() });
}));
// "Remove" = retire. The item stays on every estimate that used it and can be restored.
[['retire', 0], ['restore', 1]].forEach(([verb, val]) => {
  router.post('/catalog/:id/' + verb, PB_W, wrap(async (req, res) => {
    const id = Number(req.params.id) || 0;
    const [r] = await pool.query('UPDATE est_catalog SET active = ?, updated_at = ?, updated_by = ? WHERE id = ?', [val, Date.now(), req.user.name, id]);
    if(!r.affectedRows) return res.status(404).json({ error: 'not_found' });
    await audit(req.user, 'catalog.' + verb, 'catalog', id, null, req.ip);
    res.json({ ok: true });
  }));
});

module.exports = router;
