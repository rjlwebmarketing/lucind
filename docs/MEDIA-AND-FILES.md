# Project files (media)

Every bid and every project has a **Files** panel.

* **Estimator** adds foundation drawings / PDFs / documents to a bid (open the bid, Files panel).
* **PM** adds progress photos and documents to a project (open the project, Files panel).
* When a bid is linked to the project it became, its files appear inside that project marked **From bid**.
  A PM never sees the bid itself, only its documents inside the project. Subs never see files.
* **Nothing is ever deleted.** Only the Owner (or Builder) can **Hide** a file (optional reason). Hidden files sit in a
  collapsed "Hidden files" group at the bottom and can be restored by the Owner. Who hid it and why stays on record.
* Uploader or Owner can edit a file's note. Every upload / view / download / hide is in the audit log.
* Allowed: PDF, JPG, PNG, GIF, WEBP, HEIC, DOC(X), XLS(X), CSV, TXT, PPT(X), DWG, DXF, ZIP, EML, MSG, MP4, MOV. Max 100 MB each (`MEDIA_MAX_MB`).

## REQUIRED on Railway: attach a Volume
Railway's disk is wiped on every deploy. Without a Volume, uploaded files would vanish.

1. Railway → project → the **LucInd** service → **Settings → Volumes → Add Volume** (or right-click the service canvas → Volume). Mount path: `/data`.
2. LucInd → **Variables** → add `FILES_DIR` = `/data/files`.
3. Redeploy. Check: sign in as Builder and open `https://lucind-production.up.railway.app/api/media/storage` — it should show `"persistentConfigured": true`.

## Still to wire (needs your hand-off answers)
`POST /api/estimator/bids/:id/link-project {projectId}` ties a bid to its PM project (Owner/Builder, needs write on both panes).
It is not yet called automatically when a bid is marked Won; that belongs with the Estimator → PM hand-off.
