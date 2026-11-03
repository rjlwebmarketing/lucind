// Controls for the people running the system:
//   Builder + Owner : restore points (view / restore)
//   Builder only    : the suggestion inbox
// (Access codes, sign-everyone-out and the security log now live in the platform's Users & Access / Audit screens.)
// A PM's token gets a 403 (and an audit entry) on every route here.

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { audit, requireAuth, wrap } = require('../lib/auth');
const store = require('../lib/boardStore');

// ---- restore points (Builder + Owner) ---------------------------------------
router.get('/history', requireAuth('builder', 'owner'), wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 200);
  const [rows] = await pool.query(
    `SELECT id, created_at, reason, saved_by, user_id, user_name, user_username, revision, projects_n, people_n, skills_n, bytes
       FROM board_history ORDER BY id DESC LIMIT ${limit}`);
  res.json({ items: rows.map(r => ({
    id: Number(r.id), at: Number(r.created_at), reason: r.reason, savedBy: r.saved_by, savedByName: require('../../lib/actor').labelOf(r.user_name, r.user_username),
    revision: r.revision, projects: r.projects_n, people: r.people_n, skills: r.skills_n, bytes: r.bytes
  })) });
}));

// Replaces the working data (projects, people, skills, etc.) with a restore
// point. Dev backlog, how-tos, architecture, automations and settings are left
// as they are now. The state being replaced is itself saved first, so a
// restore can be undone with another restore.
router.post('/restore', requireAuth('builder', 'owner'), wrap(async (req, res) => {
  const id = Number(req.body && req.body.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'bad_id' });
  const [snaps] = await pool.query('SELECT data_gz, created_at FROM board_history WHERE id = ?', [id]);
  if (!snaps.length) return res.status(404).json({ error: 'no_such_restore_point' });
  const snapObj = store.stripLegacyCodes(JSON.parse(store.readSnapshotJson(snaps[0])));

  for (let attempt = 0; attempt < 4; attempt++) {
    const [rows] = await pool.query('SELECT data_json, revision FROM board_data WHERE id = 1');
    if (!rows.length) return res.status(404).json({ error: 'no_board' });
    const cur = JSON.parse(rows[0].data_json);
    await store.writeSnapshot(rows[0].data_json, cur, 'pre-restore', req.auth.role, true);

    const next = JSON.parse(JSON.stringify(snapObj));
    for (const k of store.BUILDER_ONLY_WRITE) { if (cur[k] !== undefined) next[k] = cur[k]; else delete next[k]; }
    next.settings = cur.settings || next.settings;
    next.revision = (Number(cur.revision) || 0) + 1; // newer than anything any open page holds

    const [r] = await pool.query(
      'UPDATE board_data SET data_json = ?, revision = revision + 1 WHERE id = 1 AND revision = ?',
      [JSON.stringify(next), rows[0].revision]);
    if (r.affectedRows === 1) {
      await audit('restore', req, req.auth.role, `Restored point #${id} from ${new Date(Number(snaps[0].created_at)).toISOString()}`);
      return res.json({ ok: true, revision: next.revision });
    }
  }
  res.status(503).json({ error: 'busy' });
}));

// Suggestion inbox ("Suggest a change" from the Owner and PM lands here).
router.get('/suggestions', requireAuth('builder'), wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id, created_at, from_name, body FROM suggestions ORDER BY id ASC LIMIT 100');
  const [shots] = await pool.query('SELECT suggestion_id FROM suggestion_shots');
  const has = new Set(shots.map(x => Number(x.suggestion_id)));
  res.json({ items: rows.map(r => ({ id: Number(r.id), at: Number(r.created_at), from: r.from_name, text: r.body, shot: has.has(Number(r.id)) })) });
}));
router.get('/suggestion-shot/:id', requireAuth('builder'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  const [rows] = await pool.query('SELECT image FROM suggestion_shots WHERE suggestion_id = ?', [id]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  res.json({ image: rows[0].image });
}));
router.post('/suggestions/ack', requireAuth('builder'), wrap(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (ids.length) {
    await pool.query(`DELETE FROM suggestions WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  res.json({ ok: true });
}));

module.exports = router;
