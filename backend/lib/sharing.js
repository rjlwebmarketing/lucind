// Which files may leave the building, and how. Used by the file list (so the page knows what to offer) and by the share routes (so it is enforced).
//   - only a PROJECT's own files can be shared; a bid's files never can (bids stay private; the PM never sees the bid itself)
//   - hidden files can't be shared
//   - Contracts are blocked by default (they carry the contract price); the Owner/Builder can allow or block any single file explicitly
// share_ok on the file: NULL = default rule, 1 = Owner/Builder allowed it, 0 = Owner/Builder blocked it.
function shareState(f){
  if(f.entity_type !== 'project') return { ok: false, reason: 'Bid documents stay private to the Estimator.' };
  if(Number(f.hidden)) return { ok: false, reason: 'Hidden files cannot be shared.' };
  if(f.share_ok != null) return Number(f.share_ok) === 1 ? { ok: true } : { ok: false, reason: 'The Owner has marked this file as not for sharing outside.' };
  if(f.kind === 'Contracts') return { ok: false, reason: 'Contracts carry the contract price. Ask the Owner to allow this one.' };
  return { ok: true };
}
module.exports = { shareState };
