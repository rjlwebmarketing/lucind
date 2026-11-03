// The closing packet: one PDF (for people) + one JSON (for machines / a later reopen) holding everything that
// happened on a project. Built on the server so it works for any login and so the Drive upload can be verified
// before anything is removed from the app.
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const TZ = process.env.PACKET_TZ || 'America/New_York';
const MARGIN = 50, PAGE_W = 612, PAGE_H = 792, BODY_W = PAGE_W - MARGIN * 2;
const INK = rgb(0.1, 0.1, 0.12), DIM = rgb(0.4, 0.4, 0.45), LINE = rgb(0.8, 0.8, 0.84), HEAD = rgb(0.93, 0.94, 0.96), BAD = rgb(0.7, 0.1, 0.1);

const ROLE = { pm: 'PM', owner: 'Owner', builder: 'Builder' };
const roleLabel = r => ROLE[r] || str(r);
const str = v => (v === null || v === undefined) ? '' : String(v);
// The built-in PDF fonts only know Latin-1, so anything else is swapped for a plain look-alike.
function clean(v) {
  return str(v).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/→/g, '->').replace(/…/g, '...').replace(/•/g, '*')
    .replace(/[\r\t]+/g, ' ').replace(/[^\n\x20-\x7E -ÿ]/g, '?');
}
const usd = n => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) ? '' : (Number(n) < 0 ? '-$' : '$') + Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = v => { if (!v) return ''; const d = new Date(v); if (!Number.isFinite(d.getTime())) return str(v); return d.toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const day = v => { if (!v) return ''; const s = str(v).slice(0, 10); const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s); if (!m) return str(v); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }); };

// Pay app notes: the old single note plus the dated note list.
function noteText(m) {
  m = m || {};
  const lines = (Array.isArray(m.noteLog) ? m.noteLog : []).map(n => (n.at ? day(n.at) + ': ' : '') + str(n.text));
  if (m.notes) lines.push(str(m.notes));
  return lines.join('\n');
}
// ---- file names -------------------------------------------------------------------------------------
const safeName = s => clean(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
function packetBaseName(p, closedAtIso) {
  const year = new Date(closedAtIso).getFullYear();
  const type = [p.customer, p.storeNumber].map(x => safeName(x)).filter(Boolean).join(' ');
  const place = [p.city, p.state].map(x => safeName(x)).filter(Boolean).join(' ');
  return [safeName(p.code || 'LI-??????'), String(year), type, place, 'Closing Packet'].filter(Boolean).join(' - ');
}

// ---- a tiny layout engine on top of pdf-lib ---------------------------------------------------------
class Layout {
  constructor(pdf, fonts, footerLabel) { this.pdf = pdf; this.f = fonts; this.footer = footerLabel; this.page = null; this.y = 0; this.newPage(); }
  newPage() { this.page = this.pdf.addPage([PAGE_W, PAGE_H]); this.y = PAGE_H - MARGIN; }
  need(h) { if (this.y - h < MARGIN + 18) this.newPage(); }
  wrap(text, font, size, width) {
    const out = [];
    for (const para of clean(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const cand = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(cand, size) <= width) { line = cand; continue; }
        if (line) out.push(line);
        let w = word;   // a single very long word: hard-split it
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) { let n = w.length - 1; while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n--; out.push(w.slice(0, n)); w = w.slice(n); }
        line = w;
      }
      out.push(line);
    }
    return out;
  }
  text(t, o = {}) {
    const font = o.bold ? this.f.bold : (o.mono ? this.f.mono : this.f.reg), size = o.size || 10, lh = size * 1.3;
    for (const line of this.wrap(t, font, size, o.width || BODY_W)) { this.need(lh); this.page.drawText(line, { x: (o.x || MARGIN), y: this.y - size, size, font, color: o.color || INK }); this.y -= lh; }
    this.y -= (o.after || 0);
  }
  h1(t) { this.text(t, { bold: true, size: 20, after: 4 }); }
  h2(t) { this.need(40); this.y -= 8; this.page.drawRectangle({ x: MARGIN, y: this.y - 17, width: BODY_W, height: 20, color: HEAD }); this.page.drawText(clean(t), { x: MARGIN + 6, y: this.y - 12, size: 11.5, font: this.f.bold, color: INK }); this.y -= 26; }
  note(t) { this.text(t, { size: 9, color: DIM, after: 4 }); }
  kv(rows) { for (const [k, v, strong] of rows) { this.need(14); this.page.drawText(clean(k), { x: MARGIN, y: this.y - 10, size: 10, font: this.f.reg, color: DIM }); const lines = this.wrap(v === '' || v === null || v === undefined ? '-' : v, strong ? this.f.bold : this.f.reg, 10, BODY_W - 190); lines.forEach((ln, i) => { if (i) this.need(13); this.page.drawText(ln, { x: MARGIN + 190, y: this.y - 10, size: 10, font: strong ? this.f.bold : this.f.reg, color: INK }); if (i < lines.length - 1) this.y -= 13; }); this.y -= 14; } this.y -= 4; }
  // columns: [{ label, w (fraction), right }]; rows: arrays of strings (a row may be { cells, dim, bad })
  table(columns, rows, emptyText) {
    if (!rows.length) { this.text(emptyText || 'None.', { size: 9.5, color: DIM, after: 4 }); return; }
    const widths = columns.map(c => c.w * BODY_W), size = 8.5, lh = 11;
    const head = () => { this.need(lh + 10 + 26); this.page.drawRectangle({ x: MARGIN, y: this.y - lh - 3, width: BODY_W, height: lh + 5, color: HEAD }); let x = MARGIN; columns.forEach((c, i) => { this.page.drawText(clean(c.label), { x: x + 3, y: this.y - lh + 1, size, font: this.f.bold, color: INK }); x += widths[i]; }); this.y -= lh + 6; };
    head();
    for (const r of rows) {
      const cells = r.cells || r, color = r.bad ? BAD : (r.dim ? DIM : INK);
      const wrapped = cells.map((c, i) => this.wrap(c === '' || c === null || c === undefined ? '' : c, this.f.reg, size, widths[i] - 6));
      const h = Math.max(...wrapped.map(w => w.length)) * lh + 4;
      if (this.y - h < MARGIN + 18) { this.newPage(); head(); }
      let x = MARGIN;
      wrapped.forEach((lines, i) => { lines.forEach((ln, k) => { const wdt = this.f.reg.widthOfTextAtSize(ln, size); this.page.drawText(ln, { x: columns[i].right ? x + widths[i] - 3 - wdt : x + 3, y: this.y - 9 - k * lh, size, font: this.f.reg, color }); }); x += widths[i]; });
      this.y -= h; this.page.drawLine({ start: { x: MARGIN, y: this.y + 1 }, end: { x: MARGIN + BODY_W, y: this.y + 1 }, thickness: 0.4, color: LINE });
    }
    this.y -= 6;
  }
  finish() {
    const pages = this.pdf.getPages();
    pages.forEach((pg, i) => pg.drawText(clean(this.footer + '   |   page ' + (i + 1) + ' of ' + pages.length), { x: MARGIN, y: 26, size: 8, font: this.f.reg, color: DIM }));
  }
}

// ---- turning money archive paths into words (same idea as the page) -------------------------------------
const FIELD = { amount: 'amount', desc: 'description', status: 'status', date: 'date', void: 'void', price: 'price', submitted: 'date sent', received: 'received', receivedDate: 'date received', contractOriginal: 'original contract value', percentComplete: '% complete', period: 'period', kind: 'type', notes: 'notes', role: 'role', phaseId: 'phase', subName: 'sub name', personId: 'sub', paidAt: 'date paid', wage: 'hourly wage', wageVoid: 'wage void', dueAt: 'proposal deadline', scope: 'scope', validUntil: 'valid until', receivedAt: 'date received' };
function pathLabel(p, path) {
  const m = p && p.money, b = p && p.bids;
  const m1 = /^(changeOrders|payApps|subDeals|invites|proposals)\[([^\]]+)\](?:\.(.+))?$/.exec(path);
  const m2 = /^bids\.(invites|proposals)\[([^\]]+)\](?:\.(.+))?$/.exec(path);
  const mm = m2 || m1; if (!mm) return FIELD[path] || path;
  const list = m2 ? m2[1] : m1[1], id = m2 ? m2[2] : m1[2], rest = m2 ? m2[3] : m1[3];
  const kind = { changeOrders: 'Change order', payApps: 'Payment request', subDeals: 'Sub', invites: 'Proposal invite', proposals: 'Proposal' }[list];
  const src = list === 'invites' || list === 'proposals' ? (b && b[list]) : (m && m[list]);
  const rec = (src || []).find(x => x && String(x.id) === id);
  const name = rec ? (rec.desc || rec.subName || rec.period || rec.kind || id) : id;
  const isPay = rest && rest.indexOf('payments[') === 0;
  return kind + ' "' + name + '" - ' + (isPay ? 'payment ' : '') + (rest ? (FIELD[rest.split('.').pop()] || rest) : 'entry');
}

// ---- assembling the facts -------------------------------------------------------------------------------
function gather(board, project, calc, extra) {
  const people = board.people || [];
  const personName = id => (people.find(x => x && x.id === id) || {}).name || id || '';
  const subName = d => d.personId ? personName(d.personId) : (d.subName || 'Sub');
  const phaseLabel = id => { const ph = (project.phases || []).find(x => x.id === id); return id ? (ph ? 'Phase ' + ph.number : id) : 'Whole project'; };
  const live = arr => (arr || []).filter(x => x && !x.void);
  const money = project.money || {};
  const summary = calc.moneySummary(project);
  const worked = [];   // everyone whose work history touches this project
  for (const pe of people) for (const h of (pe.history || [])) if (h.projectId === project.id) worked.push({ personId: pe.id, name: pe.name, type: pe.type, phase: h.phase || '', from: h.from, to: h.to });
  worked.sort((a, b) => str(a.from).localeCompare(str(b.from)));
  const w2ids = new Set(worked.filter(w => w.type === 'w2').map(w => w.personId));
  (project.assignedIds || []).forEach(id => { const pe = people.find(x => x && x.id === id); if (pe && pe.type === 'w2') w2ids.add(id); });
  const labor = calc.laborClean(board.moneySettings && board.moneySettings.labor);
  const w2s = [...w2ids].map(id => { const pe = people.find(x => x && x.id === id) || {}; return { id, name: pe.name || id, wage: pe.wage || null, wageVoid: !!pe.wageVoid }; });
  const log = [];
  (extra.events || []).forEach(e => log.push({ at: e.at, by: e.by, byName: e.byName, what: e.field, kind: e.kind, was: e.oldValue, now: e.newValue }));
  (extra.archive || []).forEach(e => log.push({ at: e.at, by: e.by, byName: e.byName, what: pathLabel(project, e.path), kind: e.kind, was: e.oldValue, now: e.newValue }));
  log.sort((a, b) => a.at - b.at);
  return { project, summary, money, live, subName, phaseLabel, worked, w2s, labor, log, personName };
}

// ---- the PDF ----------------------------------------------------------------------------------------------
async function buildPdf(board, project, calc, extra) {
  const g = gather(board, project, calc, extra), s = g.summary, p = project;
  const pdf = await PDFDocument.create();
  const fonts = { reg: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), mono: await pdf.embedFont(StandardFonts.Courier) };
  const L = new Layout(pdf, fonts, (p.code || '') + ' - ' + clean(p.name) + ' - closing packet' + (extra.preview ? ' (TEST PREVIEW)' : ''));
  pdf.setTitle(clean((p.code || '') + ' ' + p.name + ' - Closing Packet')); pdf.setAuthor('Lucas Industrial'); pdf.setCreationDate(new Date(extra.generatedAt));

  if (extra.preview) L.text('TEST PREVIEW - nothing was closed, moved or changed. This is only what a closing packet would contain right now.', { bold: true, size: 10, color: BAD, after: 6 });
  L.text('LUCAS INDUSTRIAL', { size: 9, color: DIM });
  L.h1('Project Closing Packet');
  L.text(clean(p.name), { size: 14, bold: true, after: 8 });
  L.kv([
    ['Project ID', p.code || '', true], ['Customer', p.customer], ['Store #', p.storeNumber], ['Location', [p.address, [p.city, p.state].filter(Boolean).join(', ')].filter(Boolean).join(' - ')],
    ['Status', p.status], ['Planned start', day(p.plannedStart)], ['Planned end', day(p.plannedEnd)], ['Marked completed', day(p.completedAt)],
    [extra.preview ? 'Previewed' : 'Closed out', when(extra.closedAt || extra.generatedAt)], ['Closed by', extra.preview ? '' : (extra.byName || roleLabel(extra.by))], ['Packet generated', when(extra.generatedAt)], ['Packet ID', extra.packetId || '(preview)'],
  ]);

  L.h2('1. Financial summary');
  L.kv([
    ['Original contract', usd(s.orig)], ['Approved change orders', usd(s.coApproved)], ['Final contract value', usd(s.contract), true],
    ['Billed to the GC', usd(s.billed)], ['Received from the GC', usd(s.received)], ['Still owed by the GC', usd(s.outstanding)],
    ['Collections handoff', p.handoff && p.handoff.at ? 'Handed off to ' + clean((p.handoff.toName || '') + (p.handoff.toEmail ? ' <' + p.handoff.toEmail + '>' : '')).trim() + ' on ' + day(p.handoff.at) + (p.handoff.outstanding != null ? ' with ' + usd(p.handoff.outstanding) + ' still owed' : '') : 'none'],
    ['Subcontractor cost (agreed)', usd(s.committed)], ['Paid to subs', usd(s.subPaid)],
    ['In-house labor (W-2 + temps, estimated)', s.laborCost > 0 ? usd(s.laborCost) : (g.w2s.length ? 'not estimated (missing wage or man-days)' : '-')],
    ['Total cost', usd(s.totalCost), true], ['Margin', usd(s.margin) + (s.marginPct == null ? '' : '  (' + s.marginPct.toFixed(1) + '%)'), true],
  ]);

  L.h2('2. Change orders');
  L.table([{ label: 'Description', w: .38 }, { label: 'Date', w: .15 }, { label: 'Status', w: .15 }, { label: 'Amount', w: .17, right: true }, { label: '', w: .15 }],
    (g.money.changeOrders || []).map(c => ({ cells: [c.desc, day(c.date), c.status, usd(c.amount), c.void ? 'VOID' : ''], dim: !!c.void })), 'No change orders.');

  L.h2('3. Payment requests to the GC');
  L.table([{ label: 'Period', w: .22 }, { label: 'Type', w: .1 }, { label: 'Amount', w: .14, right: true }, { label: 'Sent', w: .14 }, { label: 'Received', w: .14, right: true }, { label: 'Date received', w: .14 }, { label: '', w: .12 }],
    (g.money.payApps || []).map(a => ({ cells: [a.period, a.kind, usd(a.amount), day(a.submitted), usd(a.received), day(a.receivedDate), a.void ? 'VOID' : (a.submitted ? '' : 'never sent')], dim: !!a.void })), 'No payment requests.');

  L.h2('4. Subcontractors');
  const deals = g.money.subDeals || [];
  if (!deals.length) L.text('No subcontractors.', { size: 9.5, color: DIM, after: 4 });
  for (const d of deals) {
    L.text(clean(g.subName(d)) + '  -  ' + g.phaseLabel(d.phaseId) + '  -  ' + (d.role || 'primary') + '  -  ' + (d.status || '') + '  -  agreed ' + usd(d.price) + (d.void ? '  (VOID)' : ''), { bold: true, size: 9.5 });
    if (d.notes) L.note(d.notes);
    L.table([{ label: 'Payment', w: .2, right: true }, { label: 'Date', w: .2 }, { label: 'Status', w: .2 }, { label: 'Date paid', w: .2 }, { label: 'Note', w: .2 }],
      (d.payments || []).map(y => ({ cells: [usd(y.amount), day(y.date), y.void ? 'VOID' : y.status, day(y.paidAt), y.note], dim: !!y.void })), 'No payments.');
  }

  if (g.w2s.length || s.laborCost > 0 || (p.tempLaborers && p.tempLaborers.count)) {
    L.h2('5. In-house labor (W-2 and temps)');
    L.kv([['Man-days', p.manDays ? String(p.manDays) : (((p.phases || []).some(x => x.manDays)) ? (p.phases || []).map(x => 'Phase ' + x.number + ': ' + x.manDays).join(', ') : '-')], ['Burden on W-2 wages', g.labor.burdenPct + '%'], ['Hours per man-day', String(g.labor.hoursPerDay)]]);
    L.table([{ label: 'W-2', w: .5 }, { label: 'Hourly wage', w: .25, right: true }, { label: '', w: .25 }], g.w2s.map(w => ({ cells: [w.name, w.wage ? usd(w.wage) : 'not set', w.wageVoid ? 'wage VOID' : ''], dim: w.wageVoid })), 'No W-2s.');
    if (p.tempLaborers && p.tempLaborers.count) L.text('Temp laborers: ' + p.tempLaborers.count + (p.tempLaborers.agency ? ' via ' + clean(p.tempLaborers.agency) : '') + (p.tempLaborers.ratePerHr ? ' at ' + usd(p.tempLaborers.ratePerHr) + '/hr' : ''), { size: 9.5, after: 4 });
  }

  L.h2('6. Proposals');
  const b = p.bids || {};
  if (!(b.invites || []).length && !(b.proposals || []).length) L.text('No proposals were collected in the app.', { size: 9.5, color: DIM, after: 4 });
  else {
    if (b.dueAt) L.kv([['Proposals were due', when(b.dueAt)]]);
    L.table([{ label: 'Invited', w: .4 }, { label: 'Invited on', w: .3 }, { label: 'Result', w: .3 }], (b.invites || []).map(i => ({ cells: [g.personName(i.personId) || i.name, when(i.invitedAt), i.declined ? 'declined' : ''], dim: !!i.void })), 'No invites.');
    L.table([{ label: 'Proposal from', w: .26 }, { label: 'Phase', w: .14 }, { label: 'Price', w: .16, right: true }, { label: 'Status', w: .14 }, { label: 'Received', w: .2 }, { label: '', w: .1 }],
      (b.proposals || []).map(x => ({ cells: [g.subName(x), g.phaseLabel(x.phaseId), usd(x.price), x.status, when(x.receivedAt), x.void ? 'VOID' : ''], dim: !!x.void })), 'No proposals received.');
  }

  L.h2('7. Phases');
  L.table([{ label: 'Phase', w: .15 }, { label: 'Status', w: .2 }, { label: 'Start', w: .2 }, { label: 'End', w: .2 }, { label: 'Man-days', w: .12, right: true }, { label: 'Crew needed', w: .13, right: true }],
    (p.phases || []).map(ph => ({ cells: ['Phase ' + ph.number, ph.status, day(ph.plannedStart), day(ph.plannedEnd), ph.manDays || '', ph.crewNeeded || ''] })), 'The project had no phases.');

  L.h2('8. Who worked on it');
  L.table([{ label: 'Person', w: .28 }, { label: 'Type', w: .1 }, { label: 'Phase', w: .14 }, { label: 'On', w: .24 }, { label: 'Off', w: .24 }],
    g.worked.map(w => ({ cells: [w.name, w.type, w.phase, when(w.from), w.to ? when(w.to) : 'still on at close'] })), 'No work history was logged for this project (history starts with v20).');

  L.h2('9. Notes and contacts');
  L.kv([['Project notes', p.notes], ['Pay app notes', noteText(g.money)]]);
  const contacts = (p.contacts || []).map(c => [c.name, c.role || c.title, c.email, c.phone].filter(Boolean).join('  |  '));
  if (contacts.length) contacts.forEach(c => L.text(c, { size: 9.5 })); else L.text('No contacts on file.', { size: 9.5, color: DIM });

  L.h2('10. Change log (everything that was changed, in order)');
  L.note('Times are ' + TZ + '. "Who" is the login role. Entries start when logging began in v20; pay-app and proposal changes were logged earlier.');
  L.table([{ label: 'When', w: .225 }, { label: 'Who', w: .08 }, { label: 'What', w: .275 }, { label: 'Was', w: .21 }, { label: 'Now', w: .21 }],
    g.log.map(e => ({ cells: [when(e.at), e.byName || roleLabel(e.by), e.what + (e.kind === 'added' ? ' (added)' : e.kind === 'removed' ? ' (removed)' : ''), e.was == null ? '-' : e.was, e.now == null ? '-' : e.now] })), 'No changes were logged.');

  L.finish();
  return Buffer.from(await pdf.save());
}

// ---- the whole packet -----------------------------------------------------------------------------------
async function buildPacket(board, project, calc, opts) {
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const closedAt = opts.closedAt || generatedAt;
  const baseName = packetBaseName(project, closedAt);
  const packetId = opts.preview ? '' : 'PKT-' + (project.code || 'LI') + '-' + generatedAt.replace(/\D/g, '').slice(0, 14);
  const extra = { events: opts.events, archive: opts.archive, preview: !!opts.preview, generatedAt, closedAt, by: opts.by, byName: opts.byName, packetId };
  const pdf = await buildPdf(board, project, calc, extra);
  const people = (board.people || []).filter(pe => (pe.history || []).some(h => h.projectId === project.id)).map(pe => ({ id: pe.id, name: pe.name, type: pe.type, history: pe.history.filter(h => h.projectId === project.id) }));
  const json = Buffer.from(JSON.stringify({ format: 'lucas-closing-packet', version: 1, packetId, generatedAt, closedAt, closedBy: opts.by || null, closedByName: opts.byName || null, closedByUserId: opts.byUserId == null ? null : opts.byUserId, preview: !!opts.preview, project, workHistory: people, changeLog: { project: opts.events || [], money: opts.archive || [] }, summary: calc.moneySummary(project) }, null, 1));
  return { pdf, json, baseName, pdfName: baseName + '.pdf', jsonName: baseName + '.json', packetId, sha256: crypto.createHash('sha256').update(pdf).digest('hex') };
}

// ---- the Collections handoff: what the person chasing the money needs, nothing more ----------------------
function handoffBaseName(p) {
  const type = [p.customer, p.storeNumber].map(x => safeName(x)).filter(Boolean).join(' ');
  const place = [p.city, p.state].map(x => safeName(x)).filter(Boolean).join(' ');
  return [safeName(p.code || 'LI-??????'), type, place, 'Collections Handoff'].filter(Boolean).join(' - ');
}
async function buildHandoff(board, project, calc, opts) {
  const p = project, s = calc.moneySummary(p), m = p.money || {}, live = arr => (arr || []).filter(x => x && !x.void);
  const pdf = await PDFDocument.create();
  const fonts = { reg: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), mono: await pdf.embedFont(StandardFonts.Courier) };
  const L = new Layout(pdf, fonts, (p.code || '') + ' - ' + clean(p.name) + ' - collections handoff');
  pdf.setTitle(clean((p.code || '') + ' ' + p.name + ' - Collections Handoff')); pdf.setAuthor('Lucas Industrial'); pdf.setCreationDate(new Date(opts.generatedAt));
  L.text('LUCAS INDUSTRIAL', { size: 9, color: DIM });
  L.h1('Collections Handoff');
  L.text(clean(p.name), { size: 14, bold: true, after: 8 });
  L.kv([['Project ID', p.code || '', true], ['Customer / GC', p.customer], ['Store #', p.storeNumber], ['Location', [p.address, [p.city, p.state].filter(Boolean).join(', ')].filter(Boolean).join(' - ')],
    ['Work completed', day(p.completedAt)], ['Prepared', when(opts.generatedAt)], ['Handed off to', clean((opts.toName || '') + (opts.toEmail ? ' <' + opts.toEmail + '>' : ''))]]);
  L.h2('Money');
  L.kv([['Final contract value', usd(s.contract), true], ['Billed to the GC', usd(s.billed)], ['Received from the GC', usd(s.received)], ['Still owed by the GC', usd(s.outstanding), true]]);
  L.h2('Payment requests sent to the GC');
  L.table([{ label: 'Period', w: .22 }, { label: 'Type', w: .1 }, { label: 'Amount', w: .14, right: true }, { label: 'Sent', w: .14 }, { label: 'Received', w: .14, right: true }, { label: 'Date received', w: .14 }, { label: 'Open', w: .12, right: true }],
    live(m.payApps).map(a => ({ cells: [a.period, a.kind, usd(a.amount), day(a.submitted), usd(a.received), day(a.receivedDate), a.submitted ? usd(Math.max(0, (Number(a.amount) || 0) - (Number(a.received) || 0))) : 'not sent'] })), 'No payment requests.');
  L.h2('Change orders');
  L.table([{ label: 'Description', w: .5 }, { label: 'Date', w: .2 }, { label: 'Status', w: .15 }, { label: 'Amount', w: .15, right: true }],
    live(m.changeOrders).map(c => ({ cells: [c.desc, day(c.date), c.status, usd(c.amount)] })), 'No change orders.');
  L.h2('GC contacts');
  L.table([{ label: 'Name', w: .25 }, { label: 'Role', w: .2 }, { label: 'Company', w: .2 }, { label: 'Phone', w: .15 }, { label: 'Email', w: .2 }],
    (p.contacts || []).map(c => ({ cells: [c.name, c.role, c.company, c.phone, c.email] })), 'No contacts on file.');
  if (noteText(m) || p.notes) { L.h2('Notes'); L.kv([['Pay app notes', noteText(m)], ['Project notes', p.notes || '']]); }
  const bytes = await pdf.save();
  return { pdf: Buffer.from(bytes), name: handoffBaseName(p) + '.pdf' };
}

// The sheet a subcontractor can download from their proposal link. It is built ONLY from the allowlisted
// object that lib/proposalInfo.js produces, so it cannot contain contract price, customer or contacts.
async function buildSubBrief(info, opts) {
  const pdf = await PDFDocument.create();
  const fonts = { reg: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), mono: await pdf.embedFont(StandardFonts.Courier) };
  const L = new Layout(pdf, fonts, 'Lucas Industrial - ' + clean(info.name) + ' - project details');
  pdf.setTitle(clean(info.name + ' - Project Details')); pdf.setAuthor('Lucas Industrial'); pdf.setCreationDate(new Date(opts.generatedAt));
  L.text('LUCAS INDUSTRIAL', { size: 9, color: DIM });
  L.h1('Project Details for Proposal');
  L.text(clean(info.name), { size: 14, bold: true, after: 8 });
  L.kv([['Site address', [info.address, [info.city, info.state].filter(Boolean).join(', ')].filter(Boolean).join(' - ')],
    ['Proposal due', opts.dueText || 'See your invitation'], ['Project start', day(info.plannedStart)], ['Project finish', day(info.plannedEnd)],
    ['Crew needed', info.crewNeeded ? String(info.crewNeeded) : ''], ['Skills needed', (info.requiredSkills || []).join(', ')]]);
  if ((info.phases || []).length) {
    L.h2('Phases');
    L.table([{ label: 'Phase', w: .14 }, { label: 'Start', w: .2 }, { label: 'Finish', w: .2 }, { label: 'Skills needed', w: .46 }],
      info.phases.map(ph => ({ cells: ['Phase ' + ph.number, day(ph.plannedStart), day(ph.plannedEnd), (ph.requiredSkills || []).join(', ')] })), 'No phases.');
  }
  L.h2('Scope of work');
  L.text(info.scope && info.scope.trim() ? info.scope.trim() : 'The detailed scope will be added here. Until then, please use the information above and contact Lucas Industrial with questions.', { size: 10, after: 6 });
  L.h2('What to include in your proposal');
  L.text('Your total price (or a price per phase), what is included and excluded, how long your price is good for, and your earliest start.', { size: 10 });
  const bytes = await pdf.save();
  return { pdf: Buffer.from(bytes), name: safeName((opts.fileBase || info.name) + ' - Project Details') + '.pdf' };
}

module.exports = { buildHandoff, buildPacket, buildSubBrief, packetBaseName, safeName, clean, pathLabel };
