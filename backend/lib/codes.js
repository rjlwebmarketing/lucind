// One running project number for the whole company (LI-000001, LI-000002, ...), shared by bids and projects.
//   - A bid gets its number the moment it is created, so lost bids are tracked from the start under the same ID the project
//     would have had; if the bid is won the PM project keeps that exact number.
//   - Numbers are never reused or changed. A lost bid simply leaves a gap in the PM's list.
//   - The counter lives in id_counters (atomic, locked), and is always pushed up to the highest number already used anywhere
//     (bids or the PM board), so the two sides can never hand out the same number.
const pool = require('../config/db');

const CODE_RE = /^LI-(\d{6})$/;
const codeFor = n => 'LI-' + String(n).padStart(6, '0');
const numOf = c => { const m = CODE_RE.exec(c || ''); return m ? parseInt(m[1], 10) : 0; };

async function boardCodes(){
  const [rows] = await pool.query('SELECT data_json FROM board_data WHERE id = 1').catch(() => [[]]);
  const out = { max: 0, byProject: {} };
  if(!rows.length) return out;
  let b = {}; try{ b = JSON.parse(rows[0].data_json); }catch(e){}
  out.max = Number.isInteger(b.projectCounter) ? b.projectCounter : 0;
  (Array.isArray(b.projects) ? b.projects : []).forEach(p => { const n = numOf(p && p.code); if(n){ out.max = Math.max(out.max, n); out.byProject[p.id] = p.code; } });
  return out;
}
async function usedMax(){
  const [r] = await pool.query("SELECT MAX(CAST(SUBSTRING(project_code, 4) AS UNSIGNED)) AS m FROM est_bids WHERE project_code IS NOT NULL").catch(() => [[{ m: 0 }]]);
  const bm = Number(r && r[0] && r[0].m) || 0;
  return Math.max(bm, (await boardCodes()).max);
}

// n fresh codes, in order. Locks the counter row for the moment it takes.
async function nextCodes(n){
  n = Math.max(1, n | 0);
  const floor = await usedMax();
  const conn = await pool.getConnection();
  try{
    await conn.beginTransaction();
    await conn.query("INSERT INTO id_counters (name, value) VALUES ('project_code', ?) ON DUPLICATE KEY UPDATE value = GREATEST(value, VALUES(value))", [floor]);
    const [r] = await conn.query("SELECT value FROM id_counters WHERE name = 'project_code' FOR UPDATE");
    const start = Number(r[0].value);
    await conn.query("UPDATE id_counters SET value = ? WHERE name = 'project_code'", [start + n]);
    await conn.commit();
    return Array.from({ length: n }, (_, i) => codeFor(start + 1 + i));
  }catch(e){ try{ await conn.rollback(); }catch(x){} throw e; }
  finally{ conn.release(); }
}

// For the PM board save: one fresh code for each project that is new in `next` (not in `cur`), so a PM-created project draws from the same counter.
async function forNewProjects(cur, next){
  const have = new Set((Array.isArray(cur && cur.projects) ? cur.projects : []).map(p => p && p.id));
  const n = (Array.isArray(next && next.projects) ? next.projects : []).filter(p => p && typeof p === 'object' && !have.has(p.id)).length;
  return n ? nextCodes(n) : null;
}

// One-time fill: every bid without a number gets one. A bid already handed off keeps the number its PM project already has.
async function backfillBidCodes(){
  const [rows] = await pool.query('SELECT id, project_id FROM est_bids WHERE project_code IS NULL ORDER BY id');
  if(!rows.length) return 0;
  const bc = await boardCodes(), need = [];
  for(const b of rows){
    const c = b.project_id && bc.byProject[b.project_id];
    if(c) await pool.query('UPDATE est_bids SET project_code = ? WHERE id = ? AND project_code IS NULL', [c, b.id]); else need.push(b);
  }
  if(need.length){ const fresh = await nextCodes(need.length); for(let i = 0; i < need.length; i++) await pool.query('UPDATE est_bids SET project_code = ? WHERE id = ? AND project_code IS NULL', [fresh[i], need[i].id]); }
  return rows.length;
}

module.exports = { CODE_RE, codeFor, numOf, nextCodes, forNewProjects, backfillBidCodes };
