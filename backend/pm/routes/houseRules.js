const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, audit, wrap } = require('../lib/auth');

// House rules: standing notes the Owner teaches the Assistant ("Aikens means Aikens Steel Erectors").
// Owner and Builder only - the PM has no access to read, add or change them (the server enforces it).
//   GET  /api/house-rules                 list
//   POST /api/house-rules                 { text }            add
//   POST /api/house-rules/:id             { text?, enabled? } edit / turn on or off
//   POST /api/house-rules/:id/delete      remove
const STAFF = ['builder', 'owner'];
const MAX_RULES = 20;
const MAX_LEN = 300;
const changes = new Map(); // role -> timestamps, a ceiling against runaway scripts

function cleanText(t) { return typeof t === 'string' ? t.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() : ''; }
function tooBusy(role) {
  const now = Date.now();
  const recent = (changes.get(role) || []).filter(x => now - x < 60 * 60 * 1000);
  if (recent.length >= 120) return true;
  recent.push(now); changes.set(role, recent); return false;
}
const shape = r => ({ id: r.id, text: r.body, enabled: !!r.enabled, by: r.author_role, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) });

router.get('/', requireAuth(...STAFF), wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id, created_at, updated_at, author_role, body, enabled FROM house_rules ORDER BY id ASC');
  res.json({ items: rows.map(shape), max: MAX_RULES, maxLength: MAX_LEN });
}));

router.post('/', requireAuth(...STAFF), wrap(async (req, res) => {
  if (tooBusy(req.auth.role)) return res.status(429).json({ error: 'too_many_changes' });
  const text = cleanText(req.body && req.body.text);
  if (!text || text.length > MAX_LEN) return res.status(400).json({ error: 'bad_text', message: 'A rule needs 1-' + MAX_LEN + ' characters.' });
  const [rows] = await pool.query('SELECT id FROM house_rules');
  if (rows.length >= MAX_RULES) return res.status(409).json({ error: 'too_many_rules', message: 'There are already ' + MAX_RULES + ' house rules. Remove or merge one first.' });
  const now = Date.now();
  await pool.query('INSERT INTO house_rules (created_at, updated_at, author_role, body, enabled) VALUES (?, ?, ?, ?, 1)', [now, now, req.auth.role, text]);
  await audit('house_rule_add', req, req.auth.role, text.slice(0, 120));
  res.json({ ok: true });
}));

router.post('/:id/delete', requireAuth(...STAFF), wrap(async (req, res) => {
  if (tooBusy(req.auth.role)) return res.status(429).json({ error: 'too_many_changes' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  const [rows] = await pool.query('SELECT body FROM house_rules WHERE id = ?', [id]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  await pool.query('DELETE FROM house_rules WHERE id = ?', [id]);
  await audit('house_rule_del', req, req.auth.role, String(rows[0].body).slice(0, 120));
  res.json({ ok: true });
}));

router.post('/:id', requireAuth(...STAFF), wrap(async (req, res) => {
  if (tooBusy(req.auth.role)) return res.status(429).json({ error: 'too_many_changes' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  const [rows] = await pool.query('SELECT id FROM house_rules WHERE id = ?', [id]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  const sets = [], vals = [];
  if (b.text !== undefined) {
    const text = cleanText(b.text);
    if (!text || text.length > MAX_LEN) return res.status(400).json({ error: 'bad_text', message: 'A rule needs 1-' + MAX_LEN + ' characters.' });
    sets.push('body = ?'); vals.push(text);
  }
  if (b.enabled !== undefined) { sets.push('enabled = ?'); vals.push(b.enabled ? 1 : 0); }
  if (!sets.length) return res.status(400).json({ error: 'nothing_to_change' });
  sets.push('updated_at = ?'); vals.push(Date.now()); vals.push(id);
  await pool.query('UPDATE house_rules SET ' + sets.join(', ') + ' WHERE id = ?', vals);
  await audit('house_rule_edit', req, req.auth.role, 'id ' + id + (b.enabled !== undefined ? (b.enabled ? ' on' : ' off') : ' text'));
  res.json({ ok: true });
}));

module.exports = router;
