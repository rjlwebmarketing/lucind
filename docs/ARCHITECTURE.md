# Architecture (short)

**Shape.** One shell (login, menu, Users & Access) and modules plugged into it: Estimator, PM, Pay Apps. A module = API routes under `/api/<module>` + a front-end pane registered in the shell. New section later = one line in `backend/lib/catalog.js` plus the module.

**Access.** Every pane has a key (`pm.dispatch`) and a level (none/read/write). Role templates give the defaults; per-person overrides sit on top. Builder is always full. The server checks every call (`requirePerm`); the menu only hides things for convenience. Wages, estimate costs/margin and contract values are their own panes so they can be granted separately from the screens that display them.

**People and seats.** A seat is a numbered slot (10 now). A person is a permanent record; leaving = turned off, seat freed, record kept. Rehiring or a new hire is a new person record. Every record a module writes should carry `by` (user id) plus name/email snapshots (`stampFor(user)` in `lib/audit.js`) so history reads correctly forever.

**Passwords.** Email is the username. scrypt hashes; 5 bad tries locks that account 15 minutes; resets by emailed one-time link (1 hour); the Builder can set a temporary password as a fallback; sessions are server-side and revocable (8 h idle, 7 d max).

**Data.** New modules use relational tables. The old PM board is a single JSON document; it will be converted piece by piece, with the shared facts (project, customer, contract amount) moving into real tables first (see DATA-SPINE.md).

**Hosting.** Front end static on SiteGround (go.), API on Railway (goapi.), MySQL on Railway. No data is migrated from the old system.

**Tests.** `backend` auth/admin is covered by an in-memory test harness plus a browser test of the shell (kept outside the repo for now).
