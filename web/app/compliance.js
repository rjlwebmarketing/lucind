/* Subcontractor compliance: licensed states, Business License, W-9 / EIN and Certificate of Insurance (COI).
   Pure functions (no page access) so the PM screen, the recommendation filters and the tests all use the same rules.

   Where it lives on a person (subs only):
     person.licStates = ['TN','AL']                  states the sub is licensed to work in
     person.compliance = {
       license: { has, number },                     Business License: no term, always present
       w9:      { has, ein },                        W-9: no term, always present
       coi:     { has, expires:'YYYY-MM-DD', carrier, policy }   Certificate of Insurance: has a term
     }
   Rules:
     - A sub with licensed states is never recommended for a job in another state. A sub with NO states on file is still
       recommended, with a "license states not on file" warning (so the board does not go empty while states are entered).
     - COI: 30 days before it expires = heads-up; 10 days or less (or expired) = hard warning.
     - A job the sub is on whose end date falls after the COI's expiry is a problem too, and goes hard when the job starts
       within 30 days (no time left for a new certificate) or the COI has 10 days or less. */
(function(root){
  const DAY = 86400000, HEADS_UP = 30, HARD = 10;
  const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  const BY_NAME = {}; Object.keys(STATES).forEach(k => { BY_NAME[STATES[k].toLowerCase()] = k; });
  const stateCode = v => { const s = String(v == null ? '' : v).trim(); if(!s) return ''; if(/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase(); return BY_NAME[s.toLowerCase()] || ''; };
  const isoDay = d => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
  const todayIso = now => isoDay(now == null ? new Date() : now);
  const diffDays = (fromIso, toIso) => Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / DAY);
  const isSub = p => !!p && p.type === 'sub';
  const comp = p => (p && p.compliance) || {};
  const states = p => (Array.isArray(p && p.licStates) ? p.licStates : []).map(stateCode).filter(Boolean);

  // Licensed in the project's state? true / false, or null when it cannot be said (no states on file, or the project has no state).
  function licensedFor(person, proj){
    if(!isSub(person)) return true;
    const st = states(person), ps = stateCode(proj && proj.state);
    if(!st.length || !ps) return null;
    return st.includes(ps);
  }
  // The hard rule used by every recommendation filter: only an explicit "not licensed" blocks.
  const blockedByLicense = (person, proj) => licensedFor(person, proj) === false;

  function coiStatus(person, now){
    const c = comp(person).coi || {}, t = todayIso(now);
    if(!isSub(person)) return { level: 'na' };
    if(!c.expires) return { level: 'missing', days: null, expires: '' };
    const days = diffDays(t, c.expires);
    const level = days < 0 ? 'expired' : days <= HARD ? 'hard' : days <= HEADS_UP ? 'heads_up' : 'ok';
    return { level, days, expires: c.expires };
  }
  const licenseOnFile = p => !!(comp(p).license && comp(p).license.has);
  const w9OnFile = p => !!(comp(p).w9 && comp(p).w9.has && String(comp(p).w9.ein || '').trim());

  // A job's own check: does the COI still cover it?  gap = the COI ends before the job does (or there is none).
  function coiForJob(person, job, now){
    if(!isSub(person) || !job) return null;
    const t = todayIso(now), cs = coiStatus(person, now), end = job.plannedEnd || job.plannedStart;
    if(!end) return null;
    const startsIn = job.plannedStart ? diffDays(t, job.plannedStart) : null;
    if(cs.level === 'missing') return { gap: true, level: (startsIn != null && startsIn <= HEADS_UP) ? 'hard' : 'heads_up', expires: '', startsIn };
    if(cs.expires >= end) return { gap: false, level: 'ok', expires: cs.expires, startsIn };
    const soon = (startsIn != null && startsIn <= HEADS_UP) || cs.days <= HARD;
    return { gap: true, level: soon ? 'hard' : 'heads_up', expires: cs.expires, startsIn };
  }

  // Everything the PM should know about one sub, most urgent first. board = { projects }.
  function problems(person, board, now){
    if(!isSub(person)) return [];
    const out = [], t = todayIso(now), cs = coiStatus(person, now);
    const fmt = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    if(cs.level === 'expired') out.push({ kind: 'coi', level: 'hard', text: 'COI expired ' + fmt(cs.expires) + ' (' + Math.abs(cs.days) + ' day' + (Math.abs(cs.days) === 1 ? '' : 's') + ' ago)' });
    else if(cs.level === 'hard') out.push({ kind: 'coi', level: 'hard', text: 'COI expires ' + fmt(cs.expires) + ' (' + cs.days + ' day' + (cs.days === 1 ? '' : 's') + ')' });
    else if(cs.level === 'heads_up') out.push({ kind: 'coi', level: 'heads_up', text: 'COI expires ' + fmt(cs.expires) + ' (' + cs.days + ' days)' });
    else if(cs.level === 'missing') out.push({ kind: 'coi_missing', level: 'info', text: 'No COI on file' });
    (board && board.projects || []).forEach(pr => {
      if(!pr || pr.status === 'Completed') return;
      const targets = [{ proj: pr, job: pr, ids: pr.assignedIds || [], label: pr.name }].concat((pr.phases || []).filter(ph => ph.status !== 'Completed' && ph.status !== 'Not Urgent').map(ph => ({ proj: pr, job: ph, ids: ph.assignedIds || [], label: pr.name + ' (Phase ' + ph.number + ')' })));
      targets.forEach(x => {
        if(!x.ids.includes(person.id)) return;
        if(licensedFor(person, pr) === false) out.push({ kind: 'not_licensed', level: 'hard', projectId: pr.id, text: 'Not licensed in ' + stateCode(pr.state) + ' for ' + x.label });
        const jc = coiForJob(person, x.job, now);
        if(jc && jc.gap && (jc.level === 'hard' || cs.level !== 'missing')) out.push({ kind: 'coi_job', level: jc.level, projectId: pr.id, text: (jc.expires ? 'COI ends ' + fmt(jc.expires) + ', before ' + x.label + ' ends ' + fmt(x.job.plannedEnd || x.job.plannedStart) : 'No COI on file for ' + x.label + ' (' + fmt(x.job.plannedStart) + ')') });
      });
    });
    if(!states(person).length) out.push({ kind: 'states_missing', level: 'info', text: 'License states not on file' });
    if(!licenseOnFile(person)) out.push({ kind: 'license_missing', level: 'info', text: 'Business license not on file' });
    if(!w9OnFile(person)) out.push({ kind: 'w9_missing', level: 'info', text: 'W-9 / EIN not on file' });
    const rank = { hard: 0, heads_up: 1, info: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }
  const worst = list => list.some(x => x.level === 'hard') ? 'hard' : list.some(x => x.level === 'heads_up') ? 'heads_up' : list.length ? 'info' : 'ok';

  // Jobs (and phases) the sub is on that the COI will not cover.
  function affectedJobs(person, board, now){
    const out = [];
    (board && board.projects || []).forEach(pr => {
      if(!pr || pr.status === 'Completed') return;
      const add = (job, phase) => { if((job.assignedIds || []).includes(person.id)){ const jc = coiForJob(person, job, now); if(jc && jc.gap) out.push({ proj: pr, phase: phase || null, job, level: jc.level, startsIn: jc.startsIn }); } };
      add(pr, null); (pr.phases || []).filter(ph => ph.status !== 'Completed' && ph.status !== 'Not Urgent').forEach(ph => add(ph, ph));
    });
    return out.sort((a, b) => String(a.job.plannedStart || '').localeCompare(String(b.job.plannedStart || '')));
  }

  // A ready-to-send email asking the sub for a new certificate. Never sent by the app itself.
  function coiNotice(person, o){
    o = o || {}; const cs = coiStatus(person, o.now), co = o.company || 'Lucas Industrial, LLC', reply = o.replyTo || 'Service@LucasIndustrial.us';
    const fmt = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const jobs = (o.jobs || []).map(j => '  - ' + j.proj.name + (j.phase ? ' (Phase ' + j.phase.number + ')' : '') + (j.job.plannedStart ? ', ' + fmt(j.job.plannedStart) + (j.job.plannedEnd ? ' to ' + fmt(j.job.plannedEnd) : '') : ''));
    const first = String(person.name || '').split(/\s+/)[0] || 'there';
    let when;
    if(cs.level === 'missing') when = 'We do not have a current certificate of insurance on file for ' + person.name + '.';
    else if(cs.level === 'expired') when = 'The certificate of insurance we have on file for ' + person.name + ' expired on ' + fmt(cs.expires) + '.';
    else when = 'The certificate of insurance we have on file for ' + person.name + ' expires on ' + fmt(cs.expires) + (cs.days <= HARD ? ' (' + cs.days + ' day' + (cs.days === 1 ? '' : 's') + ' from now)' : '') + '.';
    const subject = (cs.level === 'expired' || cs.level === 'missing' || cs.level === 'hard' ? 'Action needed: ' : 'Reminder: ') + 'certificate of insurance ' + (cs.level === 'missing' ? 'needed' : cs.level === 'expired' ? 'expired' : 'expires ' + fmt(cs.expires)) + ' - ' + co;
    const body = 'Hi ' + first + ',\n\n' + when + ' To keep you on our schedule, please have your insurance agent send us an updated certificate' + (cs.level === 'expired' || cs.level === 'missing' ? ' as soon as you can' : ' before it runs out') + '.\n\n' +
      (jobs.length ? 'This matters for the work we have you on:\n' + jobs.join('\n') + '\n\n' : '') +
      'Please reply to this email with the new certificate attached (PDF is fine), or send it to ' + reply + '.\n\nIf the renewal is already on its way, just let us know the new expiration date.\n\nThank you,\n' + (o.sender || co) + '\n' + co;
    return { to: person.email || '', subject, body };
  }
  const api = { STATES, stateCode, states, licensedFor, blockedByLicense, coiStatus, coiForJob, problems, worst, affectedJobs, coiNotice, licenseOnFile, w9OnFile, HEADS_UP, HARD, diffDays, todayIso };
  if(typeof module !== 'undefined' && module.exports) module.exports = api; else root.Compliance = api;
})(typeof window !== 'undefined' ? window : globalThis);
