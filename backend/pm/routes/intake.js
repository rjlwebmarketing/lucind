// "Complete your profile" links for W-2 employees and subcontractors.
//
//   Staff (Builder / Owner, signed in — not the PM):
//     POST /api/intake/invites           { kind: 'w2'|'sub', name?, email? } -> { token, expiresAt }
//     GET  /api/intake/submissions       -> waiting submissions
//     POST /api/intake/submissions/dismiss { ids: [...] }
//   Public (no sign-in — the secret link IS the credential):
//     GET  /api/intake/form?t=TOKEN      -> what to show (kind, skills list)
//     POST /api/intake/submit            { t, data }
//
// Safeguards: tokens are 192 random bits, stored hashed, expire in 14 days and
// work once; the public endpoints can read nothing from the board except the
// skills list; every field is validated against an allowlist and length limits;
// per-address rate limits; a cap on how many submissions can wait; and a
// submission never touches the board — staff review it first.

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, audit, wrap, sha256, ipKey } = require('../lib/auth');

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PENDING_INVITES = 500;
const MAX_WAITING_SUBMISSIONS = 300;
const STAFF = ['builder', 'owner']; // the PM can't send links or see/add submissions

// ---- tiny in-memory rate limiter ------------------------------------------
const windows = new Map(); // name:key -> [timestamps]
function hit(name, key, max, windowMs) {
  const now = Date.now(), k = name + ':' + key;
  const list = (windows.get(k) || []).filter(t => now - t < windowMs);
  if (list.length >= max) { windows.set(k, list); return false; }
  list.push(now); windows.set(k, list); return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, l] of windows) { const f = l.filter(t => now - t < 60 * 60 * 1000); f.length ? windows.set(k, f) : windows.delete(k); }
}, 10 * 60 * 1000).unref();

// ---- field validation -----------------------------------------------------
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
function str(v, max, multiline) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null; // wrong type
  let s = v.replace(CTRL, '');
  if (!multiline) s = s.replace(/[\r\n\t]+/g, ' ');
  s = s.trim();
  return s.length > max ? null : s;
}
function intIn(v, lo, hi, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+()\-.\sx]{7,40}$/i;

// Returns { value } or { error, message }.
function validateSubmission(kind, d, knownSkills) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { error: 'bad_data', message: 'Nothing was submitted.' };
  const bad = (field, message) => ({ error: 'bad_field', field, message });
  const v = { kind };
  const fields = kind === 'sub'
    ? [['name', 120, false, 'Company name'], ['contactName', 100, false, 'Contact name'], ['email', 120, false, 'Email'], ['phone', 40, false, 'Phone'],
       ['website', 200, false, 'Website'], ['address', 200, false, 'Address'], ['docLinks', 400, true, 'Document links'], ['notes', 1000, true, 'Notes']]
    : [['name', 120, false, 'Name'], ['email', 120, false, 'Email'], ['phone', 40, false, 'Phone'], ['notes', 1000, true, 'Notes']];
  for (const [key, max, multi, label] of fields) {
    const s = str(d[key], max, multi);
    if (s === null) return bad(key, `${label} is too long or not text.`);
    v[key] = s;
  }
  if (!v.name) return bad('name', kind === 'sub' ? 'Please enter your company name.' : 'Please enter your name.');
  if (v.email && !EMAIL_RE.test(v.email)) return bad('email', 'That email address does not look right.');
  if (v.phone && !PHONE_RE.test(v.phone)) return bad('phone', 'That phone number does not look right.');
  if (!v.email && !v.phone) return bad('phone', 'Please give at least a phone number or an email address.');
  if (kind === 'sub') {
    if (!v.address) return bad('address', 'Please enter your business address (street, city, state).');
    v.teamSize = intIn(d.teamSize, 1, 500, 1);
    v.crewsAvailable = intIn(d.crewsAvailable, 1, 100, 1);
    if (v.teamSize === null) return bad('teamSize', 'Team size should be a whole number.');
    if (v.crewsAvailable === null) return bad('crewsAvailable', 'Crews available should be a whole number.');
  }
  // Skills: array of short strings; keep only ones the board actually knows, when known.
  let skills = d.skills === undefined ? [] : d.skills;
  if (!Array.isArray(skills) || skills.length > 60) return bad('skills', 'Skills were not understood.');
  const out = [];
  for (const sk of skills) {
    const s = str(sk, 60, false);
    if (s === null) return bad('skills', 'Skills were not understood.');
    if (s && !out.includes(s) && (!knownSkills || knownSkills.includes(s))) out.push(s);
  }
  v.skills = out;
  return { value: v };
}

// The skills list the form offers (cached: it's read from the whole board document).
let skillsCache = { at: 0, list: [] };
async function liveSkills() {
  if (Date.now() - skillsCache.at < 5 * 60 * 1000) return skillsCache.list;
  try {
    const [rows] = await pool.query('SELECT data_json FROM board_data WHERE id = 1');
    const obj = rows.length ? JSON.parse(rows[0].data_json) : {};
    skillsCache = { at: Date.now(), list: (Array.isArray(obj.skills) ? obj.skills : []).filter(x => typeof x === 'string').slice(0, 100) };
  } catch (e) { skillsCache = { at: Date.now(), list: skillsCache.list }; }
  return skillsCache.list;
}

async function findInvite(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const [rows] = await pool.query('SELECT id, kind, name_hint, expires_at, used_at FROM intake_invites WHERE token_hash = ?', [sha256(token)]);
  return rows.length ? rows[0] : null;
}

// ---- staff ----------------------------------------------------------------
router.post('/invites', requireAuth(...STAFF), wrap(async (req, res) => {
  const kind = req.body && req.body.kind;
  if (kind !== 'w2' && kind !== 'sub') return res.status(400).json({ error: 'bad_kind' });
  const name = str(req.body.name, 100, false), email = str(req.body.email, 120, false);
  if (name === null || email === null) return res.status(400).json({ error: 'bad_request' });
  if (!hit('invite', req.auth.role, 60, 60 * 60 * 1000)) return res.status(429).json({ error: 'too_many_invites' });
  const now = Date.now();
  const [open] = await pool.query('SELECT id FROM intake_invites WHERE used_at IS NULL AND expires_at > ? LIMIT ' + (MAX_PENDING_INVITES + 1), [now]);
  if (open.length > MAX_PENDING_INVITES) return res.status(429).json({ error: 'too_many_open_invites' });
  // Housekeeping: drop invites that expired more than 30 days ago.
  await pool.query('DELETE FROM intake_invites WHERE expires_at < ?', [now - 30 * 24 * 60 * 60 * 1000]);

  const token = crypto.randomBytes(24).toString('base64url');
  await pool.query(
    'INSERT INTO intake_invites (token_hash, kind, name_hint, email_hint, created_at, expires_at, created_by, user_id, user_name, user_username) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [sha256(token), kind, name || null, email || null, now, now + INVITE_TTL_MS, req.auth.role].concat(require('../../lib/actor').cols()));
  await audit('invite_created', req, req.auth.role, `${kind}${name ? ' for ' + name : ''}`);
  res.json({ token, expiresAt: now + INVITE_TTL_MS });
}));

router.get('/submissions', requireAuth(...STAFF), wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id, created_at, kind, data_json FROM intake_submissions ORDER BY id ASC LIMIT 200');
  const items = [];
  for (const r of rows) {
    let data = null; try { data = JSON.parse(r.data_json); } catch (e) {}
    if (data) items.push({ id: Number(r.id), at: Number(r.created_at), kind: r.kind, data });
  }
  res.json({ items });
}));

router.post('/submissions/dismiss', requireAuth(...STAFF), wrap(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (ids.length) {
    await pool.query(`DELETE FROM intake_submissions WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    await audit('intake_dismissed', req, req.auth.role, `${ids.length} submission(s) reviewed`);
    const [left] = await pool.query('SELECT id FROM intake_submissions LIMIT 1'); if(!left.length) await require('../../lib/notify').resolveKind('profile_submitted');
  }
  res.json({ ok: true });
}));

// ---- public -----------------------------------------------------------------
router.get('/form', wrap(async (req, res) => {
  if (!hit('form', ipKey(req.ip), 60, 60 * 60 * 1000)) return res.status(429).json({ error: 'too_many_requests' });
  const inv = await findInvite(req.query && req.query.t);
  if (!inv) return res.status(404).json({ error: 'invalid_link' });
  if (inv.used_at) return res.status(410).json({ error: 'link_used' });
  if (Number(inv.expires_at) < Date.now()) return res.status(410).json({ error: 'link_expired' });
  res.json({ kind: inv.kind, nameHint: inv.name_hint || '', skills: await liveSkills() });
}));

router.post('/submit', wrap(async (req, res) => {
  const ip = ipKey(req.ip);
  if (!hit('submit', ip, 15, 60 * 60 * 1000)) return res.status(429).json({ error: 'too_many_requests' });
  const body = req.body || {};
  const inv = await findInvite(body.t);
  if (!inv) return res.status(404).json({ error: 'invalid_link' });
  if (inv.used_at) return res.status(410).json({ error: 'link_used' });
  if (Number(inv.expires_at) < Date.now()) return res.status(410).json({ error: 'link_expired' });

  // Honeypot: a field real people never see. Bots that fill it get a normal-looking
  // "thanks" and nothing is stored.
  if (typeof body.data === 'object' && body.data && typeof body.data.hp === 'string' && body.data.hp.trim()) {
    return res.json({ ok: true });
  }
  const checked = validateSubmission(inv.kind, body.data, await liveSkills().then(l => l.length ? l : null));
  if (checked.error) return res.status(400).json(checked);

  const [waiting] = await pool.query('SELECT id FROM intake_submissions LIMIT ' + (MAX_WAITING_SUBMISSIONS + 1));
  if (waiting.length > MAX_WAITING_SUBMISSIONS) return res.status(429).json({ error: 'inbox_full' });

  // Claim the link atomically so two quick submits can't both succeed.
  const [claim] = await pool.query('UPDATE intake_invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?', [Date.now(), inv.id, Date.now()]);
  if (claim.affectedRows !== 1) return res.status(410).json({ error: 'link_used' });
  try {
    await pool.query('INSERT INTO intake_submissions (created_at, kind, invite_id, ip, data_json) VALUES (?, ?, ?, ?, ?)',
      [Date.now(), inv.kind, inv.id, String(req.ip || '').slice(0, 64), JSON.stringify(checked.value)]);
  } catch (e) {
    await pool.query('UPDATE intake_invites SET used_at = NULL WHERE id = ?', [inv.id]); // let them try again
    throw e;
  }
  await audit('intake_submitted', req, null, `${inv.kind}: ${checked.value.name}`.slice(0, 200));
  require('../../lib/notify').notify({ kind: 'profile_submitted', toPane: 'pm.people', route: '/pm?view=people', text: String(checked.value.name || 'Someone') + ' filled in their ' + (inv.kind === 'sub' ? 'subcontractor' : 'crew') + ' profile' });
  res.json({ ok: true });
}));

module.exports = router;
