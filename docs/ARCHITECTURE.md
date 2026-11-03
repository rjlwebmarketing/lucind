# Architecture (short)

**Shape.** One shell (login, menu, Users & Access) and modules plugged into it: Estimator, PM, Pay Apps. A module = API routes under `/api/<module>` + a front-end pane registered in the shell. New section later = one line in `backend/lib/catalog.js` plus the module.

**Access.** Every pane has a key (`pm.dispatch`) and a level (none/read/write). Role templates give the defaults; per-person overrides sit on top. Builder is always full. The server checks every call (`requirePerm`); the menu only hides things for convenience. Wages, estimate costs/margin and contract values are their own panes so they can be granted separately from the screens that display them.

**People and history.** There are no seat limits: the Builder (and the Owner) add people and turn them off. A person is a permanent record and is **never deleted**. Turning someone off signs them out and blocks sign-in; their id, name, username and email stay. Usernames and emails are never reused by another person, and a new hire is always a new record. Every record any module writes stores the person's **id, name and username as they were at that moment** (`lib/actor.js`, `cols()`), in addition to the old role column, so history reads correctly after a rename or departure. That covers the platform audit log, the PM change log, money history, restore points, house rules, proposal links, project close-outs and the closing packet that goes to Drive ("Closed by Pat Miller (pmiller)"). Audit and history are kept forever (restore-point snapshots of the whole board are thinned by age, as before). Rows from before this change show the role only.

**Passwords.** Email is the username. scrypt hashes; 5 bad tries locks that account 15 minutes; resets by emailed one-time link (1 hour); the Builder can set a temporary password as a fallback; sessions are server-side and revocable (8 h idle, 7 d max).

**Data.** New modules use relational tables. The old PM board is a single JSON document; it will be converted piece by piece, with the shared facts (project, customer, contract amount) moving into real tables first (see DATA-SPINE.md).

**Hosting.** Front end static on SiteGround (go.), API on Railway (goapi.), MySQL on Railway. No data is migrated from the old system.

**Tests.** `backend` auth/admin is covered by an in-memory test harness plus a browser test of the shell (kept outside the repo for now).
