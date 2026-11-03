// "Who is doing this?" for the current request, available anywhere below the sign-in check without passing it around.
// Every record the platform or a module writes copies the person's id, name and username AT THAT MOMENT, so the history
// stays readable after a person leaves, is renamed, or is turned off.
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
const shape = u => u ? { id: Number(u.id), name: u.name, username: u.username || null, email: u.email || null } : null;
const runAs = (user, fn) => als.run(shape(user), fn);
const current = () => als.getStore() || null;
// "Pat Miller (pmiller)" - what packets and screens show.
const label = a => (a && a.name) ? (a.username ? a.name + ' (' + a.username + ')' : a.name) : null;
const labelOf = (name, username) => name ? (username ? name + ' (' + username + ')' : name) : null;
// The three values to store in user_id, user_name, user_username.
const cols = () => { const a = current(); return [a ? a.id : null, a ? String(a.name).slice(0, 120) : null, a ? (a.username ? String(a.username).slice(0, 40) : null) : null]; };
module.exports = { runAs, current, label, labelOf, cols };
