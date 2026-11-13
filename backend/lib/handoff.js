// Hand-off: a Won bid becomes a PM project, with everything the Estimator already knows carried over, so nobody retypes it.
//   - the project gets customer / store # / address / dates from the bid, and the original contract from the estimate
//   - the contract is LOCKED (money.contract.locked): a PM save can't change it (see pm/lib/money.js protectContract);
//     the PM adds change orders / addendums / additions beside it instead
//   - every estimate line is part of the contract, including ADD lines (in Estimate #1961 the ADD 01 line is inside the sold total);
//     an ADD label is kept on the line as wording only
// The board is one JSON document (board_data), so this writes it the same safe way every other save does: compare-and-swap on the revision.
const crypto = require('crypto');
const pool = require('../config/db');
const projects = require('../pm/lib/projects');
const moneyLib = require('../pm/lib/money');

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const rid = p => p + '_' + crypto.randomBytes(4).toString('hex');

const DEF_SCOPE = 'Structural Steel';
const lineScope = l => String(l.scope || DEF_SCOPE).slice(0, 80);
// Pure: the estimate's scopes of work, each with its own subtotal and tax. One scope: the estimate tax is that scope's tax.
function scopeBreak(doc){
  const ls = Array.isArray(doc.lines) ? doc.lines : [], names = [...new Set(ls.map(lineScope))], multi = names.length > 1;
  return names.map(name => {
    const sub = r2(ls.filter(l => lineScope(l) === name).reduce((a, l) => a + (Number(l.amount) || 0), 0));
    const tax = multi ? r2((doc.scopeTax || {})[name]) : r2(doc.tax);
    return { scope: name, subtotal: sub, tax, total: r2(sub + tax), lines: ls.filter(l => lineScope(l) === name).length };
  });
}

// Pure: the estimate document -> the contract block that lives on project.money.
// `scopes` (optional array of scope names) hands off only those scopes: a partial award, e.g. roofing only.
function contractFrom(bid, doc, who, now, scopes){
  const all = scopeBreak(doc), pick = Array.isArray(scopes) && scopes.length ? all.filter(x => scopes.includes(x.scope)) : all;
  const keep = new Set(pick.map(x => x.scope)), multi = all.length > 1;
  const lines = (doc.lines || []).filter(l => keep.has(lineScope(l))).map((l, i) => {
    const o = { id: rid('cl'), estLineId: String(l.id || ''), no: i + 1, title: String(l.title || '').slice(0, 400), amount: r2(l.amount), rows: (l.rows || []).map(r => ({ text: String(r.text || '').slice(0, 600), head: !!r.head })) };
    o.payAppTitle = o.title;   // what the pay app calls it; the PM-side wording can be shortened later without touching the estimate wording
    if(multi) o.scope = lineScope(l);
    if(l.alt) o.label = String(l.alt).slice(0, 80);
    return o;
  });
  const subtotal = r2(lines.reduce((a, l) => a + l.amount, 0)), tax = r2(pick.reduce((a, x) => a + x.tax, 0));
  const c = {
    locked: true,
    source: { bidId: Number(bid.id), estimateNumber: String(doc.number || ''), estimateDate: String(doc.date || ''), handedOffAt: now, handedOffBy: who },
    lines, subtotal, tax, total: r2(subtotal + tax),
    preparedFor: doc.preparedFor || null, notes: Array.isArray(doc.notes) ? doc.notes.slice(0, 40) : []
  };
  if(multi) c.scopes = pick.map(x => ({ scope: x.scope, subtotal: x.subtotal, tax: x.tax, total: x.total }));
  return c;
}

// Pure: the PM project for a bid.
function projectFrom(bid, contract, now, sow){
  const money = { contractOriginal: contract.total, percentComplete: 0, changeOrders: [], payApps: [], subDeals: [], notes: '', contract };
  return {
    id: rid('proj'), code: bid.project_code || undefined, name: bid.name || '', customer: bid.customer || '', storeNumber: bid.store_number || '', address: bid.address || '',
    city: bid.city || '', state: bid.state || '', lat: bid.lat == null ? undefined : Number(bid.lat), lon: bid.lon == null ? undefined : Number(bid.lon),
    status: 'Not Urgent', plannedStart: bid.start_date || '', plannedEnd: bid.end_date || '', notes: '', blockers: [], assignedIds: [], requiredSkills: [], phases: [], contacts: [],
    fromBidId: Number(bid.id), money
  };
}
function withSow(project, sow, who, now){
  if(sow && sow.tasks.length) project.sow = sowFrom(sow, who, now);
  return project;
}
// Pure: the Estimator's Scope of Work -> the project's task list, every task at 0%.
function sowFrom(sow, who, now){
  return { source: { handedOffAt: now, handedOffBy: who }, tasks: sow.tasks.map((t, i) => ({ id: rid('sw'), no: i + 1, title: String(t.title || '').slice(0, 200), detail: String(t.detail || '').slice(0, 2000), pct: 0 })) };
}

async function readBoard(){
  const [rows] = await pool.query('SELECT data_json, revision FROM board_data WHERE id = 1').catch(() => [[]]);
  if(!rows.length) return { row: null, board: { projects: [], people: [], revision: 0 } };
  return { row: rows[0], board: JSON.parse(rows[0].data_json) };
}

// Adds the project to the board. Returns { projectId, code }.
async function addToBoard(project, role){
  for(let attempt = 0; attempt < 4; attempt++){
    const cur = await readBoard();
    const next = structuredClone(cur.board);
    next.projects = Array.isArray(next.projects) ? next.projects : [];
    next.projects.push(structuredClone(project));
    const pre = project.code ? { [project.id]: project.code } : null;   // the bid's own number carries over to the project
    const st = projects.stampBoard(cur.board, next, Date.now(), { presetCodes: pre, allowSow: true });
    next.revision = (Number.isInteger(cur.board.revision) ? cur.board.revision : 0) + 1;
    let ok = false;
    if(!cur.row){
      try{ await pool.query('INSERT INTO board_data (id, data_json, revision) VALUES (1, ?, 1)', [JSON.stringify(next)]); ok = true; }catch(e){ continue; }
    }else{
      const [r] = await pool.query('UPDATE board_data SET data_json = ?, revision = revision + 1 WHERE id = 1 AND revision = ?', [JSON.stringify(next), cur.row.revision]);
      ok = r.affectedRows === 1;
    }
    if(ok){
      try{ await projects.writeEvents(pool, role, st.events, Date.now()); }catch(e){ console.error('handoff log failed', e); }
      try{
        const ch = moneyLib.diffMoney(cur.board, next);
        await moneyLib.writeArchive(pool, role, ch.changes);
      }catch(e){ console.error('handoff archive failed', e); }
      const p = next.projects.find(x => x.id === project.id);
      return { projectId: project.id, code: p ? p.code : '' };
    }
  }
  const e = new Error('busy'); e.status = 503; throw e;
}

module.exports = { scopeBreak, contractFrom, projectFrom, withSow, sowFrom, addToBoard };
