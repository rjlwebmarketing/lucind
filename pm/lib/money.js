// Money rules, enforced on the server (the page can't be trusted with these).
//
// Money lives on each project as project.money (contract, change orders, pay apps to the GC,
// sub agreements and payments) plus board.moneySettings (customer billing windows, the
// Operations e-mail). Owner, PM and Builder can all read and edit it. What the server adds:
//   1. THE ARCHIVE: every time a saved value differs from what was stored (a number changed,
//      an entry added, voided, or removed) one row goes into money_archive with the old and new
//      value, the role that saved it and the time. Only the Owner and Builder can read it.
//   2. NO DELETING FOR THE PM: a PM save that drops any money entry (change order, pay app, sub
//      agreement, payment, billing rule) is refused. The PM "voids" instead (an entry stays,
//      flagged void), which is itself archived.
//   3. WHERE CHECKS GO: only the Owner/Builder can change the Operations e-mail address, so a
//      PM can't point "send this check" mails somewhere else.

const MAX_VAL = 480;        // characters kept per old/new value in the archive
const MAX_ROWS_PER_SAVE = 200;

function isPlain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

// Every leaf under `v` -> Map(path -> value). Array elements that have an id are addressed by
// that id so reordering isn't a change. Also records the entries (array elements) it passes.
function flatten(v, prefix, leaves, entries) {
  if (Array.isArray(v)) {
    v.forEach((el, i) => {
      const key = (isPlain(el) && el.id !== undefined) ? String(el.id) : String(i);
      const p = prefix + '[' + key + ']';
      if (isPlain(el) || Array.isArray(el)) { entries.set(p, el); flatten(el, p, leaves, entries); }
      else leaves.set(p, el);
    });
  } else if (isPlain(v)) {
    for (const k of Object.keys(v)) {
      const p = prefix ? prefix + '.' + k : k;
      const x = v[k];
      if (isPlain(x) || Array.isArray(x)) flatten(x, p, leaves, entries);
      else leaves.set(p, x);
    }
  } else if (prefix) {
    leaves.set(prefix, v);
  }
}
function isEmptyish(v) { return v === undefined || v === null || v === '' || v === 0 || v === false; }
function show(v) {
  if (v === undefined) return null;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > MAX_VAL ? s.slice(0, MAX_VAL) + '...' : s;
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// A "scope" is one project's money, or the company-wide money settings.
function scopesOf(board) {
  const out = new Map();
  for (const p of (board && board.projects) || []) {
    if (p && p.id !== undefined) {
      // Money plus the sub proposals (project.bids) are audited and delete-protected the same way.
      const hasBids = p.bids !== undefined && p.bids !== null;
      const money = hasBids ? Object.assign({}, isPlain(p.money) ? p.money : {}, { bids: p.bids }) : p.money;
      out.set('p:' + p.id, { id: String(p.id), name: String(p.name || ''), money });
    }
  }
  // W-2 hourly wages: one scope per person so a change is archived with the person's name.
  for (const pe of (board && board.people) || []) {
    if (pe && pe.id !== undefined && (pe.wage !== undefined || pe.wageVoid !== undefined || pe.dayRate !== undefined)) {
      out.set('w:' + pe.id, { id: String(pe.id), name: String(pe.name || '') + ' (wage)', money: { wage: pe.wage === undefined ? null : pe.wage, wageVoid: !!pe.wageVoid, dayRate: pe.dayRate === undefined ? null : pe.dayRate } });
    }
  }
  const ms = board && board.moneySettings;
  out.set('s:settings', { id: 'settings', name: 'Billing rules & settings', money: ms });
  return out;
}

// Returns { changes: [...], removedEntries: n } comparing the stored board with the one about to be stored.
function diffMoney(cur, next) {
  const A = scopesOf(cur), B = scopesOf(next);
  const changes = [];
  let removedEntries = 0;
  const keys = new Set([...A.keys(), ...B.keys()]);
  for (const key of keys) {
    const a = A.get(key), b = B.get(key);
    const la = new Map(), ea = new Map(), lb = new Map(), eb = new Map();
    if (a && a.money !== undefined) flatten(a.money, '', la, ea);
    if (b && b.money !== undefined) flatten(b.money, '', lb, eb);
    const scope = b || a;
    const projectGone = !b && key.startsWith('p:');
    if (projectGone) {
      if (la.size) changes.push({ projectId: scope.id, projectName: scope.name, path: '(whole project removed)', kind: 'removed', oldV: show(a.money), newV: null });
      continue; // project removal is policed by the existing delete rules
    }
    for (const p of ea.keys()) if (!eb.has(p)) removedEntries++;
    const paths = new Set([...la.keys(), ...lb.keys()]);
    for (const p of paths) {
      const o = la.get(p), n = lb.get(p);
      if (same(o, n)) continue;
      if (o === undefined && isEmptyish(n)) continue;   // a project simply getting its empty money block
      if (n === undefined && isEmptyish(o)) continue;
      const kind = o === undefined ? 'added' : (n === undefined ? 'removed' : 'changed');
      changes.push({ projectId: scope.id, projectName: scope.name, path: p, kind, oldV: show(o), newV: show(n) });
    }
  }
  return { changes, removedEntries };
}

// Bounds the money block so a bad page can't store nonsense (NaN, giant numbers, huge text).
function moneyProblem(board) {
  const bad = (x, where) => `${where}: numbers must be ordinary amounts`;
  let problem = null;
  function walk(v, where, depth) {
    if (problem || depth > 8) return;
    if (typeof v === 'number') { if (!Number.isFinite(v) || Math.abs(v) > 1e11) problem = bad(v, where); return; }
    if (typeof v === 'string') { if (v.length > 4000) problem = `${where}: text is too long`; return; }
    if (Array.isArray(v)) { if (v.length > 500) problem = `${where}: too many entries`; v.forEach((x, i) => walk(x, where + '[' + i + ']', depth + 1)); return; }
    if (isPlain(v)) for (const k of Object.keys(v)) walk(v[k], where + '.' + k, depth + 1);
  }
  for (const p of board.projects || []) {
    if (p && p.money !== undefined) {
      if (!isPlain(p.money)) return `Money on "${p.name || 'a project'}" must be an object`;
      walk(p.money, `money(${p.name || p.id})`, 0);
    }
    if (p && p.bids !== undefined) {
      if (!isPlain(p.bids)) return `Proposals on "${p.name || 'a project'}" must be an object`;
      walk(p.bids, `proposals(${p.name || p.id})`, 0);
    }
  }
  for (const pe of board.people || []) {
    if (pe && pe.dayRate !== undefined && pe.dayRate !== null && (typeof pe.dayRate !== 'number' || !Number.isFinite(pe.dayRate) || pe.dayRate < 0 || pe.dayRate > 100000)) return `Day rate for "${pe.name || pe.id}" must be a dollar amount`;
    if (pe && pe.wage !== undefined && pe.wage !== null && (typeof pe.wage !== 'number' || !Number.isFinite(pe.wage) || pe.wage < 0 || pe.wage > 10000)) return `Wage for "${pe.name || pe.id}" must be an hourly amount`;
  }
  if (board.moneySettings !== undefined) {
    if (!isPlain(board.moneySettings)) return '"moneySettings" must be an object';
    walk(board.moneySettings, 'moneySettings', 0);
  }
  return problem;
}

// What only the Owner/Builder may set: where "send a check" e-mails go, the labor rates (burden %, temp agency),
// and each W-2's hourly wage. A PM save keeps the stored values; the one thing a PM may do is VOID a wage
// (wageVoid true), never un-void it, and a wage added to a new person is ignored. Voids are archived like any change.
function protectOpsEmail(next, cur, role) {
  if (role === 'builder' || role === 'owner') return;
  const curMs = (cur && cur.moneySettings) || {};
  if (isPlain(next.moneySettings)) {
    const ms = Object.assign({}, next.moneySettings, { opsEmail: curMs.opsEmail || '', opsName: curMs.opsName || '' });
    if (curMs.labor === undefined) delete ms.labor; else ms.labor = curMs.labor;
    next.moneySettings = ms;
  }
  if (Array.isArray(next.people)) {
    const curById = new Map(((cur && cur.people) || []).filter(x => x && x.id !== undefined).map(x => [String(x.id), x]));
    next.people = next.people.map(pe => {
      if (!isPlain(pe)) return pe;
      const old = curById.get(String(pe.id));
      const out = Object.assign({}, pe);
      if (old && old.wage !== undefined) out.wage = old.wage; else delete out.wage;
      if (old && old.dayRate !== undefined) out.dayRate = old.dayRate; else delete out.dayRate;   // Temp For Hire day rate: Owner/Builder only
      const wasVoid = !!(old && old.wageVoid);
      const nowVoid = wasVoid || !!pe.wageVoid;
      if (nowVoid && out.wage !== undefined) out.wageVoid = true; else if (old && old.wageVoid !== undefined) out.wageVoid = old.wageVoid; else delete out.wageVoid;
      return out;
    });
  }
}

async function writeArchive(pool, role, changes) {
  if (!changes.length) return 0;
  const now = Date.now();
  let rows = changes;
  if (rows.length > MAX_ROWS_PER_SAVE) {
    rows = rows.slice(0, MAX_ROWS_PER_SAVE - 1).concat([{ projectId: '', projectName: '', path: `(${rows.length - MAX_ROWS_PER_SAVE + 1} more changes in this save)`, kind: 'changed', oldV: null, newV: null }]);
  }
  for (const c of rows) {
    await pool.query(
      'INSERT INTO money_archive (created_at, role, project_id, project_name, path, kind, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [now, role, String(c.projectId).slice(0, 64), String(c.projectName).slice(0, 200), String(c.path).slice(0, 250), c.kind, c.oldV, c.newV]);
  }
  return rows.length;
}

module.exports = { diffMoney, moneyProblem, protectOpsEmail, writeArchive, flatten };
