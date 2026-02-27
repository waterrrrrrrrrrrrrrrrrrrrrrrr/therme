# Thermio TMS — Security Guide

This document explains the security architecture and the rationale behind each decision.

---

## 1. Password Hashing — bcrypt

**Algorithm:** bcrypt with configurable rounds (default 14 in production).

**Why bcrypt:**
- Deliberately slow by design — resists brute-force attacks
- Includes a salt automatically — identical passwords produce different hashes
- Industry-standard for web application password storage
- 14 rounds takes ~200ms to compute, which is acceptable for login but expensive enough to slow attackers

**Configuration:**
```env
BCRYPT_ROUNDS=14
```

Increase rounds as hardware gets faster. Never store plain-text passwords.

---

## 2. Session Security

Sessions are stored in PostgreSQL via `connect-pg-simple` — not in memory.

**Cookie settings (production):**
```js
httpOnly: true      // JS cannot access the cookie
secure: true        // Only sent over HTTPS
sameSite: 'strict'  // Not sent in cross-site requests
```

**Why PostgreSQL sessions:**
- Survives app restarts
- Can be invalidated server-side (log out, suspend account)
- No memory leak from accumulating sessions
- Scales across multiple instances

**Session rotation:** Session ID regenerates on login to prevent session fixation.

---

## 3. CSRF Protection

Every state-changing form (POST/PUT/DELETE) requires a CSRF token via `csurf`.

**How it works:**
1. Server generates a token and embeds it in every form as a hidden field named `_security-token`
2. On form submit, the server verifies the token matches
3. If it doesn't match → 403 Forbidden

CSRF middleware is loaded **after** the session middleware (required order).

---

## 4. Rate Limiting

`express-rate-limit` is applied to sensitive endpoints:

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/w/:slug/login` | 10 attempts | 15 minutes |
| `/portal/login` | 5 attempts | 15 minutes |
| `/auth/google` | 20 requests | 1 minute |

Exceeding the limit returns a 429 response and renders `errors/rate-limit.ejs`.

---

## 5. Google OAuth Security

- OAuth state parameter is used to bind the Google callback to a specific workspace, preventing cross-workspace login
- Users must exist in the workspace before they can sign in with Google — there is no auto-registration
- Google ID is linked per workspace: a Google account can only be linked to one user per workspace
- The strategy verifies the workspace is active (not suspended) before completing login

**Linking flow:** An existing password user can link their Google account from `/app/settings`. They cannot link if they already have a Google account linked (they must unlink first).

---

## 6. Portal Impersonation

The Thermio portal (`/portal`) is a superadmin-only area. Portal admins can:
- View all workspaces
- Create, suspend, or activate workspaces
- Reset workspace owner credentials
- Export workspace backup data

**Impersonation is NOT implemented.** Portal admins cannot log in as workspace users. The portal is completely separate from the workspace application. All portal actions are logged to `workspace_logs`.

---

## 7. Data Retention

Workspace owners can configure data retention:
- `retentionEnabled: true` activates automatic deletion
- `retentionDays: 365` sets the cutoff (default: 365 days)
- Deletion is scheduled and logged

Deleted logs cannot be recovered. Exports should be taken before deletion runs.

---

## 8. PostgreSQL Hardening

- All queries use parameterised statements via the `pg` driver — no string interpolation, no SQL injection risk
- Database user has only the minimum permissions needed (no superuser, no CREATE DATABASE)
- PostgreSQL listens only on `localhost` — no external network exposure
- `pg_hba.conf` uses `scram-sha-256` for local TCP connections (not `trust`)

---

## 9. Environment Variable Protection

- `.env` is in `.gitignore` — never committed to version control
- File permissions: `chmod 600 .env`
- All secrets (session key, DB password, OAuth credentials) are environment variables, never hardcoded
- In production, consider using a secrets manager (AWS SSM, HashiCorp Vault) instead of a `.env` file

---

## 10. HTTP Security Headers

`helmet` sets the following headers on every response:

| Header | Value |
|--------|-------|
| `X-Frame-Options` | `DENY` — prevents clickjacking |
| `X-Content-Type-Options` | `nosniff` — prevents MIME sniffing |
| `X-XSS-Protection` | `0` (let browser handle it) |
| `Referrer-Policy` | `no-referrer` |
| `Content-Security-Policy` | Configured per environment |
