# Global menu, Estimator, Admin and Builder (v5)

## The menu
A button left of the logo is on every screen. It lists only what the signed-in person may open:
- **Estimator** - the Estimator app (own look-alike of the PM app): Dashboard, Bids, Crew & Subs (read-only), Map, Calendar.
- **Project Manager** - the whole PM app (projects, dispatch, crew, Request For Proposals, pay apps, close-out, map, calendar, logistics AI). Estimators never open it.
- **Admin** (Owner, and Builder) - Users & Access, Audit Log, Analytics (placeholder), Removal Requests, and the Sensitive Data screens.
- **Builder** (Builder only, never grantable) - Settings & Connections, Roles & Templates, PM Settings & Rules, Dev Backlog, System Architecture, Import / Export Data.
Version, "Up to date" and the trademark line are always on screen along the bottom.

## Estimator
- Bids: Draft, Bidding, Won, Lost, No Bid. Never deleted - archived. Every change is stored with the person's name and username (`est_bid_history`).
- Quota (per Estimator, shown only to Estimators): default $2.2M bid per month and 12% conversion; the Owner/Builder set goals per person (`est_quotas`).
- Conversion = dollars won / dollars decided (won + lost), trailing 12 months. A count-based figure is also returned.
- Map separates active jobs (from the PM board; names, places, dates only) from bids. Calendar shows bid due dates and job spans.
- PMs do not see bids. The Owner may grant a person view-only access to the Estimator pane in Users & Access.

## People with more than one job
A person has a main role plus optional extra roles (table `user_roles`). Access is the highest level across all of them, then per-person exceptions. Builder is never an extra role.

## Shared views
Projects, Crew & Subs and Calendar are viewable from the Estimator branch (view-only) without opening the PM app. Request For Proposals is PM-only.

## Next
Estimator -> PM hand-off (which bid fields carry into a Project; which the PM may not edit), Analytics (per-person views, density maps, sub award rate), toasts between roles.

## Addresses (v7)
Clean addresses: /home, /pm, /estimator, /admin/users, /builder/settings ... A `.htaccess` (see web/htaccess.txt) hands any non-file address to index.html. App pages live in /app (app/pm.html, app/estimator.html; a new branch = app/<branch>.html). Sub proposal and profile pages stay at /pm/proposal.html and /pm/profile.html so links already e-mailed keep working. Old #/ links convert themselves.
