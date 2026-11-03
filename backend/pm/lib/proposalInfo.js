// What a subcontractor is allowed to see about a project. This is the ONLY place a project is turned into
// something a sub can read: it copies a short allowlist of fields out of the board. Anything not named here
// (contract value, pay apps, customer / GC, store number, contacts, project notes, other subs, other proposals,
// margins) can never reach a sub, no matter what is added to the board later.
const str = v => (v === null || v === undefined) ? '' : String(v);
const GRACE_MS = 3 * 24 * 60 * 60 * 1000; // a sub may still submit / change an answer this long after the due date

function dueMs(dueAt) { const t = dueAt ? new Date(dueAt).getTime() : NaN; return Number.isFinite(t) ? t : null; }

// Returns { project: {...safe fields} } or { closed: 'reason' } or null when the project / invitation is gone.
function infoFor(board, projectId, inviteId, now) {
  const p = (board.projects || []).find(x => x && String(x.id) === String(projectId));
  if (!p) return null;
  const b = p.bids || {};
  const inv = (b.invites || []).find(x => x && String(x.id) === String(inviteId) && !x.void);
  if (!inv) return null; // invitation was voided / removed: the link stops working
  const phases = (p.phases || []).filter(x => x && !x.void).slice().sort((a, c) => (a.number || 0) - (c.number || 0)).map(ph => ({
    id: str(ph.id), number: ph.number, plannedStart: str(ph.plannedStart).slice(0, 10), plannedEnd: str(ph.plannedEnd).slice(0, 10),
    requiredSkills: (ph.requiredSkills || []).map(str).filter(Boolean).slice(0, 30)
  }));
  const safe = {
    name: str(p.name), address: str(p.address), city: str(p.city), state: str(p.state),
    plannedStart: str(p.plannedStart).slice(0, 10), plannedEnd: str(p.plannedEnd).slice(0, 10),
    requiredSkills: (p.requiredSkills || []).map(str).filter(Boolean).slice(0, 30),
    crewNeeded: Number.isFinite(Number(p.crewNeeded)) ? Number(p.crewNeeded) : null,
    phases, scope: str(b.scope), dueAt: str(b.dueAt)
  };
  let closed = null;
  const props = (b.proposals || []).filter(x => x && !x.void);
  if (p.status === 'Completed') closed = 'project_done';
  else if (props.some(x => x.status === 'awarded' && !(x.phaseId))) closed = 'awarded';
  else if (b.dueAt && dueMs(b.dueAt) && now > dueMs(b.dueAt) + GRACE_MS) closed = 'past_due';
  return { project: safe, closed, personId: inv.personId || '', pastDue: !!(dueMs(b.dueAt) && now > dueMs(b.dueAt)) };
}

module.exports = { infoFor, GRACE_MS };
