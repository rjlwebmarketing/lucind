const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth, audit, wrap } = require('../lib/auth');
const drive = require('../lib/drive');
const archive = require('../lib/archive');

const pending = new Map();   // OAuth state -> { role, redirect, at }
const page = (title, msg) => '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title><body style="font:16px system-ui;max-width:460px;margin:15vh auto;padding:0 20px;text-align:center"><h2>' + title + '</h2><p>' + msg + '</p><p style="color:#777">You can close this window and go back to the app.</p></body>';
const send = (res, e) => res.status(e.status || 500).json(e.body || { error: 'failed', message: String(e && e.message || e) });

// ---- Drive connection (Builder) -----------------------------------------------------------------------------
router.get('/drive/status', requireAuth('builder', 'owner'), wrap(async (req, res) => {
  const c = await drive.getConnection();
  res.json({ configured: drive.configured(), connected: !!c, email: c ? c.email : '', rootName: c ? c.root_name : drive.DEFAULT_ROOT, connectedAt: c ? Number(c.connected_at) : null, redirectUri: drive.redirectUri(req) });
}));
router.post('/drive/connect-url', requireAuth('builder'), express.json(), wrap(async (req, res) => {
  if (!drive.configured()) return res.status(409).json({ error: 'not_configured', message: 'Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to the Railway variables first.', redirectUri: drive.redirectUri(req) });
  const state = require('crypto').randomBytes(24).toString('hex'), redirect = drive.redirectUri(req);
  for (const [k, v] of pending) if (Date.now() - v.at > 600000) pending.delete(k);
  pending.set(state, { role: req.auth.role, actor: require('../../lib/actor').current(), redirect, at: Date.now(), rootName: String((req.body && req.body.rootName) || '').trim().slice(0, 100) || drive.DEFAULT_ROOT });
  res.json({ url: drive.authUrl(state, redirect) });
}));
router.get('/drive/callback', wrap(async (req, res) => {
  const st = pending.get(String(req.query.state || ''));
  if (!st || Date.now() - st.at > 600000) return res.status(400).send(page('Link expired', 'Start again from the Google Drive Connection screen in the app.'));
  pending.delete(String(req.query.state));
  if (req.query.error) return res.send(page('Not connected', 'Google said: ' + String(req.query.error).replace(/[<>&]/g, '')));
  try {
    const tok = await drive.tokenCall({ grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: st.redirect });
    if (!tok.refresh_token) throw new Error('Google did not return a long-lived permission. Remove the app under your Google account permissions and try again.');
    const about = await (await drive.ctl.fetchImpl('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: 'Bearer ' + tok.access_token } })).json().catch(() => ({}));
    await require('../../lib/actor').runAs(st.actor, () => drive.saveConnection({ refreshToken: tok.refresh_token, email: about.user && about.user.emailAddress, rootName: st.rootName, by: st.role }));
    await drive.ensureRoot();
    await audit('drive_connected', req, st.role, String(about.user && about.user.emailAddress || '').slice(0, 100));
    res.send(page('Archive drive connected', 'Closing packets will be saved in the folder "' + st.rootName.replace(/[<>&]/g, '') + '" in the Google Drive you just chose.'));
  } catch (e) { res.status(500).send(page('Could not connect', String(e.message || e).replace(/[<>&]/g, ''))); }
}));
router.post('/drive/disconnect', requireAuth('builder'), wrap(async (req, res) => { await drive.disconnect(); await audit('drive_disconnected', req, req.auth.role, ''); res.json({ ok: true }); }));
router.post('/drive/test', requireAuth('builder'), wrap(async (req, res) => {
  try {
    const root = await drive.ensureRoot(), year = await drive.yearFolder(new Date().getFullYear());
    const body = Buffer.from('Lucas Industrial archive connection test, ' + new Date().toISOString() + '\n');
    const f = await drive.uploadVerified(year, 'connection test ' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt', 'text/plain', body);
    res.json({ ok: true, name: f.name, link: f.link, rootId: root });
  } catch (e) { res.status(502).json({ error: 'drive_failed', message: String(e.message || e) }); }
}));

// ---- packets --------------------------------------------------------------------------------------------------
router.post('/preview', requireAuth('builder', 'owner'), express.json(), wrap(async (req, res) => {
  try { const r = await archive.preview(String(req.body && req.body.projectId || '')); res.json({ name: r.name, pdfBase64: r.pdf.toString('base64') }); }
  catch (e) { send(res, e); }
}));
router.post('/handoff-pdf', requireAuth('pm', 'owner', 'builder'), express.json(), wrap(async (req, res) => {
  try { const b = req.body || {}; const r = await archive.handoffPdf(String(b.projectId || ''), { name: String(b.toName || '').slice(0, 100), email: String(b.toEmail || '').slice(0, 150) }); res.json({ name: r.name, pdfBase64: r.pdf.toString('base64') }); }
  catch (e) { send(res, e); }
}));
router.post('/close', requireAuth('pm', 'owner', 'builder'), express.json(), wrap(async (req, res) => {
  try {
    const r = await archive.closeProject(String(req.body && req.body.projectId || ''), req.auth.role, req);
    await audit('project_closed', req, req.auth.role, (r.code || '') + ' ' + r.name.slice(0, 150));
    res.json(r.link && req.auth.role === 'pm' ? Object.assign({}, r, { link: '' }) : r);
  } catch (e) { if (!e.status) console.error('close failed', e); send(res, e); }
}));
router.get('/packets', requireAuth('builder', 'owner'), wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT created_at, project_id, project_code, project_name, closed_by, user_name, user_username, pdf_name, pdf_link FROM closed_packets ORDER BY id DESC LIMIT 500');
  res.json({ items: rows.map(r => ({ at: Number(r.created_at), projectId: r.project_id, code: r.project_code, name: r.project_name, by: r.closed_by, byName: require('../../lib/actor').labelOf(r.user_name, r.user_username), file: r.pdf_name, link: r.pdf_link })) });
}));

module.exports = router;
