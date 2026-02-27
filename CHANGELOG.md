# Changelog

All notable changes to Thermio TMS are documented here.

---

## [2026-02-27] — Async Fix + Codebase Hardening + Documentation Rebuild

### Critical Fixes

- **Fixed crash on startup** — `SyntaxError: await is only valid in async functions` in `routes/portal.js`
  - Root cause: `/stats` route used `await` inside a non-async `.map()` callback
  - Fixed: replaced with `await Promise.all(workspaces.map(async (ws) => {...}))`
  - Added `try/catch` and `next(err)` to the `/stats` route

- **Removed duplicate/incomplete route fragment** — `routes/portal.js` had a leftover `router.get('/')` opener (lines 59–61) from a partial edit that was never cleaned up. This caused all subsequent route registrations to execute inside a request handler body instead of at app startup, and left the outer handler never sending a response.

- **Fixed backup route returning Promises** — `routes/portal.js` backup export was calling `VehicleRepo.getAllByWorkspace()` and `TempLogRepo.getAllByWorkspace()` without `await`, resulting in the exported JSON containing `[object Promise]` instead of data.

- **Fixed 22 non-async route handlers in `routes/app-routes.js`** — The following routes were missing the `async` keyword but used `await` internally (would have crashed after portal.js was fixed):
  - `GET /` (home/dashboard)
  - `GET /staff`
  - `GET /staff/:id`
  - `GET /assets`
  - `GET /assets/:id/sheet`
  - `GET /live`
  - `GET /exports`
  - `GET /exports/:id/download`
  - `POST /staff/deactivate/:id`
  - `POST /staff/reactivate/:id`
  - `POST /assets/add`
  - `POST /assets/:id/edit-type`
  - `POST /assets/:id/week-note`
  - `POST /assets/deactivate/:id`
  - `POST /assets/reactivate/:id`
  - `POST /assets/:id/service/add`
  - `POST /assets/:id/service/:recordId/delete`
  - `POST /settings/branding`
  - `POST /settings/checklist`
  - `POST /settings/compliance`
  - `POST /truck/:id/checklist`
  - `POST /truck/:id/temps`
  - `POST /truck/:id/temps/edit/:tempId`
  - `POST /truck/:id/end-shift`
  - `GET /truck/:id`

- **Fixed `getLiveData()` in `routes/live.js`** — Was a synchronous function using `await` internally. Made `async` and updated caller in `app-routes.js` to `await` it.

- **Fixed `routes/auth-google.js`:**
  - Missing `await` on `WorkspaceRepo.getBySlug(slug)` in OAuth strategy (line 51) — workspace was a Promise, not an object
  - Missing `await` on `UserRepo.update(user.id, { status: 'active' })` (line 72) — user status was never updated on first Google login
  - Removed duplicate `passport.serializeUser` definition (lines 82–85 had two identical definitions)
  - Missing `await` on `WorkspaceRepo.getBySlug(slug)` in callback route handler

### Changed

- **Entry point renamed**: `app-postgres.js` → `app.js` (production entry)
- **Legacy file renamed**: `app.js` → `DEPRECATEDapp.js` (added deprecation comment)
- **`package.json`**: `"main"`, `"start"`, and `"dev"` scripts already pointed to `app.js` — no change needed after rename
- **Temporary staff expiry now uses workspace timezone** — Previously used `Date.setHours(0, 1, 0, 0)` which applied server/UTC time. Now uses Luxon to set 12:01am in the workspace's configured timezone (`ws.settings.timezone`). Prevents early expiry when server is in UTC and workspace is in AWST (UTC+8)
- **Staff credentials page**: temporary password is now masked (`••••••••`) with a Show/Hide toggle instead of being displayed in plain text
- **Camera scanner UX**: replaced `alert()` calls with an inline error UI containing a "Try Again" button and helpful instructions. Camera initialisation is now wrapped in a `startCamera()` function that can be retried without reloading

### Added

- `public/robots.txt` — blocks `/portal`, `/app`, `/auth`, `/w` from search engine indexing
- `docs/SETUP_GUIDE.md` — master ordered index linking all setup steps
- `docs/1-server-setup.md` — fresh Ubuntu 24.04 VPS setup
- `docs/2-database.md` — PostgreSQL install, schema, memory tuning
- `docs/3-nginx-ssl.md` — Nginx reverse proxy + Certbot SSL
- `docs/4-environment.md` — full `.env` reference
- `docs/5-google-oauth.md` — Google Console setup (exact steps)
- `docs/6-email-setup.md` — Resend email setup
- `docs/7-vps-hardening.md` — Fail2Ban, SSH hardening, PostgreSQL hardening, UFW
- `docs/8-common-errors.md` — troubleshooting reference
- `SECURITY_GUIDE.md` — security architecture documentation
- `ARCHITECTURE.md` — system design, middleware order, request lifecycle

### Removed

- `media/westozlogo.png` — unused client branding asset (no references in code)
- `media/westozlogotransparent.png` — unused client branding asset
- `media/QUICK_START.md` — outdated, replaced by docs/
- `README.md` — outdated, replaced by docs/SETUP_GUIDE.md
- `SETUP.md` — outdated, replaced by numbered docs/
- `SECURITY.md` — outdated, replaced by SECURITY_GUIDE.md
- `UPDATES.md` — replaced by CHANGELOG.md
- `change.md` — replaced by CHANGELOG.md
- `branding_color_guide.md` — removed (client-specific, not relevant to setup)
- `setup_email.md` — replaced by docs/6-email-setup.md
- `setup_postgres.md` — replaced by docs/2-database.md
- `setup_security.md` — replaced by SECURITY_GUIDE.md and docs/7-vps-hardening.md
- `setup_sessions.md` — replaced by SECURITY_GUIDE.md
- `setupguide.md` — replaced by docs/SETUP_GUIDE.md
- `docs/email.md` — replaced by docs/6-email-setup.md
- `docs/google.md` — replaced by docs/5-google-oauth.md
- `docs/postgres.md` — replaced by docs/2-database.md

---

## [v8.4.0] — Previous Release

Prior history maintained in git log.
