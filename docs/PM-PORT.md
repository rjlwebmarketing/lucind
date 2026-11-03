# What moved from the old PM app

The whole PM app (dispatch board, crew & subs, proposals, pay apps, close-out/archive, Logistics AI, house rules, sub proposal/profile links) now runs inside the go. platform. Nothing about how it works was redesigned; only the front door changed.

| Old | Now |
|---|---|
| 3 shared access codes (Builder / Owner / PM) | Real people, email + own password (Users & Access) |
| Role decided by which code you typed | Role = the person's role; PM-section tabs shown per pane permission |
| `pm.lucasindustrial.us` | `go.lucasindustrial.us/pm/` (opened from the menu, inside the shell) |
| Railway `/api/...` | Railway `/pm/api/...` (same routes, one prefix) |
| Access-code screens, sign-out-everyone, security log inside PM | Removed there; use Users & Access and the Audit Log |
| Public sub links (`proposal.html`, `profile.html`) | `go.lucasindustrial.us/pm/proposal.html?t=...` and `.../profile.html?t=...` (still token-only, no sign-in) |

## How access works inside PM
- Platform role Builder -> PM "builder"; Owner -> "owner"; everyone else -> "pm". That keeps the existing protections: PMs never see wages or the TFH rate, subs never see price/customer, Builder-only data stays Builder-only.
- Every PM API call is also gated by pane: Projects/Dispatch tabs (`pm.projects`), Crew & Subs (`pm.people`), Proposals (`pm.proposals`), Pay Apps (`payapps.main`), Close-out/archive (`payapps.closeout`), Logistics AI (`pm.logistics_ai`), restore points (`pm.projects`, Owner/Builder only). Read = can open/GET; write = can save.
- Menu tabs inside PM are hidden for panes a person does not have.

## Known limits (next up)
- A read-only person sees the editing buttons; the server refuses the save (the page shows its normal save-failed message). Making buttons read-only is a later polish.
- The board is still one JSON document; Estimator-originated facts (customer, contract amount) will be split into tables when we build the Estimator hand-off (see DATA-SPINE.md).
- Old PM data is not migrated (nothing there was live). A new database starts empty; Builder seeds the board on first load.

## Who-did-it records
Each action stamped by the server (change log, money history, restore points, house rules, proposal links, project close-out, Drive connection) stores the signed-in person's id, name and username. The closing packet and its JSON say "Closed by Name (username)" and list each change by person. Notes typed into the board itself (such as Pay Apps notes) are stamped by the page with the person's name; the server-stamped logs are the authoritative record.
