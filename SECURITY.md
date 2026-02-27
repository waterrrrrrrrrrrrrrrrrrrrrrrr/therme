# THERMIO TMS — Security Report

**Version:** 8.4.0  
**Date:** 2026-02-24  
**Environment:** Ubuntu 24.04 · Nginx · Cloudflare Full (Strict) · PM2

---

## Security Level Rating

```
Overall: ■■■■■■■■□□  8 / 10
```

| Category | Rating |
|----------|--------|
| Authentication | 9 / 10 |
| Session security | 9 / 10 |
| CSRF protection | 10 / 10 |
| XSS protection | 8 / 10 |
| Brute force protection | 9 / 10 |
| Tenant isolation | 9 / 10 |
| Transport security | 10 / 10 |
| Password security | 9 / 10 |
| Dependency hygiene | 7 / 10 |
| 2FA | 0 / 10 (not implemented) |

---

## Major Risks Fixed

### 1. CSRF Protection — FIXED
**Risk:** Cross-Site Request Forgery on all POST routes  
**Fix:** `csurf` middleware added globally. All POST forms require valid `_csrf` token. API and OAuth callbacks excluded. CSRF errors return 403.

### 2. Session Fixation — FIXED
**Risk:** Attacker pre-sets a session ID before the user logs in  
**Fix:** `regenerateSession()` called in `workspace-auth.js` after successful login. The session ID is regenerated before the redirect, invalidating any pre-set IDs.

### 3. Security Headers — FIXED
**Risk:** Missing HTTP security headers  
**Fix:** `helmet` added with Content-Security-Policy, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy.

### 4. Session Cookie Hardening — FIXED
**Risk:** Session cookie readable by JavaScript or transmitted over HTTP  
**Fix:**
- `httpOnly: true` — JS cannot read the cookie
- `secure: true` (production) — HTTPS only
- `sameSite: strict` — blocks cross-site requests
- Cookie renamed to `__Host-sid` — browser enforces HTTPS and no sub-domain leakage

### 5. Brute Force on Login — FIXED
**Risk:** Unlimited login attempts against `/login`, `/w/:slug/login`, `/portal/login`  
**Fix:** `express-rate-limit` applied: 10 attempts per 15 minutes per IP. Returns 429 with a user-friendly page. Portal login rate-limited separately.

### 6. Password Reset Rate Limiting — FIXED
**Risk:** Unlimited password reset attempts  
**Fix:** Separate `passwordResetLimiter`: 5 attempts per hour per IP.

### 7. bcrypt Work Factor — FIXED
**Risk:** Weak bcrypt rounds  
**Fix:** All password operations use bcrypt rounds=14 (was 12 in some paths). Updated in: workspace creation, portal login, password reset, addthermiostaff script.

### 8. Hidden Owner Account — FIXED (Prompt 1)
**Risk:** Hidden account with `name: 'Workspace Owner'` was created without the operator's knowledge  
**Fix:** The admin user created during workspace provisioning IS the owner (`isOwner: true`). No hidden account.

### 9. XSS in Email Templates — FIXED
**Risk:** User-supplied names and workspace names could inject HTML in emails  
**Fix:** `esc()` function applied to all user-supplied values in HTML emails in `utils/mailer.js`.

### 10. Nodemailer Replaced with Resend — FIXED
**Risk:** SMTP credentials in `.env`, potential credential leakage, old nodemailer package  
**Fix:** Replaced with Resend SDK using API key. No SMTP credentials needed. Resend handles deliverability.

### 11. Privilege Escalation on Portal Routes — FIXED
**Risk:** Portal routes could be accessed without superadmin authentication  
**Fix:** All portal routes use `requirePortalAdmin` middleware. Any unauthenticated or non-superadmin request is redirected to `/portal/login`.

### 12. Tenant Isolation — ENFORCED
**Risk:** User in Workspace A accessing Workspace B data  
**Fix:** All repository queries are scoped by `workspace_id`. Session is bound to workspace. `requireWorkspaceAccess` middleware validates workspace membership on every request.

---

## Minor Risks Fixed

1. **`sameSite: lax` → `strict`** — Prevents CSRF from cross-site navigations
2. **Error message leakage** — Stack traces only shown when `NODE_ENV !== production`
3. **`crypto.randomInt` for password generation** — Replaced `Math.random()` with cryptographic randomness
4. **Demo mode uses sessionStorage** — Resets on tab close, not localStorage which persists
5. **Inline errors instead of alerts** — Wrong-password errors shown inline, not via `alert()`
6. **Avatar changed from `<a>` to `<button>`** — Correct semantic element for interactive controls
7. **`hover:hover` CSS media query** — Prevents hover state issues on touch devices
8. **Comment-only 2FA block removed** — Cleaned up dead commented-out code
9. **`nodemailer` package removed** — Dependency surface reduced

---

## Remaining Risks

### HIGH PRIORITY

**1. Two-Factor Authentication (2FA) — NOT IMPLEMENTED**  
The 2FA middleware is a no-op placeholder. Users with `twoFactorEnabled: true` are not challenged.  
**Risk:** If account credentials are compromised, attacker gains full access.  
**Recommendation:** Implement TOTP (e.g. `speakeasy` + `qrcode`) or SMS-based 2FA.

**2. JSON File Storage Race Conditions**  
While data is in JSON files, concurrent writes are not atomic. Under high load, two simultaneous writes could corrupt a data file.  
**Risk:** Data loss on high-concurrency scenarios.  
**Recommendation:** Complete PostgreSQL migration to eliminate this risk.

**3. No IP Allowlist for /portal**  
The portal admin interface is accessible from any IP.  
**Recommendation:** Restrict `/portal` to your office IP in Nginx:
```nginx
location /portal {
    allow YOUR_OFFICE_IP;
    deny all;
    proxy_pass http://127.0.0.1:3000;
}
```

### MEDIUM PRIORITY

**4. No Audit Log Retention Policy**  
Workspace audit logs grow indefinitely.  
**Recommendation:** Add a retention policy for `workspace_logs` matching the data retention settings.

**5. Canvas Signature Stored as Data URL**  
Admin signatures are stored as base64 data URLs in JSON/DB, which can be large.  
**Recommendation:** Store signatures as separate files with references, or compress/resize before storing.

**6. Puppeteer (Chromium) Attack Surface**  
PDF generation uses Puppeteer with a headless Chromium instance.  
**Risk:** If template data is not sanitised, XSS in the template could theoretically be exploited.  
**Recommendation:** Ensure all data passed to EJS templates for PDF generation is properly escaped.

### LOW PRIORITY

**7. Session Duration (24 hours)**  
Sessions expire after 24 hours.  
**Recommendation:** Implement sliding expiry (extend on activity) and shorter hard timeout (4-8 hours for admin accounts).

**8. No Monitoring / Alerting**  
No uptime monitoring or error alerting is configured.  
**Recommendation:** Configure UptimeRobot or Datadog for uptime, and PM2's `pm2-logrotate` for log management.

---

## Recommendations

### Immediate (Before Going Live)

1. Set `SESSION_SECRET` to 64 random bytes in `.env`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```
2. Set `NODE_ENV=production` in `.env`
3. Verify HTTPS is working and Cloudflare is in Full (Strict) mode
4. Run `node scripts/test-email.js your@email.com` to confirm email works
5. Restrict `/portal` to your IP in Nginx config

### Short Term

6. Implement TOTP-based 2FA using `speakeasy`
7. Complete PostgreSQL migration (schema is ready in `database/schema.sql`)
8. Set up daily database backups (see `docs/postgres.md`)
9. Configure fail2ban to ban IPs with repeated 429 responses
10. Set up PM2 auto-restart on reboot:
    ```bash
    pm2 startup
    pm2 save
    ```

### Medium Term

11. Implement Stripe billing hardening (API key scoping, webhook signature verification)
12. Add audit log search and export for compliance
13. Configure PM2 log rotation: `pm2 install pm2-logrotate`
14. Implement IP allowlist for `/portal` in Nginx
15. Add monitoring (UptimeRobot free tier covers uptime alerts)

---

## Security Architecture Summary

```
Internet
   │
   ▼
Cloudflare (DDoS, WAF, SSL termination)
   │
   ▼ HTTPS (Full Strict)
Nginx (rate limiting, security headers, proxy)
   │
   ▼ HTTP 127.0.0.1:3000
Node.js / Express
   ├── helmet        (CSP, X-Frame, nosniff, referrer-policy)
   ├── csurf         (CSRF token validation)
   ├── express-rate-limit (login + password reset throttling)
   ├── express-session   (HttpOnly, Secure, SameSite=Strict)
   ├── bcrypt (14 rounds)
   ├── middleware/auth   (role-based access control)
   └── Repositories  (workspace_id scoped queries)
   │
   ▼
JSON file storage (→ PostgreSQL when migrated)
```
