// Everything about protecting the board data itself:
//  - role rules (what a manager may read/write vs. the Builder)
//  - the mass-deletion guard
//  - automatic history snapshots, retention, and restore
//
// The board is one JSON document (board_data row 1). This module never
// changes its shape; it only decides whether a save is allowed and keeps
// copies so any save can be undone.
//
// MAINTAINER NOTE — when a new top-level key is added to the board data:
//   * builder-only (dev tooling, secrets)  -> add to BUILDER_ONLY_READ and BUILDER_ONLY_WRITE
//   * edited by managers in normal use     -> add to MANAGER_KEYS
// A manager's save only ever changes the keys in MANAGER_KEYS (plus a few
// validated settings); anything else they send is ignored and noted in the
// security log as "unknown_keys", which is how a forgotten key shows up.

const crypto = require('crypto');
const zlib = require('zlib');
const util = require('util');
const pool = require('../config/db');
const { protectOpsEmail, protectContract } = require('./money');

const gzip = util.promisify(zlib.gzip);

// ---- tunables --------------------------------------------------------------
const SNAPSHOT_MIN_GAP_MS = 10 * 60 * 1000;      // routine snapshots: at most one per 10 min
const KEEP_ALL_MS = 48 * 60 * 60 * 1000;         // keep every snapshot for 48h
const KEEP_DAILY_MS = 90 * 24 * 60 * 60 * 1000;  // then one per day, up to 90 days
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const MAX_SNAPSHOT_ROWS = 1500;                  // hard ceiling on stored history

// Mass-deletion guard (applies to the manager role; the Builder is exempt
// but every delete still forces a snapshot first).
const GUARD_MAX_REMOVED = 6;          // 6+ items gone from one collection in one save
const GUARD_MAX_FRACTION = 0.4;       // ...or more than 40% of a collection (when it has 4+)
const GUARD_MIN_SHRINK = 0.6;         // ...or the whole board's data shrinking below 60% of its size
const GUARD_WINDOW_MS = 10 * 60 * 1000;
const GUARD_WINDOW_MAX = 10;          // total removals allowed for ALL managers per 10 min

// What each role may touch (see the maintainer note above).
const BUILDER_ONLY_READ = ['devTasks', 'devHowTos', 'architecture'];
const BUILDER_ONLY_WRITE = ['devTasks', 'devHowTos', 'architecture', 'eventHooks'];
const MANAGER_KEYS = ['projects', 'people', 'skills', 'deactivatedSkills', 'criteria', 'acknowledgedIssues', 'eventLog', 'settings', 'moneySettings', 'revision'];
const ARRAY_KEYS = ['projects', 'people', 'skills', 'deactivatedSkills', 'criteria', 'eventLog'];

// Test-only switch: scales the forced-snapshot flood gap (1 = real behaviour).
let GAP_SCALE = 1;
function setGapScaleForTests(n) { GAP_SCALE = n; }

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// ---- role policy -----------------------------------------------------------
function stripLegacyCodes(obj) {
  if (obj && obj.settings) {
    delete obj.settings.passcode;
    delete obj.settings.builderPasscode;
  }
  return obj;
}

// What a given role is allowed to SEE.
function sanitizeForRole(obj, role) {
  stripLegacyCodes(obj);
  if (role !== 'builder') {
    for (const k of BUILDER_ONLY_READ) delete obj[k];
    // Managers' pages need to know whether a hook is on (for the activity log), not where it points.
    if (Array.isArray(obj.eventHooks)) {
      obj.eventHooks = obj.eventHooks.map(h => Object.assign({}, h, { targetUrl: h && h.targetUrl ? '(hidden)' : '' }));
    }
  }
  return obj;
}

// Returns an error string if a manager's payload has a manager-owned key of the wrong type.
function shapeProblem(incoming) {
  for (const k of ARRAY_KEYS) if (incoming[k] !== undefined && !Array.isArray(incoming[k])) return `"${k}" must be a list`;
  if (incoming.acknowledgedIssues !== undefined &&
      (typeof incoming.acknowledgedIssues !== 'object' || incoming.acknowledgedIssues === null || Array.isArray(incoming.acknowledgedIssues))) {
    return '"acknowledgedIssues" must be an object';
  }
  if (incoming.moneySettings !== undefined && (typeof incoming.moneySettings !== 'object' || incoming.moneySettings === null || Array.isArray(incoming.moneySettings))) {
    return '"moneySettings" must be an object';
  }
  if (incoming.settings !== undefined && (typeof incoming.settings !== 'object' || incoming.settings === null || Array.isArray(incoming.settings))) {
    return '"settings" must be an object';
  }
  return null;
}

// The only settings a manager's save may change, each validated.
function cleanManagerSettings(inS, curS) {
  const out = Object.assign({}, curS);
  inS = inS || {};
  for (const k of ['pmHelloTemplate', 'dateConfirmTemplate']) {
    if (typeof inS[k] === 'string' && inS[k].length <= 8000) out[k] = inS[k];
  }
  if (typeof inS.rankingProximityWeight === 'number' && Number.isFinite(inS.rankingProximityWeight)) {
    out.rankingProximityWeight = Math.min(100, Math.max(0, inS.rankingProximityWeight));
  }
  if (typeof inS.rankingPriceWeight === 'number' && Number.isFinite(inS.rankingPriceWeight)) {
    out.rankingPriceWeight = Math.min(100, Math.max(0, inS.rankingPriceWeight));
  }
  return out;
}

// What a given role is allowed to WRITE: returns { next, ignoredKeys }.
// Builder: the document as sent (minus legacy codes).
// Manager: the STORED document, with only the manager-owned keys replaced.
function applyWritePolicy(incoming, cur, role) {
  stripLegacyCodes(incoming);
  if (role === 'builder') return { next: incoming, ignoredKeys: [] };
  const next = Object.assign({}, cur);
  for (const k of MANAGER_KEYS) {
    if (k === 'settings') continue;
    if (incoming[k] !== undefined) next[k] = incoming[k];
  }
  next.settings = cleanManagerSettings(incoming.settings, cur.settings);
  protectOpsEmail(next, cur, role);
  protectContract(next, cur, role);
  const ignoredKeys = Object.keys(incoming).filter(k => !MANAGER_KEYS.includes(k) && !BUILDER_ONLY_WRITE.includes(k));
  return { next, ignoredKeys };
}

// ---- change measurement -----------------------------------------------------
function keyOf(x) { return (x && typeof x === 'object') ? (x.id !== undefined ? String(x.id) : JSON.stringify(x)) : String(x); }
function keySet(arr) { return new Set((Array.isArray(arr) ? arr : []).map(keyOf)); }

function removedIn(curArr, newArr) {
  const n = keySet(newArr);
  let r = 0;
  for (const k of keySet(curArr)) if (!n.has(k)) r++;
  return r;
}
// Phases removed from projects that still exist (deleting a whole project is
// already counted under "projects").
function removedPhases(cur, next) {
  const nextById = new Map((next.projects || []).map(p => [keyOf(p), p]));
  let r = 0;
  for (const p of (cur.projects || [])) {
    const np = nextById.get(keyOf(p));
    if (np) r += removedIn(p.phases, np.phases);
  }
  return r;
}

function measureRemovals(cur, next) {
  return {
    projects: removedIn(cur.projects, next.projects),
    people: removedIn(cur.people, next.people),
    skills: removedIn(cur.skills, next.skills),
    phases: removedPhases(cur, next),
    _sizes: {
      projects: (cur.projects || []).length,
      people: (cur.people || []).length,
      skills: (cur.skills || []).length
    }
  };
}
function totalRemoved(m) { return m.projects + m.people + m.skills + m.phases; }

// Removals are counted for the whole manager role (the code is shared), not
// per session, so logging in again can't reset the count.
const velocity = new Map(); // key -> [{t, n}]
function velocityTotal(key) {
  const now = Date.now();
  const list = (velocity.get(key) || []).filter(e => now - e.t < GUARD_WINDOW_MS);
  velocity.set(key, list);
  return list.reduce((a, e) => a + e.n, 0);
}
function addVelocity(key, n) {
  if (!n) return;
  const list = velocity.get(key) || [];
  list.push({ t: Date.now(), n });
  velocity.set(key, list);
}

// Returns null if fine, or a human-readable reason the save should be refused.
function guardReason(m, key, cur, next) {
  const parts = [];
  for (const k of ['projects', 'people', 'skills']) {
    const r = m[k];
    const total = m._sizes[k];
    if (r >= GUARD_MAX_REMOVED || (total >= 4 && r > 0 && r / total > GUARD_MAX_FRACTION) ||
        (total >= 2 && (next[k] || []).length === 0)) {
      parts.push(`${r} of ${total} ${k}`);
    }
  }
  if (m.phases >= 8) parts.push(`${m.phases} phases`);
  if (parts.length) return `This change would remove ${parts.join(', ')} at once.`;

  // Blanking records out without deleting them (ids kept, contents emptied)
  // doesn't remove anything, but it does shrink the data a lot.
  const curLen = JSON.stringify(cur).length, nextLen = JSON.stringify(next).length;
  if (curLen > 20000 && nextLen < curLen * GUARD_MIN_SHRINK) {
    return `This change would shrink the board's data by ${Math.round(100 - 100 * nextLen / curLen)}%.`;
  }
  if (velocityTotal(key) + totalRemoved(m) > GUARD_WINDOW_MAX) {
    return `That is more than ${GUARD_WINDOW_MAX} deletions in 10 minutes.`;
  }
  return null;
}

// ---- snapshots ---------------------------------------------------------------
function countsOf(obj) {
  return {
    projects: Array.isArray(obj && obj.projects) ? obj.projects.length : 0,
    people: Array.isArray(obj && obj.people) ? obj.people.length : 0,
    skills: Array.isArray(obj && obj.skills) ? obj.skills.length : 0
  };
}

// Stores a compressed copy of `json`. Skips if identical to the newest
// snapshot. Routine (force=false) snapshots are also skipped if the newest is
// under 10 minutes old; forced ones are skipped only if the newest is under
// `minGapMs` old (a flood guard — 0 means never skip).
async function writeSnapshot(json, obj, reason, savedBy, force = true, minGapMs = 0) {
  const hash = sha256(json);
  const [last] = await pool.query('SELECT sha256, created_at FROM board_history ORDER BY id DESC LIMIT 1');
  if (last.length) {
    const age = Date.now() - Number(last[0].created_at);
    if (last[0].sha256 === hash) return false;
    if (!force && age < SNAPSHOT_MIN_GAP_MS) return false;
    if (force && age < minGapMs * GAP_SCALE) return false;
  }
  const c = countsOf(obj);
  const rev = obj && Number.isSafeInteger(obj.revision) && obj.revision >= 0 && obj.revision <= 2147483647 ? obj.revision : null;
  const gz = await gzip(Buffer.from(json, 'utf8'));
  await pool.query(
    `INSERT INTO board_history
       (created_at, reason, saved_by, revision, projects_n, people_n, skills_n, bytes, sha256, data_gz, user_id, user_name, user_username)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [Date.now(), reason, savedBy || null, rev, c.projects, c.people, c.skills, Buffer.byteLength(json), hash, gz].concat(require('../../lib/actor').cols()));
  enforceRowCap().catch(e => console.error('history cap failed', e));
  maybePrune().catch(e => console.error('prune failed', e));
  return true;
}

async function enforceRowCap() {
  const [extra] = await pool.query(
    'SELECT id FROM board_history ORDER BY id DESC LIMIT 100000 OFFSET ' + MAX_SNAPSHOT_ROWS);
  for (let i = 0; i < extra.length; i += 200) {
    const chunk = extra.slice(i, i + 200).map(r => r.id);
    await pool.query(`DELETE FROM board_history WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
  }
}

let lastPrune = 0;
async function maybePrune() {
  if (Date.now() - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = Date.now();
  await prune();
}
async function prune() {
  const now = Date.now();
  await pool.query('DELETE FROM board_history WHERE created_at < ?', [now - KEEP_DAILY_MS]);
  const [old] = await pool.query(
    'SELECT id, created_at FROM board_history WHERE created_at < ? ORDER BY id ASC', [now - KEEP_ALL_MS]);
  const newestPerDay = new Map();
  for (const r of old) newestPerDay.set(new Date(Number(r.created_at)).toISOString().slice(0, 10), r.id); // ids ascend => last wins
  const keep = new Set(newestPerDay.values());
  const drop = old.filter(r => !keep.has(r.id)).map(r => r.id);
  for (let i = 0; i < drop.length; i += 200) {
    const chunk = drop.slice(i, i + 200);
    await pool.query(`DELETE FROM board_history WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
  }
  await enforceRowCap();
}

function readSnapshotJson(row) {
  return zlib.gunzipSync(Buffer.from(row.data_gz)).toString('utf8');
}

module.exports = {
  BUILDER_ONLY_READ, BUILDER_ONLY_WRITE, MANAGER_KEYS,
  sanitizeForRole, applyWritePolicy, stripLegacyCodes, shapeProblem,
  measureRemovals, totalRemoved, guardReason, addVelocity,
  writeSnapshot, readSnapshotJson, prune, countsOf, sha256, enforceRowCap, setGapScaleForTests
};
