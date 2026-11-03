# Data spine: who originates what

The pipeline is Estimator → PM → Pay Apps. A field has **one origin**; every later stage reads it, and (where noted) may only add to it. This is the list we fill in together. "?" = needs your answer.

Rule of thumb: a downstream screen never keeps its own copy of an upstream fact. It links to the record and shows the current value (or a locked snapshot if the fact was frozen at hand-off).

| Fact | Origin | Read by | Notes |
|---|---|---|---|
| Customer / contacts | Estimator | PM, Pay Apps | Subs never see (existing rule) |
| Project name | **? you said PM** | Estimator, Pay Apps | Estimates need a name before a project exists. Proposed: Estimator holds a working title; PM sets the official project name at hand-off and it then flows everywhere. |
| Job site address, scope text | Estimator | PM, sub proposals | Subs see only what `proposalInfo` allows |
| Contract amount | Estimator (awarded estimate total) | PM (read), Pay Apps (schedule of values) | Change orders amend it from PM/Pay Apps; keep an amount history |
| Estimate line items / cost / margin | Estimator | PM (read-only if granted) | `sensitive.estimate_costs` |
| Crew needed, skills, dates, man-days | Estimator proposes → PM confirms | Dispatch | Estimator fills labor assumptions; PM owns the final plan |
| Assigned crew / subs, backup | PM (Dispatch) | Pay Apps | Dispatch chooses people; Pay Apps records price |
| Sub price, W-2 cost, TFH rate | Pay Apps (price) / Owner-Builder settings (rates) | Estimator (rate book) | Wages never visible to PM |
| Pay app billing, retainage, close-out | Pay Apps | — | |

## Open questions for you and Mike
1. Project name and contract amount both show up first in the Estimator, yet you described them as PM-originated. Which moment creates the real project record: **estimate accepted**, or **PM opens a job**?
2. Can a project exist without an estimate (small/service jobs)? If yes, PM must be able to create the project and enter the contract amount directly.
3. After hand-off, can the Estimator revise the estimate (revision history), or does everything change via change orders?
