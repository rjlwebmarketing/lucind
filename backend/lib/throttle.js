// Small in-memory rate limiter (per process). Good enough for one Railway instance; the per-account lockout is in the database.
const buckets = new Map();
function hit(key, limit, windowMs){
  const now = Date.now();
  const b = (buckets.get(key) || []).filter(t => now - t < windowMs);
  b.push(now); buckets.set(key, b);
  if(buckets.size > 5000){ for(const [k, v] of buckets) if(!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k); }
  return b.length > limit;      // true = over the limit
}
const limiter = (name, limit, windowMs) => (req, res, next) => hit(name + ':' + (req.ip || ''), limit, windowMs) ? res.status(429).json({ error: 'too_many_requests' }) : next();
module.exports = { hit, limiter };
