// The PM module: the former standalone dispatch backend, mounted at /pm (so its old /api/... paths become /pm/api/...).
const express = require('express');
const { ensureSchema } = require('./lib/schema');
const { requireAuth } = require('./lib/auth');
const { lvl, PANE_KEYS, SHARED_PANES } = require('../lib/catalog');
const { legacyRoleOf } = require('./lib/auth');

const router = express.Router();
router.use('/api/data', require('./routes/data'));
router.use('/api/ai', require('./routes/ai'));
router.use('/api/admin', require('./routes/admin'));
router.use('/api/suggestions', require('./routes/suggestions'));
router.use('/api/requests', require('./routes/requests'));
router.use('/api/intake', require('./routes/intake'));          // includes the public (token) intake pages
router.use('/api/proposals', require('./routes/proposals'));    // includes the public sub proposal pages
router.use('/api/presence', require('./routes/presence'));
router.use('/api/house-rules', require('./routes/houseRules'));
router.use('/api/money', require('./routes/money'));
router.use('/api/archive', require('./routes/archive'));

// The embedded PM page asks who is signed in and which parts it may show.
const authMw = (req, res, next) => require('../lib/auth').requireAuth(req, res, next);
router.get('/api/me', authMw, (req, res) => {
  const panes = {}; PANE_KEYS.filter(k => k.startsWith('pm.') || k.startsWith('payapps.')).forEach(k => { panes[k] = req.perms[k]; });
  res.json({ role: legacyRoleOf(req.user), name: req.user.name, username: req.user.username || null, userId: Number(req.user.id), panes, hasPmAccess: Object.entries(panes).some(([k, l]) => lvl(l) >= 1 && !SHARED_PANES.includes(k)), hasCrossView: Object.values(panes).some(l => lvl(l) >= 1) });
});
module.exports = { router, ensureSchema };
