// Estimator: bids, each estimator's monthly quota, and the read-only views the estimator needs of the PM board
// (active jobs for the map/calendar, crew & subs). Nothing is ever deleted: a bid is archived, and every change is kept with the person who made it.
const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePerm, blockUntilPasswordChanged } = require('../lib/auth');
const { audit } = require('../lib/audit');

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
  notes: b.notes || '', archived: !!b.archived, createdAt: Number(b.created_at), updatedAt: Number(b.updated_at) });

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

router.get('/bids', R, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM est_bids' + (req.query.archived === '1' ? '' : ' WHERE archived = 0') + ' ORDER BY id DESC');
  res.json({ statuses: STATUSES, bids: rows.map(shape) });
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

module.exports = router;
