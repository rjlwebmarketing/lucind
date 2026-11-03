// The archive drive: a server-side Google Drive connection used ONLY for closing packets.
// Separate from the page's read-only "Check Drive Folders" connection. The Builder signs in to Google once
// (Google Drive Connection screen); the server keeps a refresh token (encrypted) so closing a project works for
// any login without a Google pop-up. The scope is drive.file: the app can only see files and folders it created.
//
// Railway variables needed:  GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET   (optional: DRIVE_TOKEN_KEY, PUBLIC_BACKEND_URL)
// Redirect URI to register in Google Cloud:  <backend URL>/api/archive/drive/callback

const crypto = require('crypto');
const pool = require('../config/db');

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DEFAULT_ROOT = 'Lucas Industrial Archive';
const ctl = { fetchImpl: (...a) => fetch(...a) };   // tests replace this

const clientId = () => process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const clientSecret = () => process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const configured = () => !!(clientId() && clientSecret());

function key() { return crypto.createHash('sha256').update(process.env.DRIVE_TOKEN_KEY || clientSecret() || 'no-key').digest(); }
function enc(text) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv); const body = Buffer.concat([c.update(text, 'utf8'), c.final()]); return [iv, c.getAuthTag(), body].map(b => b.toString('base64')).join('.'); }
function dec(blob) { const [iv, tag, body] = String(blob).split('.').map(x => Buffer.from(x, 'base64')); const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(body), d.final()]).toString('utf8'); }

function redirectUri(req) {
  const base = process.env.PUBLIC_BACKEND_URL || (req.protocol + '://' + req.get('host'));
  return base.replace(/\/+$/, '') + '/api/archive/drive/callback';
}
function authUrl(state, redirect) {
  const q = new URLSearchParams({ client_id: clientId(), redirect_uri: redirect, response_type: 'code', scope: SCOPE + ' https://www.googleapis.com/auth/userinfo.email', access_type: 'offline', prompt: 'consent', state, include_granted_scopes: 'true' });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
}
async function tokenCall(params) {
  const res = await ctl.fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.assign({ client_id: clientId(), client_secret: clientSecret() }, params)).toString() });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error('Google said: ' + (j.error_description || j.error || res.status));
  return j;
}

// ---- stored connection ------------------------------------------------------------------------------------
async function getConnection() { const [rows] = await pool.query('SELECT * FROM drive_connection WHERE id = 1'); return rows[0] || null; }
async function saveConnection(c) {
  await pool.query('DELETE FROM drive_connection WHERE id = 1');
  await pool.query('INSERT INTO drive_connection (id, refresh_enc, email, root_folder_id, root_name, connected_at, connected_by) VALUES (1, ?, ?, ?, ?, ?, ?)',
    [enc(c.refreshToken), c.email || '', c.rootFolderId || '', c.rootName || DEFAULT_ROOT, Date.now(), c.by || '']);
}
async function disconnect() { await pool.query('DELETE FROM drive_connection WHERE id = 1'); }

let cached = { token: '', exp: 0 };
async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const c = await getConnection(); if (!c) throw new Error('The archive drive is not connected.');
  const j = await tokenCall({ grant_type: 'refresh_token', refresh_token: dec(c.refresh_enc) });
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}
async function api(path, opts = {}) {
  const t = await accessToken();
  const res = await ctl.fetchImpl(path, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {}) }));
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error('Google Drive: ' + ((j.error && (j.error.message || j.error)) || res.status));
  return j;
}
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findFolder(name, parentId) {
  const q = "name='" + esc(name) + "' and mimeType='application/vnd.google-apps.folder' and trashed=false" + (parentId ? " and '" + esc(parentId) + "' in parents" : '');
  const j = await api('https://www.googleapis.com/drive/v3/files?fields=files(id,name)&pageSize=5&q=' + encodeURIComponent(q));
  return (j.files || [])[0] || null;
}
async function createFolder(name, parentId) {
  return api('https://www.googleapis.com/drive/v3/files?fields=id,name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ name, mimeType: 'application/vnd.google-apps.folder' }, parentId ? { parents: [parentId] } : {})) });
}
async function ensureFolder(name, parentId) { return (await findFolder(name, parentId)) || (await createFolder(name, parentId)); }

// Uploads and then reads the file back from Drive, comparing size and MD5. Throws unless it really is there, intact.
async function uploadVerified(parentId, name, mime, buffer) {
  const boundary = 'lucas' + crypto.randomBytes(8).toString('hex');
  const head = Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name, parents: [parentId] }) + '\r\n--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n');
  const body = Buffer.concat([head, buffer, Buffer.from('\r\n--' + boundary + '--')]);
  const made = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
  const back = await api('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(made.id) + '?fields=id,name,size,md5Checksum,webViewLink,trashed,parents');
  const md5 = crypto.createHash('md5').update(buffer).digest('hex');
  if (back.trashed || String(back.size) !== String(buffer.length) || (back.md5Checksum && back.md5Checksum !== md5)) throw new Error('Drive could not confirm the uploaded file "' + name + '" (size/checksum mismatch).');
  return { id: back.id, name: back.name, link: back.webViewLink || '', size: buffer.length, md5 };
}

async function ensureRoot() {
  const c = await getConnection(); if (!c) throw new Error('The archive drive is not connected.');
  if (c.root_folder_id) { try { await api('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(c.root_folder_id) + '?fields=id,trashed').then(f => { if (f.trashed) throw new Error('trashed'); }); return c.root_folder_id; } catch (e) { /* recreate below */ } }
  const f = await ensureFolder(c.root_name || DEFAULT_ROOT, null);
  await pool.query('UPDATE drive_connection SET root_folder_id = ? WHERE id = 1', [f.id]);
  return f.id;
}
async function yearFolder(year) { const root = await ensureRoot(); return (await ensureFolder(String(year), root)).id; }

module.exports = { ctl, configured, redirectUri, authUrl, tokenCall, getConnection, saveConnection, disconnect, accessToken, api, ensureRoot, yearFolder, uploadVerified, DEFAULT_ROOT, SCOPE, enc, dec };
