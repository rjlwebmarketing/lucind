// Company-wide notifications. Any module calls notify(...) when something happens that another person needs to know about;
// the main page polls /api/notifications and shows each as a toast in whatever branch the person is in.
//   toUser : one person (user id)         toPane : everyone who holds that screen at toLevel or better (default write)
//   route  : where "Go" takes them, e.g. '/pm?view=bids'      from : the person who caused it (they are never notified of their own action)
const pool = require('../config/db');
const { lvl } = require('./catalog');

async function notify({ kind, text, route, toUser, toPane, toLevel, from, sticky }){
  if(!kind || !text || (!toUser && !toPane)) return null;
  try{
    const [r] = await pool.query('INSERT INTO notifications (created_at, kind, text, route, to_user, to_pane, to_level, from_user_id, from_name, from_username) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [Date.now(), String(kind).slice(0, 40), String(text).slice(0, 300), route ? String(route).slice(0, 200) : null, toUser || null, toPane || null, toLevel || 'write',
       from ? from.id : null, from ? from.name : null, from ? (from.username || null) : null]);
    return Number(r.insertId);
  }catch(e){ console.error('[notify] failed', e.message); return null; }
}
// The matter is dealt with (e.g. the proposals were reviewed): clear it for everyone.
async function resolveKind(kind){
  try{ await pool.query('UPDATE notifications SET resolved_at = ? WHERE kind = ? AND resolved_at IS NULL', [Date.now(), kind]); }catch(e){ console.error('[notify] resolve failed', e.message); }
}
const WINDOW_MS = 30 * 24 * 3600 * 1000;
// What this person should see right now: addressed to them or to a screen they hold, not resolved, not dismissed by them, not caused by them.
async function listFor(user, perms){
  const panes = Object.keys(perms).filter(k => lvl(perms[k]) >= 1);
  const marks = panes.length ? panes.map(() => '?').join(',') : "''";
  const [rows] = await pool.query(
    'SELECT n.* FROM notifications n LEFT JOIN notification_state s ON s.notification_id = n.id AND s.user_id = ? ' +
    'WHERE n.resolved_at IS NULL AND s.dismissed_at IS NULL AND n.created_at > ? AND (n.from_user_id IS NULL OR n.from_user_id <> ?) AND (n.to_user = ? OR n.to_pane IN (' + marks + ')) ORDER BY n.id DESC LIMIT 60',
    [user.id, Date.now() - WINDOW_MS, user.id, user.id].concat(panes));
  return rows.filter(n => n.to_user ? Number(n.to_user) === Number(user.id) : lvl(perms[n.to_pane]) >= lvl(n.to_level || 'write'))
    .map(n => ({ id: Number(n.id), at: Number(n.created_at), kind: n.kind, text: n.text, route: n.route || '', by: n.from_name ? n.from_name + (n.from_username ? ' (' + n.from_username + ')' : '') : '' }));
}
async function dismiss(userId, ids){
  for(const id of ids){
    await pool.query('DELETE FROM notification_state WHERE user_id = ? AND notification_id = ?', [userId, id]);
    await pool.query('INSERT INTO notification_state (user_id, notification_id, dismissed_at) VALUES (?, ?, ?)', [userId, id, Date.now()]);
  }
}
module.exports = { notify, resolveKind, listFor, dismiss };
