const express = require('express');
const { requireAuth, blockUntilPasswordChanged } = require('../lib/auth');
const n = require('../lib/notify');
const router = express.Router();
router.use(requireAuth, blockUntilPasswordChanged);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => { console.error('[notifications]', e); res.status(500).json({ error: 'server_error' }); });
router.get('/', wrap(async (req, res) => { res.json({ items: await n.listFor(req.user, req.perms) }); }));
router.post('/dismiss', wrap(async (req, res) => {
  const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 100);
  await n.dismiss(req.user.id, ids); res.json({ ok: true });
}));
module.exports = router;
