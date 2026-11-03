const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, wrap } = require('../lib/auth');

// POST /api/suggestions { from, text } — any logged-in role.
// The Owner and PM don't get to see the dev backlog, so "Suggest a change" drops into
// a separate inbox that only the Builder can read; the Builder's page folds it
// into the backlog next time it loads.
const sent = new Map(); // role -> [timestamps]   (limit applies to everyone on that code together)
const MAX_WAITING = 200;
const MAX_SHOT_CHARS = 1400000;   // ~1 MB of image
const SHOT_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+\/]+=*$/;
// The page sends the screenshot with the text, so this route reads a bigger body; it does so only AFTER sign-in.
router.post('/', requireAuth(), express.json({ limit: '2mb' }), wrap(async (req, res) => {
  const text = req.body && typeof req.body.text === 'string' ? req.body.text.trim() : '';
  const from = req.body && typeof req.body.from === 'string' ? req.body.from.trim().slice(0, 100) : '';
  if (!text || text.length > 2000) return res.status(400).json({ error: 'bad_text' });

  const now = Date.now();
  const recent = (sent.get(req.auth.role) || []).filter(t => now - t < 60 * 60 * 1000);
  if (recent.length >= 20) return res.status(429).json({ error: 'too_many_suggestions' });
  const [waiting] = await pool.query('SELECT id FROM suggestions ORDER BY id ASC LIMIT ' + (MAX_WAITING + 1));
  if (waiting.length > MAX_WAITING) return res.status(429).json({ error: 'inbox_full' });
  recent.push(now);
  sent.set(req.auth.role, recent);

  const shot = req.body && req.body.screenshot;
  if (shot !== undefined && shot !== null && shot !== '') {
    if (typeof shot !== 'string' || shot.length > MAX_SHOT_CHARS || !SHOT_RE.test(shot)) return res.status(400).json({ error: 'bad_screenshot' });
  }
  const [ins] = await pool.query('INSERT INTO suggestions (created_at, from_name, body, user_id, user_name, user_username) VALUES (?, ?, ?, ?, ?, ?)', [now, from || null, text].concat(require('../../lib/actor').cols()));
  if (shot) {
    await pool.query('INSERT INTO suggestion_shots (suggestion_id, created_at, image) VALUES (?, ?, ?)', [ins.insertId, now, shot]);
    await pool.query('DELETE FROM suggestion_shots WHERE created_at < ?', [now - 120 * 24 * 60 * 60 * 1000]);   // housekeeping
  }
  res.json({ ok: true });
}));

module.exports = router;
