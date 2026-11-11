// Estimator dashboard helpers: "next steps" worked out from each open bid (nothing stored), and the monthly numbers behind the analytics pane.
const DAY = 86400000;
const parse = s => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
const daysBetween = (a, b) => { const x = parse(a), y = parse(b); return x == null || y == null ? null : Math.round((x - y) / DAY); };   // a - b in days
const RANK = { overdue: 0, today: 1, soon: 2, '': 3 };
const urgencyFor = (due, today) => { const d = daysBetween(due, today); return d == null ? '' : d < 0 ? 'overdue' : d === 0 ? 'today' : d <= 3 ? 'soon' : ''; };

// bids: est_bids rows (not archived); docs: {bidId: estimate doc}; hasFiles: Set of bid ids that have (or inherit) a visible file.
function autoTasks({ bids, docs, hasFiles, today, noContract }){
  const out = [];
  for(const b of bids){
    const st = b.status; if(!['Draft', 'Bidding', 'Won'].includes(st)) continue;
    const doc = docs[b.id] || null, lines = doc && Array.isArray(doc.lines) ? doc.lines : [];
    const base = { bidId: Number(b.id), bidName: b.name, code: b.project_code || '', due: b.bid_due || '', urgency: st === 'Draft' ? urgencyFor(b.bid_due, today) : '' };
    const add = (key, text, tab, extra) => out.push(Object.assign({ id: 'auto:' + b.id + ':' + key, key, text, tab }, base, extra || {}));
    if(st === 'Draft'){
      let blocked = false;
      if(!lines.length){ add('estimate', 'Build the estimate (no lines yet)', 'estimate'); blocked = true; }
      else {
        const rev = lines.filter(l => l.source === 'ai' && !l.reviewed).length, chk = lines.filter(l => l.repriceCheck).length;
        if(chk){ add('reprice', 'Check prices on ' + chk + ' line' + (chk === 1 ? '' : 's') + (doc.clonedFrom && doc.clonedFrom.code ? ' (cloned from ' + doc.clonedFrom.code + ')' : ''), 'estimate'); blocked = true; }
        if(rev){ add('review', 'Review ' + rev + ' Estimator AI line' + (rev === 1 ? '' : 's'), 'estimate'); blocked = true; }
        if(!String(doc.number || '').trim()){ add('number', 'Enter the estimate number', 'estimate'); blocked = true; }
      }
      const miss = []; if(!b.customer) miss.push('customer'); if(!b.city && !b.address) miss.push('location'); if(!b.bid_due) miss.push('bid due date'); if(!b.start_date) miss.push('job start date');
      if(miss.length){ add('details', 'Fill in the bid details: ' + miss.join(', '), 'overview'); blocked = true; }
      if(!hasFiles.has(Number(b.id))){ add('files', 'Add the bid documents (drawings, scope narrative, photos…)', 'overview'); blocked = true; }
      if(!blocked) add('submit', 'Ready: look it over and press Mark As Submitted', 'estimate');
    } else if(st === 'Bidding'){
      const toStart = daysBetween(b.start_date, today), since = daysBetween(today, b.bid_submitted);
      if(toStart != null && toStart >= 0 && toStart <= 14) add('startsoon', 'Job starts in ' + toStart + ' day' + (toStart === 1 ? '' : 's') + ' and there is no award yet: check with the GC (it becomes Lost on the start date)', 'overview', { urgency: toStart <= 3 ? 'soon' : '' });
      else if(since != null && since >= 14) add('followup', 'Follow up with the GC: submitted ' + since + ' days ago, no answer yet', 'overview');
    } else if(st === 'Won' && !b.project_id) add('handoff', 'Won: hand it off to the Project Manager', 'estimate', { urgency: 'soon' });
    else if(st === 'Won' && b.project_id && noContract && noContract.has(String(b.project_id))) add('contract', 'Handed off: get the signed contract from the customer and add it', 'estimate', { urgency: 'soon' });
  }
  return out.sort((a, c) => (RANK[a.urgency] - RANK[c.urgency]) || String(a.due || '9999').localeCompare(String(c.due || '9999')) || a.bidName.localeCompare(c.bidName));
}

// rows: est_bids rows INCLUDING archived ones. Returns one entry per month ending at endMonth ("YYYY-MM"), oldest first, plus period totals.
function monthly(rows, endMonth, n){
  const keys = []; let [y, m] = endMonth.split('-').map(Number);
  for(let i = 0; i < n; i++){ keys.unshift(y + '-' + String(m).padStart(2, '0')); m--; if(m === 0){ m = 12; y--; } }
  const mo = {}; keys.forEach(k => { mo[k] = { month: k, bids: 0, bidAmt: 0, won: 0, wonAmt: 0, lost: 0, lostAmt: 0 }; });
  for(const r of rows){
    const ms2 = v => { const n = Number(v); return n > 0 ? new Date(n).toISOString().slice(0, 7) : ''; };   // bids moved to Won/Lost without the dates (older or imported records) still count, by the month they were last changed
    const amt = Number(r.amount) || 0, dk = (r.decided_on || '').slice(0, 7) || ((r.status === 'Won' || r.status === 'Lost') ? ms2(r.updated_at) : ''), sk = (r.bid_submitted || '').slice(0, 7) || ((['Bidding', 'Won', 'Lost'].includes(r.status)) ? (dk || ms2(r.updated_at) || ms2(r.created_at)) : '');
    if(['Bidding', 'Won', 'Lost'].includes(r.status) && mo[sk]){ mo[sk].bids++; mo[sk].bidAmt += amt; }
    if(r.status === 'Won' && mo[dk]){ mo[dk].won++; mo[dk].wonAmt += amt; }
    if(r.status === 'Lost' && mo[dk]){ mo[dk].lost++; mo[dk].lostAmt += amt; }
  }
  const list = keys.map(k => { const x = mo[k]; x.conversion = (x.wonAmt + x.lostAmt) > 0 ? Math.round(x.wonAmt / (x.wonAmt + x.lostAmt) * 1000) / 10 : null; ['bidAmt', 'wonAmt', 'lostAmt'].forEach(f => { x[f] = Math.round(x[f] * 100) / 100; }); return x; });
  const sum = f => list.reduce((a, x) => a + x[f], 0), bids = sum('bids'), won = sum('won'), lost = sum('lost'), wonAmt = sum('wonAmt'), lostAmt = sum('lostAmt'), bidAmt = sum('bidAmt');
  return { months: list, totals: { bids, bidAmt: Math.round(bidAmt * 100) / 100, avgBid: bids ? Math.round(bidAmt / bids) : null, won, wonAmt: Math.round(wonAmt * 100) / 100, lost, lostAmt: Math.round(lostAmt * 100) / 100,
    conversion: (wonAmt + lostAmt) > 0 ? Math.round(wonAmt / (wonAmt + lostAmt) * 1000) / 10 : null, conversionByCount: (won + lost) > 0 ? Math.round(won / (won + lost) * 1000) / 10 : null } };
}
module.exports = { autoTasks, monthly, daysBetween, urgencyFor };
