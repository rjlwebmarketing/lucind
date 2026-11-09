require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ensureSchema } = require('./lib/schema');
const pm = require('./pm');

const app = express();
app.set('trust proxy', 1);
const origins = String(process.env.ALLOWED_ORIGINS || 'https://go.lucasindustrial.us').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: (o, cb) => cb(null, !o || origins.includes(o)), allowedHeaders: ['Content-Type', 'Authorization'], methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));
// Small body limit everywhere, except the few PM routes that parse their own larger bodies after sign-in is confirmed.
const smallJson = express.json({ limit: '256kb' });
const BIG = new Set(['/pm/api/data', '/pm/api/ai/complete', '/pm/api/suggestions']);
app.use((req, res, next) => (req.method === 'POST' && BIG.has(req.path)) ? next() : smallJson(req, res, next));
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
app.use('/api', noStore);
app.use('/pm/api', noStore);

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'lucas-go', time: Date.now() }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/estimator', require('./routes/estimator'));
app.use('/api/media', require('./routes/media'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/pm', pm.router);
// Future modules mount here, each behind requireAuth + requirePerm on its own panes:
//   app.use('/api/estimator', require('./routes/estimator'));  app.use('/api/pm', ...);  app.use('/api/payapps', ...);

module.exports = app;
if(require.main === module){
  ensureSchema().then(() => pm.ensureSchema()).then(() => { const port = process.env.PORT || 3000; app.listen(port, () => console.log('[go] listening on ' + port)); })
    .catch(e => { console.error('[go] startup failed', e); process.exit(1); });
}
