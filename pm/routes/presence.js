const express = require('express');
const router = express.Router();
const { requireAuth, wrap } = require('../lib/auth');

// Who is on the board right now, and which record (if any) they have open for editing.
// Kept in memory only: it is a courtesy ("Dana is editing this project"), never a lock,
// so losing it on a restart costs nothing. Entries expire 45 seconds after the last ping.
const TTL_MS = 45 * 1000;
const MAX_ENTRIES = 50;
const seen = new Map(); // clientId -> { name, role, editing, ts }

function clean(s, n) { return typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n) : ''; }

// POST /api/presence { clientId, name, editing: { kind, id, label } | null }
// Returns everyone ELSE who has checked in recently.
router.post('/', requireAuth(), wrap(async (req, res) => {
  const b = req.body || {};
  const clientId = clean(b.clientId, 40);
  if (!clientId) return res.status(400).json({ error: 'bad_client' });
  const now = Date.now();
  for (const [k, v] of seen) if (now - v.ts > TTL_MS) seen.delete(k);
  if (!seen.has(clientId) && seen.size >= MAX_ENTRIES) return res.status(429).json({ error: 'too_many' });

  let editing = null;
  if (b.editing && typeof b.editing === 'object') {
    const kind = b.editing.kind === 'person' ? 'person' : (b.editing.kind === 'project' ? 'project' : '');
    const id = clean(b.editing.id, 60);
    if (kind && id) editing = { kind, id, label: clean(b.editing.label, 80) };
  }
  seen.set(clientId, { name: clean(b.name, 40) || 'Someone', role: req.auth.role, editing, ts: now });

  const others = [];
  for (const [k, v] of seen) {
    if (k === clientId) continue;
    others.push({ name: v.name, role: v.role, editing: v.editing, secondsAgo: Math.round((now - v.ts) / 1000) });
  }
  res.json({ others });
}));

// POST /api/presence/leave { clientId } — tidy exit when a tab closes or someone signs out.
router.post('/leave', requireAuth(), wrap(async (req, res) => {
  const clientId = clean(req.body && req.body.clientId, 40);
  if (clientId) seen.delete(clientId);
  res.json({ ok: true });
}));

module.exports = router;
