// Compatibility layer: the PM routes were written against a code-based login that only knew three roles
// (builder / owner / pm). This keeps their code unchanged but backs it with the platform's real users:
//   - who is calling comes from the platform session (Bearer token),
//   - the legacy role is derived: Builder -> 'builder', Owner -> 'owner', everyone else -> 'pm'
//     (so wage/price hiding in boardStore keeps working exactly as before),
//   - and each call must also pass the platform's pane permission for that part of PM (PANE_BY_PREFIX).
const crypto = require('crypto');
const platform = require('../../lib/auth');
const { lvl } = require('../../lib/catalog');
const platformAudit = require('../../lib/audit').audit;
const actor = require('../../lib/actor');

// URL prefix (after /pm/api) -> the pane that gates it. Anything not listed is refused to non-Builders.
const PANE_BY_PREFIX = {
  '/data': 'pm.projects', '/ai': 'pm.logistics_ai', '/admin': 'pm.projects',
  '/suggestions': 'pm.projects', '/requests': 'pm.projects', '/presence': 'pm.projects', '/house-rules': 'pm.projects',
  '/intake': 'pm.people', '/proposals': 'pm.proposals', '/money': 'payapps.main', '/archive': 'payapps.closeout'
};
// These are available to anyone who can open the PM section at all, even read-only (sending a suggestion, presence pings).
const READ_LEVEL_OK = new Set(['/suggestions', '/requests', '/presence']);

const legacyRoleOf = user => user.role_key === 'builder' ? 'builder' : ((user.roles || [user.role_key]).includes('owner') ? 'owner' : 'pm');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

function paneFor(req){
  const p = String(req.originalUrl || '').split('?')[0].replace(/^\/pm\/api/, '');
  const key = Object.keys(PANE_BY_PREFIX).find(k => p === k || p.startsWith(k + '/'));
  return key ? { key, pane: PANE_BY_PREFIX[key] } : null;
}

// requireAuth() = any signed-in person with access to that pane; requireAuth('builder','owner') = those legacy roles only.
function requireAuth(...roles){
  return (req, res, next) => platform.requireAuth(req, res, () => {
    if(req.user.must_change_password) return res.status(403).json({ error: 'password_change_required' });
    const role = legacyRoleOf(req.user);
    const hit = paneFor(req);
    if(!hit && role !== 'builder') return res.status(403).json({ error: 'forbidden' });
    if(hit){
      const need = (req.method === 'GET' || READ_LEVEL_OK.has(hit.key)) ? 'read' : 'write';
      if(lvl(req.perms[hit.pane]) < lvl(need)) return res.status(403).json({ error: 'forbidden', need: hit.pane + ':' + need });
    }
    if(roles.length && !roles.includes(role)) return res.status(403).json({ error: 'forbidden' });
    req.auth = { role, tokenHash: req.sessionHash, user: req.user };
    // Everything below this point can ask "who is this?" (lib/actor) when it writes a record.
    actor.runAs(req.user, () => next());
  });
}
async function audit(event, req, role, detail){
  const user = req && req.user ? { id: req.user.id, name: req.user.name, username: req.user.username, email: req.user.email } : null;
  return platformAudit(user, 'pm.' + String(event).slice(0, 55), null, null, detail || null, req && req.ip);
}
function wrap(fn){
  return (req, res) => Promise.resolve(fn(req, res)).catch(err => {
    console.error(`${req.method} ${req.originalUrl} failed`, err);
    if(!res.headersSent) res.status(500).json({ error: 'server_error' });
  });
}
// IPv6 clients can rotate inside their /64, so those are keyed by prefix (used by the public proposal/intake rate limits).
function ipKey(ip){
  let s = String(ip || 'unknown').split('%')[0].toLowerCase();
  if(s.startsWith('::ffff:') && s.includes('.')) return s.slice(7);
  if(!s.includes(':')) return s;
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : h.concat(Array(Math.max(8 - h.length - t.length, 0)).fill('0'), t);
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
module.exports = { requireAuth, audit, wrap, sha256, ipKey, legacyRoleOf };
