# Thermio TMS — Architecture

---

## Folder Structure

```
therme/
├── app.js                    ← Production entry point (formerly app-postgres.js)
├── DEPRECATEDapp.js          ← Legacy entry (do not use)
├── package.json
├── .env                      ← Environment variables (not in git)
│
├── database/
│   ├── pool.js               ← PostgreSQL connection pool (shared by all repos)
│   ├── schema.sql            ← Table definitions (run once to set up DB)
│   └── migrate.js            ← Schema migration runner
│
├── middleware/
│   └── auth.js               ← requireLogin, requireAdmin, requireOffice, etc.
│
├── repositories/             ← All DB access. One file per table/domain.
│   ├── UserRepo.js
│   ├── WorkspaceRepo.js
│   ├── VehicleRepo.js
│   ├── TempLogRepo.js
│   ├── ExportRepo.js
│   ├── NotificationRepo.js
│   ├── VehicleNotesRepo.js
│   └── WorkspaceLogRepo.js
│
├── routes/
│   ├── app-routes.js         ← Main workspace app routes (/app/*)
│   ├── auth-google.js        ← Passport Google OAuth strategy + callback
│   ├── features-routes.js    ← Exceptions, logs, exports
│   ├── live.js               ← Live dashboard data helper
│   ├── portal.js             ← Superadmin portal (/portal/*)
│   └── workspace-auth.js     ← Workspace login/logout (/w/:slug/login)
│
├── views/                    ← EJS templates
│   ├── partials/             ← Shared header, footer
│   ├── portal/               ← Portal admin views
│   ├── workspace/            ← Workspace settings, exports
│   ├── errors/               ← 404, 500, access-denied
│   └── public/               ← Public marketing pages
│
├── utils/
│   ├── helpers.js            ← Date/timezone helpers, temp range evaluation
│   ├── mailer.js             ← Email sending via Resend
│   ├── exporter.js           ← PDF/ZIP export generation
│   └── scheduler.js          ← Cron jobs (auto-exports, data retention)
│
├── public/
│   ├── app.css               ← All frontend styles
│   └── robots.txt            ← Search engine directives
│
├── uploads/                  ← Uploaded branding assets (workspace logos)
│   └── branding/<workspaceId>/
│
└── docs/                     ← Setup and reference documentation
```

---

## Middleware Stack Order

This order is critical. Changing it can break CSRF, sessions, or auth.

```
app.js startup order:
1. trust proxy           → Enables req.ip from X-Forwarded-For behind Nginx
2. helmet                → Security headers
3. express.json()        → Parse JSON request bodies
4. express.urlencoded()  → Parse form bodies
5. express-session       → Session middleware (reads/writes session cookie)
6. connect-pg-simple     → Session store backend (PostgreSQL)
7. passport.initialize() → Passport setup
8. passport.session()    → Deserialise user from session
9. CSRF (csurf)          → Must come AFTER session (depends on session store)
10. attachWorkspace      → Injects req.workspace from session or URL slug
11. Routes               → All route handlers
12. Error handler        → 500 handler
```

---

## Request Lifecycle

1. **Request arrives** → Nginx receives it and proxies to port 3000
2. **Middleware stack** → helmet, session, passport, CSRF run in order
3. **Route matching** → Express finds the matching route handler
4. **Auth check** → `requireLogin`, `requireAdmin` etc. check `req.session.user`
5. **Workspace resolution** → `attachWorkspace` looks up the workspace from session or URL
6. **Consent check** → Some routes check `req.session.user.consentAccepted`
7. **Handler executes** → Queries the database via repositories
8. **Response** → `res.render(view, data)` or `res.redirect()` or `res.json()`

---

## Session Lifecycle

1. **Login** → Credentials verified → `req.session.user = { id, name, role, workspaceId, ... }`
2. **Session saved** → `connect-pg-simple` writes to the `session` table in PostgreSQL
3. **Subsequent requests** → Session cookie sent → middleware reads session from DB → `req.session.user` populated
4. **Passport (Google login)** → `passport.serializeUser` stores `{ id, workspaceId }` → `deserializeUser` loads full user from DB on each request
5. **Logout** → `req.session.destroy()` → removes row from session table

---

## Workspace Resolution

Workspaces are multi-tenant. Every request needs to know which workspace is active.

- **Workspace app routes** (`/app/*`): workspace ID comes from `req.session.workspaceId`
- **Workspace login routes** (`/w/:slug/*`): workspace slug from URL → looked up in DB
- **Portal routes** (`/portal/*`): no workspace — operates across all workspaces
- `req.workspace` is set by `attachWorkspace` middleware from `app.js`

---

## Google OAuth Flow

```
1. User clicks "Sign in with Google" on /w/<slug>/login
2. Browser → GET /auth/google?state=<workspace-slug>
3. Google redirect → User consents
4. Google callback → GET /auth/google/callback?code=...&state=<workspace-slug>
5. Passport strategy:
   a. Exchange code for tokens
   b. Fetch Google profile
   c. Look up workspace by slug
   d. Find user by Google ID or email in that workspace
   e. If first login → link Google ID to user account
   f. Call done(null, user)
6. Callback route:
   a. Set req.session.user
   b. Redirect to /app
```

---

## Portal vs Workspace Routing

| Area | URL Pattern | Auth | Data Scope |
|------|-------------|------|-----------|
| Public | `/`, `/features`, `/pricing` | None | Public |
| Workspace login | `/w/:slug/login` | None | Single workspace |
| Workspace app | `/app/*` | Login + workspace session | Single workspace |
| Portal | `/portal/*` | Superadmin session | All workspaces |

Portal and workspace sessions are completely separate. A superadmin logging into the portal does not gain access to workspace app routes, and vice versa.

---

## Repository Pattern

All database access goes through repository files in `repositories/`. Routes never write raw SQL.

Each repository:
- Receives a pool connection from `database/pool.js`
- Exposes named methods (`getById`, `create`, `update`, etc.)
- Uses parameterised queries only (`$1, $2, ...`)
- Returns plain JavaScript objects (rows) or arrays

Example:
```js
// In a route:
const user = await UserRepo.getByIdAndWorkspace(id, workspaceId);

// In UserRepo.js:
async function getByIdAndWorkspace(id, workspaceId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE id = $1 AND workspace_id = $2',
    [id, workspaceId]
  );
  return result.rows[0] || null;
}
```
