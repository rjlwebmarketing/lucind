// GENERATED from the page by tools/build-calc.js. Do not edit by hand.
module.exports = function makeCalc(board) {
/* MONEY-CALC-START — pure money math + billing-window rules (unit-tested outside the page) */
const MONEY_REMIND_LEAD_DAYS = 3;     // reminders start this many days before a billing window opens
function moneyNum(v){ const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : 0; }
function moneyRound(v){ return Math.round(v * 100) / 100; }
function moneyClamp(v, lo, hi){ return Math.min(hi, Math.max(lo, v)); }
function moneySum(list, f){ return moneyRound((list || []).reduce((a, x) => a + moneyNum(f(x)), 0)); }
function moneyLive(list){ return (list || []).filter(x => x && !x.void); }
function newMoney(){ return { contractOriginal: 0, percentComplete: 0, changeOrders: [], payApps: [], subDeals: [], notes: '' }; }
// Gives a project its money block (an empty one if it never had any) and makes sure the lists exist.
function ensureMoney(p){
  if(!p) return null;
  if(!p.money || typeof p.money !== 'object' || Array.isArray(p.money)) p.money = newMoney();
  const m = p.money;
  if(typeof m.contractOriginal !== 'number') m.contractOriginal = moneyNum(m.contractOriginal);
  if(typeof m.percentComplete !== 'number') m.percentComplete = moneyNum(m.percentComplete);
  ['changeOrders', 'payApps', 'subDeals'].forEach(k => { if(!Array.isArray(m[k])) m[k] = []; });
  if(typeof m.notes !== 'string') m.notes = '';
  if(!Array.isArray(m.noteLog)) m.noteLog = [];
  return m;
}
const MONEY_DEFAULT_RULES = [
  { id: 'rule_walmart', match: 'Walmart', startDay: 15, endDay: 20, note: 'Walmart accepts GC payment requests only between the 15th and 20th of each month.' },
  { id: 'rule_samsclub', match: "Sam's Club", startDay: 15, endDay: 20, note: "Sam's Club accepts GC payment requests only between the 15th and 20th of each month." }
];
function ensureMoneySettings(data){
  if(!data.moneySettings || typeof data.moneySettings !== 'object' || Array.isArray(data.moneySettings)){
    data.moneySettings = { opsEmail: '', opsName: '', billingRules: JSON.parse(JSON.stringify(MONEY_DEFAULT_RULES)) };
  }
  const ms = data.moneySettings;
  if(!Array.isArray(ms.billingRules)) ms.billingRules = [];
  if(typeof ms.opsEmail !== 'string') ms.opsEmail = '';
  if(typeof ms.opsName !== 'string') ms.opsName = '';
  if(!ms.labor || typeof ms.labor !== 'object' || Array.isArray(ms.labor)) ms.labor = (typeof LABOR_DEFAULTS !== 'undefined') ? Object.assign({}, LABOR_DEFAULTS) : {};
  return ms;
}

// ---- project totals --------------------------------------------------------------------------
function dealIsPrimary(d){ return d.role !== 'backup'; }
function dealPaid(d){ return moneySum(moneyLive(d.payments).filter(x => x.status === 'paid'), x => x.amount); }
function dealRequested(d){ return moneySum(moneyLive(d.payments).filter(x => x.status !== 'paid'), x => x.amount); }
function dealRemaining(d){ return moneyRound(Math.max(0, moneyNum(d.price) - dealPaid(d) - dealRequested(d))); }
function moneySummary(p){
  // A project that has been closed out keeps only its final numbers (the detail went into its closing packet).
  if(p && p.closed && p.closed.summary) return Object.assign({ missingBackups: [], laborUnknown: [], laborByPhase: {}, laborPeople: [] }, p.closed.summary);
  const m = (p && p.money) || newMoney();
  const orig = moneyNum(m.contractOriginal);
  const pct = moneyClamp(moneyNum(m.percentComplete), 0, 100);
  const cos = moneyLive(m.changeOrders);
  const coApproved = moneySum(cos.filter(c => c.status === 'approved'), c => c.amount);
  const coProposed = moneySum(cos.filter(c => c.status === 'proposed'), c => c.amount);
  const contract = moneyRound(orig + coApproved);
  const earned = moneyRound(orig * pct / 100);
  const apps = moneyLive(m.payApps);
  const prog = apps.filter(a => a.kind !== 'change'), chg = apps.filter(a => a.kind === 'change');
  const progBilled = moneySum(prog.filter(a => a.submitted), a => a.amount);
  const progDraft = moneySum(prog.filter(a => !a.submitted), a => a.amount);
  const chgBilled = moneySum(chg.filter(a => a.submitted), a => a.amount);
  const chgDraft = moneySum(chg.filter(a => !a.submitted), a => a.amount);
  const billed = moneyRound(progBilled + chgBilled);
  const received = moneySum(apps, a => a.received);
  const toBillProgress = moneyRound(Math.max(0, earned - progBilled - progDraft));
  const toBillChange = moneyRound(Math.max(0, coApproved - chgBilled - chgDraft));
  const deals = moneyLive(m.subDeals);
  const primaries = deals.filter(d => dealIsPrimary(d) && d.status !== 'dropped');
  const committed = moneySum(primaries, d => d.price);
  const subPaid = moneySum(deals, dealPaid);
  const subRequested = moneySum(deals, dealRequested);
  const lab = (typeof projectLaborCost === 'function') ? projectLaborCost(p, moneyLaborCtx()) : { total: 0, byPhase: {}, unknown: [], people: [] };
  const margin = moneyRound(contract - committed - lab.total);
  const props = moneyLive((p && p.bids && p.bids.proposals) || []).filter(x => x.status !== 'awarded');
  const dispatchBackup = d => { const h = d.phaseId ? ((p && p.phases) || []).find(x => x.id === d.phaseId) : p; return !!(h && h.backupId) || (!d.phaseId && ((p && p.phases) || []).length > 0 && ((p && p.phases) || []).some(x => x.backupId)); };
  const missingBackups = primaries.filter(d => !dispatchBackup(d) && !deals.some(b => b.role === 'backup' && b.status !== 'dropped' && (b.phaseId || '') === (d.phaseId || '')) &&
    !deals.some(b => b.role === 'backup' && b.status !== 'dropped' && !(b.phaseId)) &&
    !props.some(x => (!x.phaseId || x.phaseId === (d.phaseId || '')) && !(x.personId && x.personId === d.personId)));
  return {
    orig, pct, coApproved, coProposed, contract, earned, progBilled, progDraft, chgBilled, chgDraft, billed, received,
    outstanding: moneyRound(billed - received), toBillProgress, toBillChange, toBill: moneyRound(toBillProgress + toBillChange),
    committed, subPaid, subRequested, subOwed: moneyRound(Math.max(0, committed - subPaid - subRequested)),
    laborCost: lab.total, laborByPhase: lab.byPhase, laborUnknown: lab.unknown, laborPeople: lab.people || [], totalCost: moneyRound(committed + lab.total),
    margin, marginPct: contract > 0 ? moneyRound(margin / contract * 100) : null, cash: moneyRound(received - subPaid),
    missingBackups, hasMoney: orig > 0 || deals.length > 0 || apps.length > 0 || cos.length > 0
  };
}
function payAppStatus(a){
  if(a.void) return 'void';
  if(!a.submitted) return 'draft';
  const rec = moneyNum(a.received);
  if(rec <= 0) return 'submitted';
  return rec + 0.005 >= moneyNum(a.amount) ? 'paid' : 'partial';
}

// ---- billing windows -------------------------------------------------------------------------
function moneyNorm(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function moneyRuleFor(customer, rules){
  const c = moneyNorm(customer);
  if(!c) return null;
  return (rules || []).find(r => !r.void && moneyNorm(r.match) && c.includes(moneyNorm(r.match))) || null;
}
function moneyIso(y, m, d){ return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
function moneyUtc(iso){ const [y, m, d] = String(iso).split('-').map(Number); return Date.UTC(y, m - 1, d); }
function moneyDaysBetween(a, b){ return Math.round((moneyUtc(b) - moneyUtc(a)) / 86400000); }
// The window in a given month (m is 0-based); days past the end of a short month are clamped.
function moneyWindowIn(rule, y, m){
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const s = moneyClamp(Math.round(moneyNum(rule.startDay)) || 1, 1, dim);
  const e = moneyClamp(Math.round(moneyNum(rule.endDay)) || s, s, dim);
  return { start: moneyIso(y, m, s), end: moneyIso(y, m, e) };
}
// Where "today" stands against a rule: open now, or the next one that opens.
function moneyWindowState(rule, todayIso){
  const [y, m] = todayIso.split('-').map(Number);
  const cur = moneyWindowIn(rule, y, m - 1);
  if(todayIso >= cur.start && todayIso <= cur.end) return { open: true, start: cur.start, end: cur.end, opensIn: 0, closesIn: moneyDaysBetween(todayIso, cur.end) };
  const up = todayIso < cur.start ? cur : (m === 12 ? moneyWindowIn(rule, y + 1, 0) : moneyWindowIn(rule, y, m));
  return { open: false, start: up.start, end: up.end, opensIn: moneyDaysBetween(todayIso, up.start), closesIn: null };
}
function moneyInWindow(rule, iso){
  if(!rule || !iso) return true;
  const [y, m] = iso.split('-').map(Number);
  const w = moneyWindowIn(rule, y, m - 1);
  return iso >= w.start && iso <= w.end;
}
function moneyFmtDay(iso){ const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }

// A phase counts as done for the sub-release prompt when it's marked Completed; a deal with no phase
// ("whole project") when the project is.
function dealWorkComplete(p, d){
  if(d.phaseId){ const ph = (p.phases || []).find(x => x.id === d.phaseId); return !!ph && ph.status === 'Completed'; }
  return p.status === 'Completed' || ((p.phases || []).length > 0 && p.phases.every(x => x.status === 'Completed'));
}

// What needs attention, as plain items: { kind, key, text, projectId?, ruleId? }.
//  - window: a customer's billing window is open or opens within MONEY_REMIND_LEAD_DAYS days and there are
//    projects with something to bill that haven't been requested in that window yet.
//  - release: a sub's work is complete and money is still owed to them.
//  - paused: a sub is detached from a project while money is sorted out.
function moneyReminders(data, todayIso){
  const out = [];
  const rules = ((data.moneySettings || {}).billingRules) || [];
  const byRule = new Map();
  (data.projects || []).forEach(p => {
    if(!p.money || p.status === 'Bidding') return;
    const rule = moneyRuleFor(p.customer, rules);
    if(!rule) return;
    const s = moneySummary(p);
    if(!(s.toBill > 0.5)) return;
    const st = moneyWindowState(rule, todayIso);
    if(!st.open && st.opensIn > MONEY_REMIND_LEAD_DAYS) return;
    const already = moneyLive(p.money.payApps).some(a => a.submitted && a.submitted >= st.start && a.submitted <= st.end);
    if(already) return;
    if(!byRule.has(rule.id)) byRule.set(rule.id, { rule, st, projects: [] });
    byRule.get(rule.id).projects.push({ p, s });
  });
  byRule.forEach(({ rule, st, projects }) => {
    const n = projects.length, who = rule.match;
    const span = moneyFmtDay(st.start) + '–' + moneyFmtDay(st.end);
    const when = st.open ? `window is OPEN now (closes ${moneyFmtDay(st.end)}${st.closesIn === 0 ? ', today' : ''})` :
      (st.opensIn === 0 ? 'window opens today' : `window opens in ${st.opensIn} day${st.opensIn === 1 ? '' : 's'} (${span})`);
    out.push({ kind: 'window', key: 'win:' + rule.id + ':' + st.start, ruleId: rule.id, open: st.open,
      text: `${who} pay apps: ${when} — ${n} project${n === 1 ? '' : 's'} ready to bill`, projectId: projects[0].p.id, projectIds: projects.map(x => x.p.id) });
  });
  (data.projects || []).forEach(p => {
    if(!p.money) return;
    moneyLive(p.money.subDeals).forEach(d => {
      const pe = d.personId ? (data.people || []).find(x => x.id === d.personId) : null;
      const name = (pe && pe.name) || d.subName || 'Sub';
      if(d.status === 'paused') out.push({ kind: 'paused', key: 'paused:' + d.id, text: `${name} is detached from ${p.name} while the money is worked out`, projectId: p.id });
      else if(dealIsPrimary(d) && d.status !== 'dropped' && !d.releasedAt && dealWorkComplete(p, d) && dealRemaining(d) > 0.5){
        out.push({ kind: 'release', key: 'rel:' + d.id, text: `${name}: work complete on ${p.name} — ready to release ${moneyFmtUsd(dealRemaining(d))}`, projectId: p.id, dealId: d.id });
      }
    });
  });
  return out;
}
function moneyFmtUsd(n, cents){
  const v = moneyNum(n), neg = v < 0;
  const s = Math.abs(v).toLocaleString('en-US', cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
  return (neg ? '-$' : '$') + s;
}
// ---- years + calendar (v17.1) ----------------------------------------------------------------
function moneyYearOf(iso){ const y = parseInt(String(iso || '').slice(0, 4), 10); return Number.isFinite(y) ? y : null; }
function moneyReceivedDate(a){ return a.receivedDate || a.submitted || ''; }
function moneyPaidDate(y){ return y.paidAt || y.date || ''; }
// What happened in one calendar year on one project, and the open balance the year carried in and out.
function moneyYearActivity(p, year){
  if(p && p.closed && p.closed.years){ const y = p.closed.years[year] || {}; const o = { billed: y.billed || 0, received: y.received || 0, subPaid: y.subPaid || 0, outStart: y.outStart || 0, outEnd: y.outEnd || 0 }; o.active = o.billed > 0 || o.received > 0 || o.subPaid > 0 || o.outEnd > 0.5 || o.outStart > 0.5; return o; }
  const m = (p && p.money) || newMoney();
  const apps = moneyLive(m.payApps).filter(a => a.submitted);
  const endOf = y => y + '-12-31';
  const billedTo = d => moneySum(apps.filter(a => a.submitted <= d), a => a.amount);
  const recTo = d => moneySum(apps.filter(a => moneyNum(a.received) > 0 && moneyReceivedDate(a) <= d), a => a.received);
  const billed = moneySum(apps.filter(a => moneyYearOf(a.submitted) === year), a => a.amount);
  const received = moneySum(apps.filter(a => moneyNum(a.received) > 0 && moneyYearOf(moneyReceivedDate(a)) === year), a => a.received);
  let subPaid = 0;
  moneyLive(m.subDeals).forEach(d => moneyLive(d.payments).forEach(y => { if(y.status === 'paid' && moneyYearOf(moneyPaidDate(y)) === year) subPaid += moneyNum(y.amount); }));
  subPaid = moneyRound(subPaid);
  const outEnd = moneyRound(billedTo(endOf(year)) - recTo(endOf(year)));
  const outStart = moneyRound(billedTo(endOf(year - 1)) - recTo(endOf(year - 1)));
  return { billed, received, subPaid, outStart, outEnd, active: billed > 0 || received > 0 || subPaid > 0 || outEnd > 0.5 || outStart > 0.5 };
}
function moneyYearsPresent(data, thisYear){
  const ys = new Set([thisYear]);
  (data.projects || []).forEach(p => {
    if(p.closed && p.closed.years) Object.keys(p.closed.years).forEach(y => { const n = parseInt(y, 10); if(n) ys.add(n); });
    const m = p.money; if(!m) return;
    moneyLive(m.payApps).forEach(a => { [a.submitted, a.receivedDate].forEach(d => { const y = moneyYearOf(d); if(y) ys.add(y); }); });
    moneyLive(m.subDeals).forEach(d => moneyLive(d.payments).forEach(y => { const yy = moneyYearOf(moneyPaidDate(y)); if(yy) ys.add(yy); }));
  });
  return Array.from(ys).sort((a, b) => b - a);
}
// What must be true before a project can be closed out. Shared by the page and the server (the server re-checks).
function projectCloseReadiness(p){
  const s = moneySummary(p), m = (p && p.money) || newMoney(), deals = moneyLive(m.subDeals);
  const draftsN = moneyLive(m.payApps).filter(a => !a.submitted).length;
  const money = s.hasMoney;
  const usd = n => '$' + Math.round(n).toLocaleString('en-US');
  const checks = [
    { key: 'completed', ok: !!p && p.status === 'Completed', label: 'The work is marked Completed', detail: 'Set the project status to Completed when the field work is done.' },
    { key: 'billed', ok: !money || (s.pct >= 100 && s.toBill <= 0.5 && draftsN === 0), label: 'Everything is billed to the GC', detail: !money ? '' : (s.pct < 100 ? 'Percent complete is ' + s.pct + '%.' : (s.toBill > 0.5 ? usd(s.toBill) + ' is still ready to bill.' : (draftsN ? draftsN + ' payment request(s) were never sent.' : ''))) },
    { key: 'received', ok: !money || s.outstanding <= 0.5 || !!(p && p.handoff && p.handoff.at), label: 'The GC has paid everything billed, or it was handed off to Collections', detail: s.outstanding > 0.5 ? 'The GC still owes ' + usd(s.outstanding) + '. Hand it off to Collections to close out anyway.' : '' },
    { key: 'subs', ok: !money || (s.subRequested <= 0.5 && moneyRound(s.committed - s.subPaid) <= 0.5), label: 'Every sub is paid', detail: s.subRequested > 0.5 ? usd(s.subRequested) + ' in sub checks is requested but not marked paid.' : (moneyRound(s.committed - s.subPaid) > 0.5 ? usd(s.committed - s.subPaid) + ' is still owed to subs.' : '') },
    { key: 'changeorders', ok: s.coProposed <= 0.5, label: 'No change orders are still pending', detail: s.coProposed > 0.5 ? usd(s.coProposed) + ' in change orders is only proposed (approve, reject or void it).' : '' },
    { key: 'detached', ok: !deals.some(d => d.status === 'paused'), label: 'No sub is detached', detail: 'A sub is detached while the money is being worked out.' },
  ];
  return { ready: checks.every(c => c.ok), checks };
}
// The numbers a closed project keeps (everything else goes into its closing packet).
function projectCloseSnapshot(p){
  const s = moneySummary(p), years = {}, ys = new Set(), m = (p && p.money) || newMoney();
  moneyLive(m.payApps).forEach(a => { [a.submitted, a.receivedDate].forEach(d => { const y = moneyYearOf(d); if(y) ys.add(y); }); });
  moneyLive(m.subDeals).forEach(d => moneyLive(d.payments).forEach(y => { const yy = moneyYearOf(moneyPaidDate(y)); if(yy) ys.add(yy); }));
  ys.forEach(y => { const a = moneyYearActivity(p, y); years[y] = { billed: a.billed, received: a.received, subPaid: a.subPaid, outStart: a.outStart, outEnd: a.outEnd }; });
  const keep = {};
  ['orig','pct','coApproved','coProposed','contract','earned','progBilled','progDraft','chgBilled','chgDraft','billed','received','outstanding','toBillProgress','toBillChange','toBill','committed','subPaid','subRequested','subOwed','laborCost','totalCost','margin','marginPct','cash','hasMoney'].forEach(k => { keep[k] = s[k]; });
  return { summary: keep, years };
}
// Everything dated in one month, for the Pay Apps calendar: { days: { iso: [event] }, windows: { iso: [label] }, reminders: { iso: [label] } }
function moneyCalendarEvents(data, y, m0){
  const days = {}, windows = {}, reminders = {};
  const dim = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  const inMonth = iso => iso && moneyYearOf(iso) === y && parseInt(iso.slice(5, 7), 10) === m0 + 1;
  const add = (iso, ev) => { if(inMonth(iso)) (days[iso] = days[iso] || []).push(ev); };
  ((data.moneySettings || {}).billingRules || []).forEach(r => {
    if(r.void) return;
    const w = moneyWindowIn(r, y, m0);
    for(let d = parseInt(w.start.slice(8), 10); d <= parseInt(w.end.slice(8), 10); d++){ const iso = moneyIso(y, m0, d); (windows[iso] = windows[iso] || []).push(r.match); }
    const lead = new Date(moneyUtc(w.start) - MONEY_REMIND_LEAD_DAYS * 86400000).toISOString().slice(0, 10);
    if(inMonth(lead)) (reminders[lead] = reminders[lead] || []).push(r.match);
  });
  (data.projects || []).forEach(p => {
    const m = p.money; if(!m) return;
    moneyLive(m.payApps).forEach(a => {
      const who = p.name;
      if(a.submitted) add(a.submitted, { kind: 'sent', amount: moneyNum(a.amount), project: who, projectId: p.id, text: 'Sent ' + (a.kind === 'change' ? 'change order ' : '') + moneyFmtUsd(a.amount) });
      if(moneyNum(a.received) > 0 && a.receivedDate) add(a.receivedDate, { kind: 'received', amount: moneyNum(a.received), project: who, projectId: p.id, text: 'Received ' + moneyFmtUsd(a.received) });
    });
    moneyLive(m.subDeals).forEach(d => moneyLive(d.payments).forEach(y => {
      const nm = d.subName || ((data.people || []).find(x => x.id === d.personId) || {}).name || 'Sub';
      if(y.status === 'paid') add(moneyPaidDate(y), { kind: 'subpaid', amount: moneyNum(y.amount), project: p.name, projectId: p.id, text: 'Paid ' + nm + ' ' + moneyFmtUsd(y.amount) });
      else add(y.date, { kind: 'subreq', amount: moneyNum(y.amount), project: p.name, projectId: p.id, text: 'Check requested: ' + nm + ' ' + moneyFmtUsd(y.amount) });
    }));
  });
  return { days, windows, reminders, dim };
}
// What should be processed on a given day: for every billing rule whose window includes the day, the projects of that
// customer with something ready to bill (and those already billed in this window). { rule, ready: [{p, s}], billed: [{p, amount}] }
function moneyDueOnDay(data, iso){
  const out = [];
  ((data.moneySettings || {}).billingRules || []).forEach(rule => {
    if(rule.void || !moneyInWindow(rule, iso)) return;
    const [y, m] = iso.split('-').map(Number), w = moneyWindowIn(rule, y, m - 1);
    const ready = [], billed = [];
    (data.projects || []).forEach(p => {
      if(!p.money || p.closed || p.status === 'Bidding') return;
      if(moneyRuleFor(p.customer, [rule]) !== rule) return;
      const s = moneySummary(p);
      const sent = moneyLive(p.money.payApps).filter(a => a.submitted && a.submitted >= w.start && a.submitted <= w.end);
      if(s.toBill > 0.5 && !sent.length) ready.push({ p, s });
      else if(sent.length) billed.push({ p, amount: moneySum(sent, a => a.amount) });
    });
    out.push({ rule, start: w.start, end: w.end, ready, billed });
  });
  return out;
}
/* MONEY-CALC-END */
/* BIDS-CALC-START — proposals from subs: status, margin, reminders (pure; unit-tested outside the page) */
function newBids(){ return { dueAt: '', scope: '', invites: [], proposals: [] }; }
function ensureBids(p){
  if(!p) return null;
  if(!p.bids || typeof p.bids !== 'object' || Array.isArray(p.bids)) p.bids = newBids();
  const b = p.bids;
  if(typeof b.dueAt !== 'string') b.dueAt = '';
  if(typeof b.scope !== 'string') b.scope = '';
  ['invites', 'proposals'].forEach(k => { if(!Array.isArray(b[k])) b[k] = []; });
  return b;
}
// The live primary sub on a project, if one has been awarded or attached (any phase).
function bidAwardedDeals(p){
  return moneyLive((p && p.money && p.money.subDeals) || []).filter(d => d.role !== 'backup' && d.status !== 'dropped');
}
// What the margin would be if this price were awarded for this scope ('' = whole project). Awarding the
// whole project replaces every other primary; awarding a phase keeps the primaries on the other phases.
function bidMarginIf(p, price, phaseId){
  const s = moneySummary(p);
  const ph = phaseId || '';
  let others = ph ? moneySum(bidAwardedDeals(p).filter(d => (d.phaseId || '') !== ph), d => d.price) : 0;
  if(ph) Object.keys(s.laborByPhase || {}).forEach(k => { if(k !== ph) others = moneyRound(others + s.laborByPhase[k]); });
  const margin = moneyRound(s.contract - others - moneyNum(price));
  return { contract: s.contract, margin, pct: s.contract > 0 ? moneyRound(margin / s.contract * 100) : null };
}
// Per sub: 'proposal' (they sent one), 'declined', 'invited' (e-mailed, waiting), 'listed' (picked, not e-mailed yet).
function bidInviteState(p, inv){
  const b = p.bids || newBids();
  if(moneyLive(b.proposals).some(x => inv.personId ? x.personId === inv.personId : (x.subName && x.subName === inv.subName))) return 'proposal';
  if(inv.declined) return 'declined';
  return inv.invitedAt ? 'invited' : 'listed';
}
function bidStatusOf(p, nowMs){
  const b = p.bids || newBids();
  const invites = moneyLive(b.invites), props = moneyLive(b.proposals);
  const sent = invites.filter(i => i.invitedAt).length;
  const declined = invites.filter(i => bidInviteState(p, i) === 'declined').length;
  const waiting = invites.filter(i => bidInviteState(p, i) === 'invited').length;
  const due = b.dueAt ? new Date(b.dueAt).getTime() : null;
  const pastDue = !!due && Number.isFinite(due) && nowMs > due;
  const awarded = bidAwardedDeals(p).length > 0 || props.some(x => x.status === 'awarded');
  const open = props.filter(x => x.status !== 'passed' || true);
  const best = open.length ? open.reduce((a, x) => moneyNum(x.price) < moneyNum(a.price) ? x : a) : null;
  let state;
  if(awarded) state = 'awarded';
  else if(props.length && (waiting === 0 || pastDue)) state = 'ready';
  else if(sent > 0 && pastDue) state = 'overdue';
  else if(sent > 0) state = 'collecting';
  else if(invites.length) state = 'notsent';
  else state = 'notstarted';
  return { state, invites: invites.length, sent, declined, waiting, proposals: props.length, best, due, pastDue, awarded };
}
const BID_STATE_LABEL = { overdue: 'Overdue', ready: 'Ready to Award', collecting: 'Collecting', notsent: 'Invites Not Sent', notstarted: 'Not Started', awarded: 'Awarded' };
// Reminders for the PM/Owner: a deadline within 24 hours (or passed) with subs who haven't answered.
function bidReminders(data, nowMs){
  const out = [];
  (data.projects || []).forEach(p => {
    if(p.status === 'Completed' || !p.bids) return;
    const st = bidStatusOf(p, nowMs);
    if(st.awarded || !st.sent || !st.due || !(st.waiting > 0)) return;
    const hrs = (st.due - nowMs) / 3600000;
    if(hrs > 24) return;
    const when = hrs < 0 ? 'deadline has passed' : (hrs < 1 ? 'due within the hour' : 'due in ' + Math.round(hrs) + ' hour' + (Math.round(hrs) === 1 ? '' : 's'));
    out.push({ kind: 'bid', key: 'bid:' + p.id + ':' + (hrs < 0 ? 'late' : 'soon'), projectId: p.id,
      text: `Proposals for ${p.name}: ${when} — ${st.waiting} of ${st.sent} sub${st.sent === 1 ? '' : 's'} still haven't answered` });
  });
  return out;
}
// A deadline that has passed with subs who never answered (and nothing awarded yet).
function bidOverdueInfo(p, nowMs){
  if(!p || !p.bids || p.status === 'Completed') return null;
  const st = bidStatusOf(p, nowMs);
  if(st.awarded || !st.sent || !st.pastDue || !(st.waiting > 0)) return null;
  return { waiting: st.waiting, sent: st.sent, due: st.due };
}
// Margin below the owner's minimum on a job that has a contract and a committed sub.
function bidLowMargin(p, minPct){
  if(!p || p.status === 'Completed' || p.status === 'Bidding') return null;
  const s = moneySummary(p);
  if(!(s.contract > 0) || !(s.committed > 0) || s.marginPct == null) return null;
  return s.marginPct < minPct ? { pct: s.marginPct, margin: s.margin, contract: s.contract, committed: s.committed, min: minPct } : null;
}
// Projects with a working primary sub but no backup (deal or proposal) on file - a task, not a toast.
function backupReminders(data){
  const out = [];
  (data.projects || []).forEach(p => {
    if(!p.money || p.status === 'Completed' || p.status === 'Bidding') return;
    const s = moneySummary(p);
    if(!s.missingBackups.length) return;
    out.push({ kind: 'backup', key: 'backup:' + p.id, projectId: p.id, text: `${p.name}: no backup sub on file - get a backup proposal so a drop-out doesn't stall the job` });
  });
  return out;
}
// ONE grouped task: active projects (or phases) with no man-days yet. Man-days drive every crew-cost estimate.
function mandaysReminders(data){
  const names = [], ids = [];
  (data.projects || []).forEach(p => {
    if(p.status === 'Completed') return;
    const missing = (p.phases && p.phases.length) ? p.phases.filter(ph => ph.status !== 'Completed' && !(moneyNum(ph.manDays) > 0)).length > 0 : !(moneyNum(p.manDays) > 0);
    if(missing){ names.push(p.name); ids.push(p.id); }
  });
  if(!ids.length) return [];
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');
  return [{ kind: 'mandays', key: 'mandays:' + ids.length, projectId: ids[0], projectIds: ids, text: `${ids.length} project${ids.length === 1 ? '' : 's'} still need man-days (${shown}) - needed to estimate crew cost and margin` }];
}
// Would swapping this sub's price in still clear the minimum margin?  { ok, pct, delta } (ok is true when unknown)
function swapPriceCheck(p, currentPrice, newPrice, phaseId, minPct){
  if(!(currentPrice > 0) || !(newPrice > 0)) return { ok: true, known: false, delta: null, pct: null };
  const s = moneySummary(p), delta = moneyRound(newPrice - currentPrice);
  if(!(s.contract > 0)) return { ok: delta <= 0, known: true, delta, pct: null };
  const margin = moneyRound(s.contract - (s.committed + delta));
  const pct = moneyRound(margin / s.contract * 100);
  return { ok: delta <= 0 ? true : pct >= minPct, known: true, delta, pct };
}
/* BIDS-CALC-END */
/* LABOR-CALC-START — in-house labor cost (W-2 wage + burden, temp laborers) and crew-option building (pure; unit-tested outside the page) */
let MONEY_LABOR_CTX = null;   // the page sets this to () => ({ people, labor }) so moneySummary can include in-house labor
const LABOR_DEFAULTS = { burdenPct: 25, hoursPerDay: 8, tempAgency: '', tempRatePerHr: 0, maxTempsPerW2: 1, subRatePerPersonDay: 1000 };
function laborClean(l){
  const o = Object.assign({}, LABOR_DEFAULTS, (l && typeof l === 'object') ? l : {});
  o.burdenPct = moneyClamp(moneyNum(o.burdenPct), 0, 200); o.hoursPerDay = moneyClamp(moneyNum(o.hoursPerDay) || 8, 1, 24);
  o.tempRatePerHr = Math.max(0, moneyNum(o.tempRatePerHr)); o.maxTempsPerW2 = moneyClamp(Math.round(moneyNum(o.maxTempsPerW2)), 0, 10);
  o.subRatePerPersonDay = Math.max(0, moneyNum(o.subRatePerPersonDay));
  o.tempAgency = String(o.tempAgency || '');
  return o;
}
function w2Wage(person){ return (person && person.type === 'w2' && !person.wageVoid && moneyNum(person.wage) > 0) ? moneyNum(person.wage) : 0; }
// Cost of one crew doing `manDays` person-days: the work is split evenly over everyone on the crew (W-2s + temps).
// W-2 hourly cost = wage x (1 + burden). Returns null when it can't be estimated.
function laborCrewCost(manDays, wages, temps, labor){
  const L = laborClean(labor), n = (wages || []).length + (temps || 0);
  if(!(moneyNum(manDays) > 0) || n < 1) return null;
  const hoursEach = moneyNum(manDays) / n * L.hoursPerDay;
  const w2 = moneyRound((wages || []).reduce((a, w) => a + w * (1 + L.burdenPct / 100) * hoursEach, 0));
  const tmp = moneyRound((temps || 0) * L.tempRatePerHr * hoursEach);
  return { cost: moneyRound(w2 + tmp), w2Cost: w2, tempCost: tmp, hoursEach: moneyRound(hoursEach), people: n };
}
// Every place a W-2/temp crew can be assigned on a project: the project itself, or each phase.
function laborHolders(p){
  const ph = (p && p.phases) || [];
  return ph.length ? ph.map(x => ({ holder: x, phaseId: x.id, label: 'Phase ' + x.number })) : [{ holder: p, phaseId: '', label: p && p.name }];
}
// In-house labor on a project: { total, byPhase: {phaseId: cost}, unknown: [{label, reason, names?}] }
function projectLaborCost(p, ctx){
  const out = { total: 0, byPhase: {}, unknown: [], people: [] };
  if(!ctx || !p) return out;
  const people = ctx.people || [];
  laborHolders(p).forEach(({ holder, phaseId, label }) => {
    const w2s = (holder.assignedIds || []).map(id => people.find(x => x.id === id)).filter(x => x && x.type === 'w2');
    const provs = (holder.assignedIds || []).map(id => people.find(x => x.id === id)).filter(x => x && x.type === 'temp');   // Temp For Hire providers: k people each at a per-person-day rate
    const provPeople = provs.map(x => Math.max(1, Math.round(moneyNum(holder.providerPeople && holder.providerPeople[x.id]) || 1)));
    const temps = (holder.tempLaborers && moneyNum(holder.tempLaborers.count)) || 0;
    if(!w2s.length && !temps && !provs.length) return;
    const md = moneyNum(holder.manDays);
    if(!(md > 0)){ out.unknown.push({ label, reason: 'mandays' }); return; }
    const noWage = w2s.filter(x => !w2Wage(x));
    if(noWage.length){ out.unknown.push({ label, reason: 'wage', names: noWage.map(x => x.name) }); return; }
    const temp = holder.tempLaborers || {};
    const rate = moneyNum(temp.ratePerHr) > 0 ? moneyNum(temp.ratePerHr) : laborClean(ctx.labor).tempRatePerHr;
    const provHeads = provPeople.reduce((a, b) => a + b, 0);
    const c = laborCrewCost(md, w2s.map(w2Wage), temps + provHeads, Object.assign({}, ctx.labor, { tempRatePerHr: provHeads ? 0 : rate }));
    if(c){
      let cost = c.cost;
      if(provHeads){ cost = moneyRound(c.w2Cost + (temps ? moneyRound(temps * rate * c.hoursEach) : 0) + provs.reduce((a, x, i) => a + provPeople[i] * (md / c.people) * (moneyNum(x.dayRate) > 0 ? moneyNum(x.dayRate) : laborClean(ctx.labor).subRatePerPersonDay), 0)); }
      out.byPhase[phaseId] = cost; out.total = moneyRound(out.total + cost);
      const bf = 1 + laborClean(ctx.labor).burdenPct / 100;
      w2s.forEach(x => out.people.push({ id: x.id, name: x.name, type: 'w2', phaseId, cost: moneyRound(w2Wage(x) * bf * c.hoursEach) }));
      provs.forEach((x, i) => out.people.push({ id: x.id, name: x.name, type: 'temp', phaseId, heads: provPeople[i], cost: moneyRound(provPeople[i] * (md / c.people) * (moneyNum(x.dayRate) > 0 ? moneyNum(x.dayRate) : laborClean(ctx.labor).subRatePerPersonDay)) }));
    }
  });
  return out;
}
function moneyLaborCtx(){ try{ return MONEY_LABOR_CTX ? MONEY_LABOR_CTX() : null; }catch(e){ return null; } }
// All the ways to staff `need` more heads in-house: w new W-2s + t temps (t <= maxTempsPerW2 x all W-2s on the crew, at least one W-2 on site).
// candidates: [{ id, name, wage, skills, miles, grade }], fixed: W-2s already on the crew [{ id, wage, skills }].
// One best option per (w, t): skills must be covered by the W-2s (temps are general labor), cheapest wages first. Returns [] if nothing fits.
function buildCrewOptions(a){
  const L = laborClean(a.labor), need = a.need, fixed = a.fixed || [], req = a.requiredSkills || [];
  if(!(need > 0) || !(moneyNum(a.manDays) > 0)) return [];
  const tempsOk = L.tempRatePerHr > 0 && L.maxTempsPerW2 > 0;
  const cands = (a.candidates || []).filter(c => c.wage > 0);
  const fixedSkills = new Set(); fixed.forEach(f => (f.skills || []).forEach(s => fixedSkills.add(s)));
  const rel = c => (c.skills || []).filter(s => req.includes(s)).length;
  const pool = cands.slice().sort((x, y) => (rel(y) - rel(x)) || (x.wage - y.wage) || (x.miles - y.miles)).slice(0, 12);
  const combos = (arr, k) => { const res = []; (function go(i, cur){ if(cur.length === k){ res.push(cur.slice()); return; } for(let j = i; j < arr.length; j++){ cur.push(arr[j]); go(j + 1, cur); cur.pop(); } })(0, []); return res; };
  const out = [];
  for(let w = 0; w <= Math.min(need, pool.length); w++){
    const t = need - w;
    if(fixed.length + w < 1) continue;
    if(t > 0 && (!tempsOk || t > L.maxTempsPerW2 * (fixed.length + w))) continue;
    let best = null;
    combos(pool, w).forEach(cb => {
      const covered = new Set(fixedSkills); cb.forEach(c => (c.skills || []).forEach(s => covered.add(s)));
      if(!req.every(s => covered.has(s))) return;
      const wages = fixed.map(f => f.wage).concat(cb.map(c => c.wage));
      const c = laborCrewCost(a.manDays, wages, t, L); if(!c) return;
      const miles = cb.length ? cb.reduce((s, x) => s + x.miles, 0) / cb.length : 0;
      if(!best || c.cost < best.cost - 0.005 || (Math.abs(c.cost - best.cost) <= 0.005 && miles < best.miles)) best = { w2: cb, temps: t, cost: c.cost, w2Cost: c.w2Cost, tempCost: c.tempCost, hoursEach: c.hoursEach, miles };
    });
    if(best) out.push(best);
  }
  // W-2s + people from ONE Temp For Hire provider (a COMBO): they supply k people at a per-person-day rate (their own, else the Labor Rates default) (placeholder until real terms),
  // W-2s fill the rest, never more people than the job needs. Skills must be covered by the whole crew together.
  const subs = (a.subCandidates || []).filter(x => x && x.id);
  subs.forEach(sb => {
    const rateDay = moneyNum(sb.rate) > 0 ? moneyNum(sb.rate) : L.subRatePerPersonDay;
    if(!(rateDay > 0)) return;
    const maxK = Math.max(1, Math.min(Math.round(moneyNum(sb.teamSize)) || 1, need));
    for(let k = 1; k <= maxK; k++){
      const w = need - k;
      if(fixed.length + w < 1) continue;
      const found = [];
      combos(pool, w).forEach(cb => {
        const covered = new Set(fixedSkills); cb.forEach(c => (c.skills || []).forEach(x => covered.add(x))); (sb.skills || []).forEach(x => covered.add(x));
        const missingSkills = req.filter(x => !covered.has(x));   // a combo may still be shown with a gap, flagged, so nothing useful is hidden
        const wages = fixed.map(f => f.wage).concat(cb.map(c => c.wage));
        const c = laborCrewCost(a.manDays, wages, k, Object.assign({}, L, { tempRatePerHr: 0 })); if(!c) return;
        const subCost = moneyRound(k * (moneyNum(a.manDays) / c.people) * rateDay);
        const total = moneyRound(c.w2Cost + subCost);
        const heads = cb.length + k, miles = heads ? (cb.reduce((m, x) => m + x.miles, 0) + k * (sb.miles || 0)) / heads : 0;
        found.push({ w2: cb, temps: 0, sub: { id: sb.id, name: sb.name, people: k, cost: subCost, grade: sb.grade, rate: rateDay }, cost: total, w2Cost: c.w2Cost, tempCost: 0, subCost, hoursEach: c.hoursEach, miles, missingSkills });
      });
      const fewest = found.reduce((m, x) => Math.min(m, x.missingSkills.length), Infinity);
      found.filter(x => x.missingSkills.length === fewest).forEach(x => out.push(x));
    }
  });
  return out.sort((x, y) => x.cost - y.cost);
}
/* LABOR-CALC-END */
MONEY_LABOR_CTX = () => ({ people: board.people || [], labor: laborClean(board.moneySettings && board.moneySettings.labor) });
return { moneySummary, projectCloseReadiness, projectCloseSnapshot, moneyLive, moneyNum, moneyRound, dealPaid, dealRequested, payAppStatus, projectLaborCost, laborClean, w2Wage, bidStatusOf };
};
