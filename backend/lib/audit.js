const pool = require('../config/db');
// Record who did what. `user` is the signed-in person (or null for the system / an anonymous action).
async function audit(user, action, entityType, entityId, detail, ip){
  try{
    await pool.query('INSERT INTO audit_log (at, user_id, user_name, user_email, action, entity_type, entity_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [Date.now(), user ? user.id : null, user ? user.name : null, user ? user.email : null, String(action).slice(0, 64), entityType ? String(entityType).slice(0, 40) : null, entityId != null ? String(entityId).slice(0, 64) : null, detail === undefined ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 4000), ip ? String(ip).slice(0, 64) : null]);
  }catch(e){ console.error('[audit] write failed', e.message); }
}
// What every module stamps on a record it creates or changes: the person's id AND their name/e-mail at that moment.
const stampFor = user => ({ by: user.id, byName: user.name, byEmail: user.email, at: Date.now() });
module.exports = { audit, stampFor };
