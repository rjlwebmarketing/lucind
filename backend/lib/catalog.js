// The one list of everything a person can be given access to. Adding a new section or pane to the platform =
// adding a line here; the Users & Access screen, the permission checks and the role templates all read this.
// Level order: none < read < write.
const LEVELS = ['none', 'read', 'write'];
const lvl = x => Math.max(0, LEVELS.indexOf(x));

// Top-level menu items (what the global menu shows). Each permission section below belongs to one of them.
//   Estimator / Project Manager : day-to-day work, opened for whoever has access to any pane inside
//   Admin   : the Owner's area - people, audit trail, analytics, and the sensitive-data screens no ordinary job can see
//   Builder : infrastructure and system settings - above the Owner; never grantable to anyone but a Builder
const MENU = [
  { key: 'estimator', label: 'Estimator' },
  { key: 'pm', label: 'Project Manager' },
  { key: 'admin', label: 'Admin' },
  { key: 'builder', label: 'Builder', builderOnly: true }
];
const SECTIONS = [
  { key: 'estimator', menu: 'estimator', label: 'Estimator', panes: [
    { key: 'estimator.estimates', label: 'Estimates' },
    { key: 'estimator.customers', label: 'Customers & Contacts' },
    { key: 'estimator.pricebook', label: 'Price Book & Rates' } ] },
  { key: 'pm', menu: 'pm', label: 'Project Management', panes: [
    { key: 'pm.projects', shared: true, label: 'Projects' },
    { key: 'pm.dispatch', label: 'Dispatch' },
    { key: 'pm.people', shared: true, label: 'Crew & Subcontractors' },
    { key: 'pm.proposals', label: 'Request For Proposals' },
    { key: 'pm.calendar', shared: true, label: 'Calendar & Map' },
    { key: 'pm.logistics_ai', label: 'Logistics AI' },
    { key: 'pm.catalog', label: 'Catalog (view, for change orders)' } ] },
  { key: 'payapps', menu: 'pm', label: 'Pay Apps', panes: [
    { key: 'payapps.main', label: 'Pay Apps' },
    { key: 'payapps.closeout', label: 'Close Out & Archive' } ] },
  { key: 'admin', menu: 'admin', label: 'Administration', panes: [
    { key: 'admin.users', label: 'Users & Access' },
    { key: 'admin.audit', label: 'Audit Log' },
    { key: 'admin.analytics', label: 'Analytics' },
    { key: 'admin.requests', label: 'Removal Requests' },
    { key: 'admin.contacts', label: 'Core Contacts' } ] },
  { key: 'sensitive', menu: 'admin', label: 'Sensitive Data', panes: [
    { key: 'sensitive.wages', label: 'Wages & Labor Rates' },
    { key: 'sensitive.estimate_costs', label: 'Estimate Costs & Margin' },
    { key: 'sensitive.contract_values', label: 'Contract Values' } ] },
  { key: 'builder', menu: 'builder', label: 'Builder', builderOnly: true, panes: [
    { key: 'builder.settings', label: 'Settings & Connections' },
    { key: 'builder.roles', label: 'Roles & Templates' },
    { key: 'builder.pmsettings', label: 'House Rules' },
    { key: 'builder.devtools', label: 'Loose Ends' },
    { key: 'builder.architecture', label: 'System Architecture' },
    { key: 'builder.pathways', label: 'Pathways' },
    { key: 'builder.report', label: 'Progress Report' },
    { key: 'builder.data', label: 'Import / Export Data' } ] }
];
// Cross-department panes: viewable from another branch (e.g. the Estimator's Map, Calendar and Crew & Subs) without opening this branch's own app.
const SHARED_PANES = SECTIONS.flatMap(s => s.panes.filter(p => p.shared).map(p => p.key));
const PANE_KEYS = SECTIONS.flatMap(s => s.panes.map(p => p.key));
// Panes only a Builder can ever hold (checked wherever access is granted).
const BUILDER_ONLY = k => String(k).startsWith('builder.');

// Starting role templates (stored in the database on first boot, then editable by the Builder). `*` = every pane.
const ROLE_DEFAULTS = {
  builder:   { label: 'Builder', system: true, perms: { '*': 'write' } },
  owner:     { label: 'Owner', perms: { 'estimator.*': 'write', 'pm.*': 'write', 'payapps.*': 'write', 'sensitive.*': 'write', 'admin.*': 'write', 'admin.audit': 'read' } },
  estimator: { label: 'Estimator', perms: { 'estimator.*': 'write', 'pm.projects': 'read', 'pm.people': 'read', 'pm.calendar': 'read', 'sensitive.estimate_costs': 'write', 'sensitive.contract_values': 'read' } },
  pm:        { label: 'Project Manager', perms: { 'pm.*': 'write', 'pm.catalog': 'read', 'payapps.*': 'write', 'sensitive.contract_values': 'read' } },
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
module.exports = { SHARED_PANES, BUILDER_ONLY, LEVELS, lvl, MENU, SECTIONS, PANE_KEYS, ROLE_DEFAULTS, expand };
