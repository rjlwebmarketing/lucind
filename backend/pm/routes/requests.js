const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, audit, wrap } = require('../lib/auth');

// Requests that need a decision from the Owner — today, "please remove this"
// from a PM (who can't delete anything themselves).
//   POST /api/requests        any signed-in role   { kind: 'removal', text }
//   GET  /api/requests        Owner + Builder
//   POST /api/requests/ack    Owner + Builder      { ids: [...] }  (dismiss)
const KINDS = ['removal'];
const MAX_WAITING = 200;
const sent = new Map(); // role -> [timestamps] (limit applies to everyone using that code together)

router.post('/', requireAuth(), wrap(async (req, res) => {
  const kind = req.body && req.body.kind;
  const text = req.body && typeof req.body.text === 'string' ? req.body.text.trim() : '';
  const from = req.body && typeof req.body.from === 'string' ? req.body.from.trim().slice(0, 100) : '';
  if (!KINDS.includes(kind) || !text || text.length > 2000) return res.status(400).json({ error: 'bad_request' });

  const now = Date.now();
  const recent = (sent.get(req.auth.role) || []).filter(t => now - t < 60 * 60 * 1000);
  if (recent.length >= 60) return res.status(429).json({ error: 'too_many_requests' });
  const [waiting] = await pool.query('SELECT id FROM requests ORDER BY id ASC LIMIT ' + (MAX_WAITING + 1));
  if (waiting.length > MAX_WAITING) return res.status(429).json({ error: 'inbox_full' });
  recent.push(now);
  sent.set(req.auth.role, recent);

  await pool.query('INSERT INTO requests (created_at, kind, from_role, from_name, body, user_id, user_name, user_username) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [now, kind, req.auth.role, from || null, text].concat(require('../../lib/actor').cols()));
  res.json({ ok: true });
}));

router.get('/', requireAuth('owner', 'builder'), wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id, created_at, kind, from_role, from_name, user_name, user_username, body FROM requests ORDER BY id ASC LIMIT 200');
  res.json({ items: rows.map(r => ({ id: Number(r.id), at: Number(r.created_at), kind: r.kind, role: r.from_role, from: r.from_name, byName: require('../../lib/actor').labelOf(r.user_name, r.user_username), text: r.body })) });
}));

router.post('/ack', requireAuth('owner', 'builder'), wrap(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (ids.length) {
    await pool.query(`DELETE FROM requests WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    await audit('requests_dismissed', req, req.auth.role, `${ids.length} request(s) dismissed`);
  }
  res.json({ ok: true });
}));

module.exports = router;
