const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, audit, wrap } = require('../lib/auth');
const projects = require('../lib/projects');
const archive = require('../lib/archive');
const store = require('../lib/boardStore');
const money = require('../lib/money');

const MAX_REVISION_JUMP = 100; // a page can be a little ahead after failed saves, never wildly
const SAVES_PER_MINUTE = 60;   // per role; generous for real editing, a ceiling for abuse
const saveTimes = new Map();   // role -> [timestamps]

// GET /api/data — the board, filtered for the caller's role.
// Never contains access codes. An Owner's or PM's copy also omits the dev backlog,
// how-tos and the system architecture panel entirely, and automation target
// URLs are masked.
router.get('/', requireAuth(), wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT data_json, revision FROM board_data WHERE id = 1');
  if (!rows.length) {
    return res.status(404).json({ error: 'No board data yet — run the seed script first.' });
  }
  const obj = JSON.parse(rows[0].data_json);
  store.sanitizeForRole(obj, req.auth.role);
  res.json({ value: JSON.stringify(obj), revision: rows[0].revision, role: req.auth.role });
}));

// POST /api/data — save the board.
// Every save is: logged-in -> shaped like a board -> not stale -> allowed for
// the role -> not a mass deletion -> snapshotted -> written. The request body
// is only parsed (up to 5 MB) AFTER the caller has been authenticated.
router.post('/', requireAuth(), express.json({ limit: '5mb' }), wrap(async (req, res) => {
  const role = req.auth.role;

  if (archive.isClosing()) return res.status(423).json({ error: 'closing', message: 'A project is being closed out right now. Try again in a moment.' });
  const now = Date.now();
  const recentSaves = (saveTimes.get(role) || []).filter(t => now - t < 60 * 1000);
  if (recentSaves.length >= SAVES_PER_MINUTE) return res.status(429).json({ error: 'too_many_saves' });
  recentSaves.push(now);
  saveTimes.set(role, recentSaves);

  const value = req.body && req.body.value;
  if (typeof value !== 'string') {
    return res.status(400).json({ error: '"value" must be a JSON string, same as before.' });
  }
  let parsed;
  try { parsed = JSON.parse(value); } catch (e) { return res.status(400).json({ error: 'not_json' }); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      !Array.isArray(parsed.projects) || !Array.isArray(parsed.people)) {
    return res.status(400).json({ error: 'not_a_board', message: 'That data does not look like a board.' });
  }
  if (role !== 'builder') {
    const problem = store.shapeProblem(parsed);
    if (problem) return res.status(400).json({ error: 'bad_shape', message: problem });
  }
  {
    const mp = money.moneyProblem(parsed);
    if (mp) return res.status(400).json({ error: 'bad_money', message: mp });
  }
  const inRev = parsed.revision;
  if (!Number.isInteger(inRev) || inRev < 0) return res.status(400).json({ error: 'bad_revision' });

  // Compare-and-swap loop: if someone else's save lands between our read and
  // our write, the UPDATE matches 0 rows and we re-evaluate against the new state.
  for (let attempt = 0; attempt < 4; attempt++) {
    const [rows] = await pool.query('SELECT data_json, revision FROM board_data WHERE id = 1');

    if (!rows.length) { // first-ever save
      const { next: first } = store.applyWritePolicy(structuredClone(parsed), {}, role);
      first.revision = 1;
      const st0 = projects.stampBoard({}, first, Date.now());
      try {
        await pool.query('INSERT INTO board_data (id, data_json, revision) VALUES (1, ?, 1)', [JSON.stringify(first)]);
        try { await projects.writeEvents(pool, role, st0.events, Date.now()); } catch (e) { console.error('project log failed', e); }
        return res.json({ revision: 1, stamps: st0.stamps });
      } catch (e) {
        if (e && (e.code === 'ER_DUP_ENTRY' || /UNIQUE|PRIMARY/i.test(String(e.message)))) continue; // someone else inserted first
        throw e;
      }
    }

    const row = rows[0];
    const cur = JSON.parse(row.data_json);

    // Stale-tab protection: the page increments the board's own revision on
    // each save, so a save based on an older copy is refused instead of
    // silently overwriting someone else's newer changes.
    const curRev = Number.isInteger(cur.revision) ? cur.revision : 0;
    if (inRev <= curRev) {
      return res.status(409).json({ error: 'stale_revision', currentRevision: curRev,
        message: 'Someone else saved changes after this page last loaded.' });
    }
    if (inRev > curRev + MAX_REVISION_JUMP) return res.status(400).json({ error: 'bad_revision' });

    const { next, ignoredKeys } = store.applyWritePolicy(structuredClone(parsed), cur, role);
    next.revision = curRev + 1; // the server owns the number; the page adopts the one we return
    const stamped = projects.stampBoard(cur, next, Date.now()); // project IDs, change log rows, work history (server-owned)
    const m = store.measureRemovals(cur, next);
    const removed = store.totalRemoved(m);

    if (role === 'pm') {
      // The PM can add and edit but never remove: any project, crew/sub, skill or
      // phase missing from the save is refused (they use "Request removal" instead).
      if (removed > 0) {
        await audit('save_blocked', req, role, `delete attempt: ${m.projects} projects, ${m.people} people, ${m.skills} skills, ${m.phases} phases`);
        return res.status(422).json({ error: 'blocked_delete', removed: m,
          message: "Deleting projects, crew/subs, skills or phases isn't available with this login. Use \"Request removal\" and the Owner will take care of it." });
      }
      // Still refuse emptying records out without deleting them.
      const why = store.guardReason(m, 'pm', cur, next);
      if (why) {
        await audit('save_blocked', req, role, why);
        return res.status(422).json({ error: 'blocked_mass_delete', message: why, removed: m });
      }
    }
    // Money: every change is archived (below); the PM can void but never remove an entry.
    const md = money.diffMoney(cur, next);
    if (role === 'pm' && md.removedEntries > 0) {
      await audit('save_blocked', req, role, `money delete attempt: ${md.removedEntries} entries`);
      return res.status(422).json({ error: 'blocked_money_delete', removedEntries: md.removedEntries,
        message: "Pay app and proposal entries can't be deleted with this login. Use \"Void\" instead; the entry stays on record, marked void." });
    }
    if (role !== 'builder' && ignoredKeys.length) await audit('unknown_keys', req, role, ignoredKeys.join(',').slice(0, 200));
    // The Owner may delete freely (no guard) - but every deletion is snapshotted below.

    // Copy of what's about to be replaced. Taken whenever anything is being
    // deleted, and on every Builder save (they're rare); otherwise at most one
    // per 10 minutes. Forced copies are rate-limited so they can't flood storage.
    const forced = removed > 0 || role === 'builder';
    await store.writeSnapshot(row.data_json, cur, removed > 0 ? 'pre-delete' : 'auto', role, forced, role === 'builder' ? 10 * 1000 : 30 * 1000);

    const [r] = await pool.query(
      'UPDATE board_data SET data_json = ?, revision = revision + 1 WHERE id = 1 AND revision = ?',
      [JSON.stringify(next), row.revision]);
    if (r.affectedRows === 1) {
      if (md.changes.length) {
        try { await money.writeArchive(pool, role, md.changes); }
        catch (e) { console.error('money archive failed', e); await audit('archive_failed', req, role, String(e && e.message).slice(0, 200)); }
      }
      if (stamped.events.length) {
        try { await projects.writeEvents(pool, role, stamped.events, Date.now()); }
        catch (e) { console.error('project log failed', e); await audit('project_log_failed', req, role, String(e && e.message).slice(0, 200)); }
      }
      return res.json({ revision: next.revision, stamps: stamped.stamps });
    }
  }
  res.status(503).json({ error: 'busy', message: 'The board was busy; please try again.' });
}));

module.exports = router;
