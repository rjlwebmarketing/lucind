// v20: project IDs, the per-project change log, and each person's work history.
// All of it is stamped by the SERVER on every save, so no login can edit, reuse or forge it.
//   - project.code: "LI-000001", one running number for the whole company, never changed, never reused
//   - project_events: who (which login), when, what changed (old -> new), for everything that is not money
//     (money already has money_archive). Read by Owner/Builder only; later exported into the closing packet.
//   - person.history: a lightweight log of "on this project from <time> to <time>", written when someone is
//     assigned to or released from a project (or one of its phases).

const CODE_RE = /^LI-(\d{6})$/;
const MAX_EVENTS_PER_SAVE = 300;
const MAX_HISTORY = 500;
const codeFor = n => 'LI-' + String(n).padStart(6, '0');

const PROJECT_FIELDS = [
  ['name', 'Name'], ['customer', 'Customer'], ['storeNumber', 'Store #'], ['address', 'Address'], ['city', 'City'], ['state', 'State'],
  ['status', 'Status'], ['plannedStart', 'Planned start'], ['plannedEnd', 'Planned end'], ['crewNeeded', 'Crew needed'], ['manDays', 'Man-days'],
];
const PHASE_FIELDS = [['status', 'status'], ['plannedStart', 'planned start'], ['plannedEnd', 'planned end'], ['crewNeeded', 'crew needed'], ['manDays', 'man-days']];

const str = v => (v === null || v === undefined) ? '' : String(v);
const clip = (v, n) => str(v).slice(0, n);
const asList = v => Array.isArray(v) ? v : [];

// Assigns codes, keeps existing ones fixed, cleans Store #. Mutates `next`. Returns { codes } for the page.
function stampCodes(cur, next, opts) {
  const curProjects = asList(cur && cur.projects);
  const curById = new Map(curProjects.map(p => [p && p.id, p]));
  let max = Number.isInteger(cur && cur.projectCounter) ? cur.projectCounter : 0;
  for (const p of curProjects) { const m = CODE_RE.exec((p && p.code) || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  const codes = {};
  // Only the server passes these: a number set aside for a new project (presetCodes: a handed-off bid keeps its own; codeQueue: fresh ones
  // from the shared counter). A page can never choose its own code.
  const preset = (opts && opts.presetCodes) || {}, queue = (opts && Array.isArray(opts.codeQueue)) ? opts.codeQueue.slice() : [];
  const used = new Set(curProjects.map(p => p && p.code).filter(Boolean));
  for (const p of asList(next.projects)) {
    if (!p || typeof p !== 'object') continue;
    const was = curById.get(p.id);
    if (was && CODE_RE.test(was.code || '')) p.code = was.code;
    else {
      let c = preset[p.id];
      if (!(c && CODE_RE.test(c) && !used.has(c))) { c = queue.shift(); if (!(c && CODE_RE.test(c) && !used.has(c))) { max += 1; c = codeFor(max); } }
      p.code = c; max = Math.max(max, parseInt(CODE_RE.exec(c)[1], 10));
    }
    used.add(p.code);
    if (was && was.closed) {   // a closed-out project is frozen: whatever a page sends for it is ignored (reopening comes later)
      Object.keys(p).forEach(k => { delete p[k]; });
      Object.assign(p, structuredClone(was));
    } else delete p.closed;                       // nobody can mark a project closed through a normal save
    codes[p.id] = p.code;
    if (p.storeNumber !== undefined) p.storeNumber = clip(p.storeNumber, 20).trim();
  }
  next.projectCounter = max;
  return codes;
}

// Scope of Work: the Estimator owns the task list (titles, details, order); a PM page can only move a task's progress, in steps of 25.
// A page can never add, remove or reword tasks, or invent a Scope of Work on a project that has none. Only the hand-off (opts.allowSow) creates one.
// Equal weight: the project's % complete is the plain average of its tasks (kept on money.percentComplete, which Pay Apps reads).
const SOW_STEPS = [0, 25, 50, 75, 100];
const stepPct = v => { const n = Number(v); if (!Number.isFinite(n)) return 0; return SOW_STEPS.reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a, 0); };
const sowAverage = sow => { const t = asList(sow && sow.tasks); return t.length ? Math.round(t.reduce((a, x) => a + stepPct(x.pct), 0) / t.length) : 0; };
function protectSow(cur, next, opts) {
  const was = new Map(asList(cur && cur.projects).map(p => [p && p.id, p]));
  for (const p of asList(next.projects)) {
    if (!p || typeof p !== 'object') continue;
    const old = was.get(p.id), keep = old && old.sow && Array.isArray(old.sow.tasks) ? old.sow : null;
    if (!keep) {
      if (opts && opts.allowSow && p.sow && Array.isArray(p.sow.tasks)) p.sow.tasks.forEach(t => { t.pct = stepPct(t.pct); });
      else delete p.sow;
    } else {
      const sent = new Map(asList(p.sow && p.sow.tasks).map(t => [t && t.id, t]));
      const now = new Date().toISOString();
      p.sow = structuredClone(keep);
      p.sow.tasks.forEach(t => {
        const s2 = sent.get(t.id), pct = s2 ? stepPct(s2.pct) : stepPct(t.pct);
        if (pct !== stepPct(t.pct)) { t.pct = pct; t.at = now; } else t.pct = pct;
      });
    }
    if (p.sow && p.sow.tasks.length && p.money && typeof p.money === 'object') p.money.percentComplete = sowAverage(p.sow);
  }
}

// Compares the stored board with the one about to be stored. Returns the change-log rows.
function diffProjects(cur, next) {
  const out = [];
  const curProjects = asList(cur && cur.projects), nextProjects = asList(next.projects);
  const curById = new Map(curProjects.map(p => [p && p.id, p]));
  const nextById = new Map(nextProjects.map(p => [p && p.id, p]));
  const nameOf = id => { const x = asList(next.people).concat(asList(cur && cur.people)).find(q => q && q.id === id); return (x && x.name) || id; };
  const ev = (p, field, kind, o, n) => out.push({ projectId: str(p.id), code: str(p.code), name: str(p.name), field, kind, oldV: o === null ? null : clip(o, 480), newV: n === null ? null : clip(n, 480) });

  for (const p of nextProjects) {
    if (!p) continue;
    const was = curById.get(p.id);
    if (!was) { ev(p, 'Project', 'added', null, p.name || ''); continue; }
    for (const [k, label] of PROJECT_FIELDS) if (str(was[k]) !== str(p[k])) ev(p, label, 'changed', str(was[k]), str(p[k]));
    const sk0 = asList(was.requiredSkills).slice().sort().join(', '), sk1 = asList(p.requiredSkills).slice().sort().join(', ');
    if (sk0 !== sk1) ev(p, 'Required skills', 'changed', sk0, sk1);
    const t0 = (was.tempLaborers && was.tempLaborers.count) || 0, t1 = (p.tempLaborers && p.tempLaborers.count) || 0;
    if (t0 !== t1) ev(p, 'Temp laborers', 'changed', String(t0), String(t1));
    const a0 = new Set(asList(was.assignedIds)), a1 = new Set(asList(p.assignedIds));
    for (const id of a1) if (!a0.has(id)) ev(p, 'Crew', 'added', null, nameOf(id));
    for (const id of a0) if (!a1.has(id)) ev(p, 'Crew', 'removed', nameOf(id), null);
    const st = new Map(asList(was.sow && was.sow.tasks).map(x => [x && x.id, x]));
    for (const t of asList(p.sow && p.sow.tasks)) {
      const t0 = st.get(t.id);
      if (!t0) continue;
      if (stepPct(t0.pct) !== stepPct(t.pct)) ev(p, 'Scope of Work: ' + clip(t.title, 80), 'changed', stepPct(t0.pct) + '%', stepPct(t.pct) + '%');
    }
    const wp = new Map(asList(was.phases).map(x => [x && x.id, x]));
    const np = new Map(asList(p.phases).map(x => [x && x.id, x]));
    for (const [id, ph] of np) {
      const lbl = 'Phase ' + str(ph.number);
      const pw = wp.get(id);
      if (!pw) { ev(p, lbl, 'added', null, 'phase added'); continue; }
      for (const [k, label] of PHASE_FIELDS) if (str(pw[k]) !== str(ph[k])) ev(p, lbl + ' ' + label, 'changed', str(pw[k]), str(ph[k]));
      const b0 = new Set(asList(pw.assignedIds)), b1 = new Set(asList(ph.assignedIds));
      for (const x of b1) if (!b0.has(x)) ev(p, lbl + ' crew', 'added', null, nameOf(x));
      for (const x of b0) if (!b1.has(x)) ev(p, lbl + ' crew', 'removed', nameOf(x), null);
    }
    for (const [id, ph] of wp) if (!np.has(id)) ev(p, 'Phase ' + str(ph.number), 'removed', 'phase removed', null);
  }
  for (const p of curProjects) if (p && !nextById.has(p.id)) ev(p, 'Project', 'removed', p.name || '', null);
  return out.slice(0, MAX_EVENTS_PER_SAVE);
}

// Compliance records on a subcontractor (licensed states, business license, W-9 / EIN, certificate of insurance) are documents that get
// replaced over time, so every change is written to the same change log, filed under "person:<id>". The EIN is logged masked.
const mask = v => { const d = String(v || '').replace(/\D/g, ''); return d ? 'ending ' + d.slice(-4) : ''; };
const yn = v => (v ? 'on file' : 'not on file');
function personFacts(x) {
  const c = (x && x.compliance) || {}, lic = c.license || {}, w9 = c.w9 || {}, coi = c.coi || {};
  return [
    ['Licensed states', asList(x && x.licStates).map(v => str(v).toUpperCase()).filter(Boolean).sort().join(', ')],
    ['Business license', yn(lic.has) + (lic.number ? ' #' + str(lic.number) : '')],
    ['W-9', yn(w9.has)],
    ['EIN', mask(w9.ein)],
    ['COI', yn(coi.has)],
    ['COI expires', str(coi.expires)],
    ['COI carrier', str(coi.carrier)],
    ['COI policy #', str(coi.policy)]
  ];
}
function diffPeople(cur, next) {
  const out = [], was = new Map(asList(cur && cur.people).map(x => [x && x.id, x]));
  for (const p of asList(next.people)) {
    if (!p || p.type !== 'sub') continue;
    const old = was.get(p.id);
    if (!old && !asList(p.licStates).length && !(p.compliance && Object.keys(p.compliance).length)) continue;
    const before = new Map(personFacts(old));
    for (const [label, v] of personFacts(p)) {
      const o = old ? before.get(label) : '';
      if (!old && /^not on file$/.test(v)) continue;
      if ((o || '') !== (v || '')) out.push({ projectId: 'person:' + str(p.id), code: '', name: str(p.name), field: label, kind: old ? 'changed' : 'added', oldV: o ? clip(o, 480) : null, newV: v ? clip(v, 480) : null });
    }
  }
  return out;
}

// "who is on what" as a set of keys: personId|projectId|phaseId
function assignmentSet(board) {
  const s = new Map();
  for (const p of asList(board && board.projects)) {
    if (!p) continue;
    for (const id of asList(p.assignedIds)) s.set(id + '|' + p.id + '|', { personId: id, p, phase: null });
    for (const ph of asList(p.phases)) for (const id of asList(ph && ph.assignedIds)) s.set(id + '|' + p.id + '|' + ph.id, { personId: id, p, phase: ph });
  }
  return s;
}

// Keeps each person's stored history, then opens/closes entries for assignments that changed in this save.
// Mutates next.people. Returns { histories } (only the people whose history changed), for the page.
function stampHistory(cur, next, nowIso) {
  const before = assignmentSet(cur), after = assignmentSet(next);
  const stored = new Map(asList(cur && cur.people).map(x => [x && x.id, asList(x && x.history)]));
  const changed = {};
  for (const person of asList(next.people)) {
    if (!person || typeof person !== 'object') continue;
    person.history = (stored.get(person.id) || []).map(h => Object.assign({}, h)); // the page can never write it
  }
  const byId = new Map(asList(next.people).map(x => [x && x.id, x]));
  const touch = (id, fn) => { const person = byId.get(id); if (!person) return; fn(person.history); if (person.history.length > MAX_HISTORY) person.history.splice(0, person.history.length - MAX_HISTORY); changed[id] = person.history; };
  for (const [key, a] of after) if (!before.has(key)) {
    touch(a.personId, h => h.push({ projectId: str(a.p.id), code: str(a.p.code), name: clip(a.p.name, 120), phaseId: a.phase ? str(a.phase.id) : '', phase: a.phase ? 'Phase ' + str(a.phase.number) : '', from: nowIso, to: null }));
  }
  for (const [key, b] of before) if (!after.has(key)) {
    touch(b.personId, h => {
      const open = h.slice().reverse().find(e => e.projectId === str(b.p.id) && (e.phaseId || '') === (b.phase ? str(b.phase.id) : '') && !e.to);
      if (open) open.to = nowIso;
      else h.push({ projectId: str(b.p.id), code: str(b.p.code), name: clip(b.p.name, 120), phaseId: b.phase ? str(b.phase.id) : '', phase: b.phase ? 'Phase ' + str(b.phase.number) : '', from: null, to: nowIso });
    });
  }
  return changed;
}

async function writeEvents(pool, role, rows, atMs) {
  for (const r of rows) {
    await pool.query(
      'INSERT INTO project_events (created_at, role, project_id, project_code, project_name, field, kind, old_value, new_value, user_id, user_name, user_username) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [atMs, role, clip(r.projectId, 64), clip(r.code, 16), clip(r.name, 200), clip(r.field, 120), r.kind, r.oldV, r.newV].concat(require('../../lib/actor').cols()));
  }
  return rows.length;
}

// One call from the save route. Mutates `next`; returns what to log and what to tell the page.
function stampBoard(cur, next, nowMs, opts) {
  const codes = stampCodes(cur || {}, next, opts);
  protectSow(cur || {}, next, opts);
  const events = diffProjects(cur || {}, next).concat(diffPeople(cur || {}, next));
  const histories = stampHistory(cur || {}, next, new Date(nowMs).toISOString());
  return { events, stamps: { codes, histories } };
}

module.exports = { protectSow, sowAverage, stepPct, stampBoard, stampCodes, diffProjects, diffPeople, stampHistory, writeEvents, codeFor, CODE_RE };
