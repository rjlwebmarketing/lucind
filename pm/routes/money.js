const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, wrap } = require('../lib/auth');

// The money change archive: every changed, added, voided or removed money value, with the old
// value, the new value, which login saved it and when. Owner and Builder only; the PM cannot read it.
//   GET /api/money/archive?limit=200&before=<id>&project=<projectId>
router.get('/archive', requireAuth('builder', 'owner'), wrap(async (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
  const before = parseInt(req.query.before, 10);
  const project = typeof req.query.project === 'string' ? req.query.project.slice(0, 64) : '';
  const where = [], params = [];
  if (Number.isFinite(before)) { where.push('id < ?'); params.push(before); }
  if (project) { where.push('project_id = ?'); params.push(project); }
  const [rows] = await pool.query(
    'SELECT id, created_at, role, project_id, project_name, path, kind, old_value, new_value FROM money_archive' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC LIMIT ' + limit, params);
  res.json({ items: rows.map(r => ({ id: Number(r.id), at: Number(r.created_at), by: r.role, projectId: r.project_id, project: r.project_name,
    path: r.path, kind: r.kind, oldValue: r.old_value, newValue: r.new_value })) });
}));

// The change log for everything on a project that is not money. Owner and Builder only.
//   GET /api/money/project-log?project=<projectId>&limit=300
router.get('/project-log', requireAuth('builder', 'owner'), wrap(async (req, res) => {
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 300));
  const project = typeof req.query.project === 'string' ? req.query.project.slice(0, 64) : '';
  const [rows] = await pool.query(
    'SELECT id, created_at, role, project_id, project_code, project_name, field, kind, old_value, new_value FROM project_events' +
    (project ? ' WHERE project_id = ?' : '') + ' ORDER BY id DESC LIMIT ' + limit, project ? [project] : []);
  res.json({ items: rows.map(r => ({ id: Number(r.id), at: Number(r.created_at), by: r.role, projectId: r.project_id, code: r.project_code,
    project: r.project_name, field: r.field, kind: r.kind, oldValue: r.old_value, newValue: r.new_value })) });
}));

module.exports = router;
