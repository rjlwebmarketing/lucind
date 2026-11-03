// The one list of everything a person can be given access to. Adding a new section or pane to the platform =
// adding a line here; the Users & Access screen, the permission checks and the role templates all read this.
// Level order: none < read < write.
const LEVELS = ['none', 'read', 'write'];
const lvl = x => Math.max(0, LEVELS.indexOf(x));

const SECTIONS = [
  { key: 'estimator', label: 'Estimator', panes: [
    { key: 'estimator.estimates', label: 'Estimates' },
    { key: 'estimator.customers', label: 'Customers & Contacts' },
    { key: 'estimator.pricebook', label: 'Price Book & Rates' } ] },
  { key: 'pm', label: 'Project Management', panes: [
    { key: 'pm.projects', label: 'Projects' },
    { key: 'pm.dispatch', label: 'Dispatch' },
    { key: 'pm.people', label: 'Crew & Subcontractors' },
    { key: 'pm.proposals', label: 'Sub Proposals' },
    { key: 'pm.calendar', label: 'Calendar & Map' },
    { key: 'pm.logistics_ai', label: 'Logistics AI' } ] },
  { key: 'payapps', label: 'Pay Apps', panes: [
    { key: 'payapps.main', label: 'Pay Apps' },
    { key: 'payapps.closeout', label: 'Close Out & Archive' } ] },
  { key: 'sensitive', label: 'Sensitive Data', panes: [
    { key: 'sensitive.wages', label: 'Wages & Labor Rates' },
    { key: 'sensitive.estimate_costs', label: 'Estimate Costs & Margin' },
    { key: 'sensitive.contract_values', label: 'Contract Values' } ] },
  { key: 'admin', label: 'Administration', panes: [
    { key: 'admin.users', label: 'Users & Access' },
    { key: 'admin.audit', label: 'Audit Log' },
    { key: 'admin.settings', label: 'Settings & Connections' } ] }
];
const PANE_KEYS = SECTIONS.flatMap(s => s.panes.map(p => p.key));

// Starting role templates (stored in the database on first boot, then editable by the Builder). `*` = every pane.
const ROLE_DEFAULTS = {
  builder:   { label: 'Builder', system: true, perms: { '*': 'write' } },
  owner:     { label: 'Owner', perms: { 'estimator.*': 'write', 'pm.*': 'write', 'payapps.*': 'write', 'sensitive.*': 'write', 'admin.users': 'read', 'admin.audit': 'read' } },
  estimator: { label: 'Estimator', perms: { 'estimator.*': 'write', 'pm.projects': 'read', 'pm.people': 'write', 'pm.proposals': 'write', 'sensitive.estimate_costs': 'write', 'sensitive.contract_values': 'read' } },
  pm:        { label: 'Project Manager', perms: { 'pm.*': 'write', 'estimator.estimates': 'read', 'payapps.*': 'write', 'sensitive.contract_values': 'read' } },
  ar_ap:     { label: 'AR / AP', perms: { 'payapps.*': 'write', 'pm.projects': 'read', 'sensitive.contract_values': 'read' } }
};

function expand(perms){
  const out = {};
  PANE_KEYS.forEach(k => { out[k] = 'none'; });
  const entries = Object.entries(perms || {});
  // wildcards first, then exact keys win
  entries.filter(([k]) => k === '*' || k.endsWith('.*')).forEach(([k, v]) => {
    PANE_KEYS.forEach(p => { if(k === '*' || p.startsWith(k.slice(0, -1))) out[p] = v; });
  });
  entries.filter(([k]) => !(k === '*' || k.endsWith('.*'))).forEach(([k, v]) => { if(k in out) out[k] = v; });
  return out;
}
module.exports = { LEVELS, lvl, SECTIONS, PANE_KEYS, ROLE_DEFAULTS, expand };
