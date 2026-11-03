# Setup checklist (Rob)

Do these in order. Each step says what you will have at the end. Nothing here touches the old pm. system.

## 1. GitHub
1. Create a new **private** repo, e.g. `lucas-go`, under the account/org you want to own it.
2. Put the contents of this folder (backend/, web/, docs/, README.md, .gitignore) in it. Easiest from a terminal in the unzipped folder:
   ```
   git init -b main && git add . && git commit -m "go. platform v1"
   git remote add origin https://github.com/<you>/lucas-go.git && git push -u origin main
   ```
   (or use GitHub's "uploading an existing file" page and drag everything in, keeping the folders.)
3. Done when: the repo shows `backend/server.js`.

## 2. Railway (Lucas Industrial workspace, Pro)
1. New Project → **Deploy from GitHub repo** → pick `lucas-go`. In the service Settings set **Root Directory = `backend`**.
2. In the same project: **+ New → Database → MySQL**.
3. On the backend service → Variables, add:
   - `MYSQL_URL` = reference the MySQL service's `MYSQL_URL` (Railway's "Add Reference")
   - `APP_URL` = `https://go.lucasindustrial.us`
   - `ALLOWED_ORIGINS` = `https://go.lucasindustrial.us`
   - `BUILDER_EMAIL` = your email, `BUILDER_NAME` = Rob, optional `BUILDER_USERNAME` (defaults to the part of your email before the @)
   - `BUILDER_INITIAL_PASSWORD` = a temporary password you will change at first sign-in (or leave blank and read the one-time setup link in the deploy log)
   - `MAIL_PROVIDER` = `resend`, `RESEND_API_KEY` (step 4), `MAIL_FROM` = `Lucas Industrial <no-reply@lucasindustrial.us>`
   - PM module (copy the values from the old pm. Railway service's Variables; none of these are needed to sign in):
     - `ANTHROPIC_API_KEY` (Logistics AI / assistant), optional `AI_ALLOWED_MODELS`
     - `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, optional `DRIVE_TOKEN_KEY` (Google Drive archive)
     - `PUBLIC_BACKEND_URL` = `https://goapi.lucasindustrial.us/pm` (used to build the Google redirect address)
     - `PACKET_TZ` = `America/New_York`
4. Settings → Networking → **Generate Domain** (test it: `https://<it>.up.railway.app/api/health` should say ok), then **Custom Domain** = `goapi.lucasindustrial.us`. Railway shows a CNAME target.
5. Done when: `/api/health` answers `{"ok":true}`.
6. After the first successful sign-in you may delete `BUILDER_INITIAL_PASSWORD`.

## 3. SiteGround DNS (lucasindustrial.us)
- `goapi` → CNAME → the target Railway gave you.
- `go` → the front end. Easiest: in Site Tools create the **subdomain** `go.lucasindustrial.us`, then upload the **entire contents of `web/`** (index.html, config.js and the `pm/` folder) into its folder (File Manager or FTP). HTTPS is automatic (Site Tools → Security → SSL → Let's Encrypt for the subdomain).
- Before uploading, open `web/config.js` and confirm `API` is `https://goapi.lucasindustrial.us`.

## 4. Email (password resets and invites)
1. Create a Resend account (free tier is plenty for 10 users), add the domain `lucasindustrial.us`.
2. Resend lists DNS records (SPF/DKIM TXT/CNAME). Add them in SiteGround → Site Tools → Domain → DNS Zone Editor. **Do not remove your existing SPF record; merge** Resend's include into it (one SPF record per domain).
3. When Resend shows "Verified", create an API key and put it in Railway as `RESEND_API_KEY`.
4. Test: sign-in page → Forgot password → your address.

## 4b. Google Drive (only if you use the archive)
In Google Cloud Console → your OAuth client → add this **Authorized redirect URI**:
`https://goapi.lucasindustrial.us/pm/api/archive/drive/callback`
(The old pm. address can stay until you retire it.) Then, in the app, Builder → Drive → Connect.

## 5. First sign-in
Open https://go.lucasindustrial.us → sign in as Builder (username or email) → set your own password → Users & Access → add people.

## Keys and who owns what (keep this list current)
| Thing | Owner | Where |
|---|---|---|
| GitHub repo | Rob | github.com |
| Railway project + MySQL | Rob (billed to Lucas Industrial) | Railway workspace |
| Domain / DNS / front-end hosting | Rob | SiteGround |
| Email sending | Rob | Resend |
| Builder login | Rob | the app |
Write down where recovery codes for each account are stored. If you are unreachable, the Owner has no admin power by design; consider naming a second Builder you trust.

## Usernames
Everyone signs in with a **username** (or their email) plus password. When you add a person you pick the username (blank = the part of their email before the @, e.g. `mlucas`). Usernames are lowercase and unique; the **email** is still required because password-reset and invite links go there. You can rename a username later under Manage.
