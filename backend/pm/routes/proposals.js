// "Submit your proposal" links for invited subcontractors.
//
//   Staff (PM / Owner / Builder, signed in):
//     POST /api/proposals/links           { projectId, inviteId, personId? } -> { linkId, token }   (same sub + project = same link, every time)
//     GET  /api/proposals/submissions     -> everything subs have started / sent / declined
//     POST /api/proposals/handle          { items: [{ linkId, version }] }  -> marks those versions as dealt with
//   Public (no sign-in; the secret link IS the credential):
//     GET  /api/proposals/info?t=TOKEN    -> project details a sub may see + their own saved draft / answer
//     POST /api/proposals/save            { t, data }   keep a draft (as often as they like)
//     POST /api/proposals/submit          { t, data }   send the proposal (can be re-sent / changed until the deadline passes)
//     POST /api/proposals/decline         { t, reason } decline (can be changed back by submitting later)
//     GET  /api/proposals/pdf?t=TOKEN     -> PDF of the project details
//
// Safeguards: the link is derived from a server-side secret (HMAC), so it can be re-sent in a reminder but
// can't be guessed; it works as many times as the sub likes until the proposal deadline plus a short grace
// period, or until the invitation is voided; the public endpoints can read nothing except the allowlisted
// project details (lib/proposalInfo.js — never contract value, customer or contacts); every field is
// validated; rate-limited per address; and nothing a sub types touches the board until staff confirm it.

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, audit, wrap, ipKey } = require('../lib/auth');
const { infoFor } = require('../lib/proposalInfo');
const { buildSubBrief } = require('../lib/packet');

const STAFF = ['builder', 'owner', 'pm'];
const MAX_LINKS = 5000;

// ---- tiny in-memory rate limiter -------------------------------------------
const windows = new Map();
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

// ---- validation -------------------------------------------------------------
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
function str(v, max, multiline) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  let s = v.replace(CTRL, '');
  if (!multiline) s = s.replace(/[\r\n\t]+/g, ' ');
  s = s.trim();
  return s.length > max ? null : s;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+()\-.\sx]{7,40}$/i;
const DATE_RE = /^\d{4}-\d\d-\d\d$/;

// strict=true when actually submitting (price required); drafts accept anything well-formed.
function validateProposal(d, phaseIds, strict) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { error: 'bad_data', message: 'Nothing was sent.' };
  const bad = (field, message) => ({ error: 'bad_field', field, message });
  const v = {};
  for (const [key, max, multi, label] of [['contactName', 100, false, 'Contact name'], ['phone', 40, false, 'Phone'], ['email', 120, false, 'Email'],
      ['included', 2000, true, 'What is included'], ['excluded', 2000, true, 'What is excluded'], ['notes', 2000, true, 'Notes']]) {
    const s = str(d[key], max, multi);
    if (s === null) return bad(key, `${label} is too long or not text.`);
    v[key] = s;
  }
  if (v.email && !EMAIL_RE.test(v.email)) return bad('email', 'That email address does not look right.');
  if (v.phone && !PHONE_RE.test(v.phone)) return bad('phone', 'That phone number does not look right.');
  for (const key of ['validUntil', 'earliestStart']) {
    const s = str(d[key], 10, false);
    if (s === null || (s && !DATE_RE.test(s))) return bad(key, 'Please pick a date.');
    v[key] = s;
  }
  const rows = d.prices === undefined ? [] : d.prices;
  if (!Array.isArray(rows) || rows.length > 40) return bad('prices', 'Prices were not understood.');
  v.prices = [];
  const seen = new Set();
  for (const r of rows) {
    if (!r || typeof r !== 'object') return bad('prices', 'Prices were not understood.');
    const ph = str(r.phaseId, 64, false);
    if (ph === null || (ph && !phaseIds.includes(ph))) return bad('prices', 'Unknown phase.');
    if (r.price === '' || r.price === null || r.price === undefined) continue;
    const n = Number(typeof r.price === 'string' ? r.price.replace(/[$,\s]/g, '') : r.price);
    if (!Number.isFinite(n) || n <= 0 || n > 1e9) return bad('prices', 'Each price should be a positive amount.');
    if (seen.has(ph)) return bad('prices', 'A price was listed twice.');
    seen.add(ph);
    v.prices.push({ phaseId: ph, price: Math.round(n * 100) / 100 });
  }
  if (strict) {
    if (!v.prices.length) return bad('prices', 'Please enter your price.');
    if (!v.contactName) return bad('contactName', 'Please enter your name.');
    if (!v.phone && !v.email) return bad('phone', 'Please give a phone number or an email address.');
  }
  return { value: v };
}

// ---- links ------------------------------------------------------------------
let keyCache = null;
async function linkKey() {
  if (keyCache) return keyCache;
  const get = async () => { const [r] = await pool.query("SELECT value FROM app_secrets WHERE name = 'proposal_link_key'"); return r.length ? r[0].value : null; };
  let k = await get();
  if (!k) { try { await pool.query("INSERT INTO app_secrets (name, value) VALUES ('proposal_link_key', ?)", [crypto.randomBytes(32).toString('hex')]); } catch (e) {} k = await get(); }
  if (!k) throw new Error('no link key');
  return (keyCache = k);
}
async function tokenFor(linkId) {
  const mac = crypto.createHmac('sha256', await linkKey()).update('proposal-link:' + linkId).digest('base64url').slice(0, 32);
  return linkId + '.' + mac;
}
async function linkFromToken(t) {
  if (typeof t !== 'string' || t.length < 10 || t.length > 80) return null;
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{32})$/.exec(t); if (!m) return null;
  const good = await tokenFor(m[1]);
  const a = Buffer.from(good), b = Buffer.from(t);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [rows] = await pool.query('SELECT id, project_id, invite_id, person_id FROM proposal_links WHERE id = ?', [Number(m[1])]);
  return rows.length ? rows[0] : null;
}

async function loadBoard() {
  const [rows] = await pool.query('SELECT data_json FROM board_data WHERE id = 1');
  try { return rows.length ? JSON.parse(rows[0].data_json) : {}; } catch (e) { return {}; }
}
const j = s => { try { return JSON.parse(s); } catch (e) { return null; } };
const shape = r => ({ linkId: Number(r.link_id), status: r.status, version: Number(r.version), handledVersion: Number(r.handled_version), updatedAt: Number(r.updated_at), submittedAt: r.submitted_at ? Number(r.submitted_at) : null, data: j(r.data_json) || {} });

// ---- staff ------------------------------------------------------------------
router.post('/links', requireAuth(...STAFF), wrap(async (req, res) => {
  const b = req.body || {};
  const projectId = str(b.projectId, 64, false), inviteId = str(b.inviteId, 64, false), personId = str(b.personId, 64, false);
  if (!projectId || !inviteId || personId === null) return res.status(400).json({ error: 'bad_request' });
  if (!hit('mklink', req.auth.role, 300, 60 * 60 * 1000)) return res.status(429).json({ error: 'too_many_links' });
  const board = await loadBoard();
  if (!infoFor(board, projectId, inviteId, Date.now())) return res.status(404).json({ error: 'no_such_invitation' });
  let [rows] = await pool.query('SELECT id FROM proposal_links WHERE project_id = ? AND invite_id = ?', [projectId, inviteId]);
  if (!rows.length) {
    const [all] = await pool.query('SELECT id FROM proposal_links LIMIT ' + (MAX_LINKS + 1));
    if (all.length > MAX_LINKS) return res.status(429).json({ error: 'too_many_links' });
    try { await pool.query('INSERT INTO proposal_links (project_id, invite_id, person_id, created_at, created_by) VALUES (?, ?, ?, ?, ?)', [projectId, inviteId, personId || null, Date.now(), req.auth.role]); } catch (e) {}
    [rows] = await pool.query('SELECT id FROM proposal_links WHERE project_id = ? AND invite_id = ?', [projectId, inviteId]);
  }
  const linkId = Number(rows[0].id);
  res.json({ linkId, token: await tokenFor(linkId) });
}));

// Same as POST /links but for many invitations at once (the invitation e-mail screen).
router.post('/links/batch', requireAuth(...STAFF), wrap(async (req, res) => {
  const b = req.body || {};
  const projectId = str(b.projectId, 64, false);
  const items = Array.isArray(b.items) ? b.items.slice(0, 60) : null;
  if (!projectId || !items) return res.status(400).json({ error: 'bad_request' });
  if (!hit('mklink', req.auth.role, 300, 60 * 60 * 1000)) return res.status(429).json({ error: 'too_many_links' });
  const board = await loadBoard(), out = [];
  for (const it of items) {
    const inviteId = str(it && it.inviteId, 64, false), personId = str(it && it.personId, 64, false);
    if (!inviteId || personId === null || !infoFor(board, projectId, inviteId, Date.now())) { out.push({ inviteId, error: 'no_such_invitation' }); continue; }
    let [rows] = await pool.query('SELECT id FROM proposal_links WHERE project_id = ? AND invite_id = ?', [projectId, inviteId]);
    if (!rows.length) {
      try { await pool.query('INSERT INTO proposal_links (project_id, invite_id, person_id, created_at, created_by) VALUES (?, ?, ?, ?, ?)', [projectId, inviteId, personId || null, Date.now(), req.auth.role]); } catch (e) {}
      [rows] = await pool.query('SELECT id FROM proposal_links WHERE project_id = ? AND invite_id = ?', [projectId, inviteId]);
    }
    const linkId = Number(rows[0].id);
    out.push({ inviteId, linkId, token: await tokenFor(linkId) });
  }
  res.json({ items: out });
}));

router.get('/submissions', requireAuth(...STAFF), wrap(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT s.link_id, s.status, s.version, s.handled_version, s.updated_at, s.submitted_at, s.data_json, l.project_id, l.invite_id, l.person_id, l.last_opened_at, l.open_count ' +
    'FROM proposal_submissions s JOIN proposal_links l ON l.id = s.link_id ORDER BY s.updated_at DESC LIMIT 500');
  const [opened] = await pool.query('SELECT id, project_id, invite_id, person_id, last_opened_at, open_count FROM proposal_links WHERE open_count > 0 ORDER BY last_opened_at DESC LIMIT 500');
  const items = rows.map(r => Object.assign(shape(r), { projectId: r.project_id, inviteId: r.invite_id, personId: r.person_id || '', lastOpenedAt: r.last_opened_at ? Number(r.last_opened_at) : null, openCount: Number(r.open_count) }));
  const views = opened.map(r => ({ linkId: Number(r.id), projectId: r.project_id, inviteId: r.invite_id, personId: r.person_id || '', lastOpenedAt: Number(r.last_opened_at), openCount: Number(r.open_count) }));
  res.json({ items, views });
}));

router.post('/handle', requireAuth(...STAFF), wrap(async (req, res) => {
  const items = Array.isArray(req.body && req.body.items) ? req.body.items.slice(0, 100) : [];
  let n = 0;
  for (const it of items) {
    const id = Number(it && it.linkId), ver = Number(it && it.version);
    if (!Number.isInteger(id) || !Number.isInteger(ver)) continue;
    const [r] = await pool.query('UPDATE proposal_submissions SET handled_version = ? WHERE link_id = ? AND handled_version < ? AND version >= ?', [ver, id, ver, ver]);
    n += r.affectedRows || 0;
  }
  if (n) await audit('proposal_handled', req, req.auth.role, `${n} sub proposal response(s) reviewed`);
  res.json({ ok: true });
}));

// ---- public -----------------------------------------------------------------
// Resolves a token to the live link, the project info, and whether answers are still accepted.
async function resolve(req, res, t, rateName, max) {
  if (!hit(rateName, ipKey(req.ip), max, 60 * 60 * 1000)) { res.status(429).json({ error: 'too_many_requests' }); return null; }
  const link = await linkFromToken(t);
  if (!link) { res.status(404).json({ error: 'invalid_link' }); return null; }
  const board = await loadBoard();
  const info = infoFor(board, link.project_id, link.invite_id, Date.now());
  if (!info) { res.status(410).json({ error: 'withdrawn' }); return null; }
  return { link, info };
}

router.get('/info', wrap(async (req, res) => {
  const r = await resolve(req, res, req.query && req.query.t, 'pinfo', 120); if (!r) return;
  await pool.query('UPDATE proposal_links SET last_opened_at = ?, open_count = open_count + 1 WHERE id = ?', [Date.now(), r.link.id]);
  const [rows] = await pool.query('SELECT link_id, status, version, handled_version, updated_at, submitted_at, data_json FROM proposal_submissions WHERE link_id = ?', [r.link.id]);
  const mine = rows.length ? shape(rows[0]) : null;
  // The sub's own answer, minus staff bookkeeping.
  res.json({ project: r.info.project, closed: r.info.closed, pastDue: r.info.pastDue, mine: mine ? { status: mine.status, updatedAt: mine.updatedAt, submittedAt: mine.submittedAt, data: mine.data } : null });
}));

async function store(req, res, status) {
  const body = req.body || {};
  const r = await resolve(req, res, body.t, 'pwrite', 60); if (!r) return;
  if (r.info.closed) return res.status(410).json({ error: 'closed', reason: r.info.closed });
  // Honeypot
  if (body.data && typeof body.data === 'object' && typeof body.data.hp === 'string' && body.data.hp.trim()) return res.json({ ok: true });
  const phaseIds = r.info.project.phases.map(p => p.id).concat(['']);
  let data;
  if (status === 'declined') {
    const reason = str(body.reason, 1000, true);
    if (reason === null) return res.status(400).json({ error: 'bad_field', field: 'reason', message: 'That note is too long.' });
    data = { reason };
  } else {
    const checked = validateProposal(body.data, phaseIds, status === 'submitted');
    if (checked.error) return res.status(400).json(checked);
    data = checked.value;
  }
  const now = Date.now();
  const [rows] = await pool.query('SELECT version, status, data_json FROM proposal_submissions WHERE link_id = ?', [r.link.id]);
  if (!rows.length) {
    await pool.query('INSERT INTO proposal_submissions (link_id, status, version, handled_version, updated_at, submitted_at, ip, data_json) VALUES (?, ?, 1, 0, ?, ?, ?, ?)',
      [r.link.id, status, now, status === 'draft' ? null : now, String(req.ip || '').slice(0, 64), JSON.stringify(data)]);
  } else {
    // A draft saved after a sent proposal must not overwrite what staff are looking at: keep the sent
    // answer and its status, and keep the new work as a draft inside the same record.
    const cur = rows[0];
    if (status === 'draft' && cur.status !== 'draft') {
      const merged = j(cur.data_json) || {}; merged.draft = data;
      await pool.query('UPDATE proposal_submissions SET data_json = ?, updated_at = ? WHERE link_id = ?', [JSON.stringify(merged), now, r.link.id]);
    } else {
      await pool.query('UPDATE proposal_submissions SET status = ?, version = version + 1, updated_at = ?, submitted_at = ?, ip = ?, data_json = ? WHERE link_id = ?',
        [status, now, status === 'draft' ? null : now, String(req.ip || '').slice(0, 64), JSON.stringify(data), r.link.id]);
    }
  }
  if (status !== 'draft') await audit('proposal_' + status, req, null, `${r.info.project.name} (sub link ${r.link.id})`.slice(0, 200));
  res.json({ ok: true, status, savedAt: now });
}
router.post('/save', wrap((req, res) => store(req, res, 'draft')));
router.post('/submit', wrap((req, res) => store(req, res, 'submitted')));
router.post('/decline', wrap((req, res) => store(req, res, 'declined')));

router.get('/pdf', wrap(async (req, res) => {
  const r = await resolve(req, res, req.query && req.query.t, 'ppdf', 40); if (!r) return;
  const b = r.info.project.dueAt ? new Date(r.info.project.dueAt) : null;
  const dueText = b && Number.isFinite(b.getTime()) ? b.toLocaleString('en-US', { timeZone: process.env.PACKET_TZ || 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) : '';
  const out = await buildSubBrief(r.info.project, { generatedAt: Date.now(), dueText });
  res.set('Content-Type', 'application/pdf').set('Content-Disposition', 'attachment; filename="' + out.name.replace(/"/g, '') + '"').send(out.pdf);
}));

router._validate = validateProposal; // for tests
module.exports = router;
