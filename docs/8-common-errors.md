# Step 8 — Common Errors & Troubleshooting

---

## App Startup Errors

### `SyntaxError: await is only valid in async functions`
**Cause:** A route handler is missing the `async` keyword.
**Fix:** Find the route where the error occurs and add `async` before `(req, res) => {`.
```js
// Wrong:
router.get('/something', (req, res) => {
  const data = await SomeRepo.getAll();
// Right:
router.get('/something', async (req, res) => {
  const data = await SomeRepo.getAll();
```

### `Cannot find module '../repositories/SomeRepo'`
**Cause:** Missing file or wrong import path.
**Fix:** Check that the file exists in `repositories/`. Check the spelling and case.

### `Error: listen EADDRINUSE :::3000`
**Cause:** Something is already running on port 3000.
**Fix:**
```bash
pm2 stop thermio   # if running via PM2
# or
kill $(lsof -t -i:3000)
```

---

## Database Errors

### `ECONNREFUSED 127.0.0.1:5432`
**Cause:** PostgreSQL is not running.
**Fix:** `sudo systemctl start postgresql`

### `FATAL: password authentication failed`
**Cause:** Wrong password in `DATABASE_URL`.
**Fix:** Check `DATABASE_URL` in `.env`. Test connection:
```bash
psql -U thermio_user -d thermio_db -h localhost
```

### `relation "session" does not exist`
**Cause:** Schema hasn't been applied, or the `session` table is missing.
**Fix:** Re-run `psql -U thermio_user -d thermio_db -h localhost -f database/schema.sql`

### `permission denied for table users`
**Cause:** The DB user doesn't have permissions.
**Fix:**
```bash
sudo -u postgres psql -d thermio_db -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO thermio_user;"
sudo -u postgres psql -d thermio_db -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO thermio_user;"
```

---

## Nginx / SSL Errors

### `502 Bad Gateway`
**Cause:** Nginx can't reach the app on port 3000 — app isn't running.
**Fix:** `pm2 status` → if app is not running: `pm2 start app.js --name thermio`

### `SSL_ERROR_RX_RECORD_TOO_LONG`
**Cause:** Cloudflare SSL mode is set to "Flexible" instead of "Full (strict)".
**Fix:** In Cloudflare dashboard → SSL/TLS → change to **Full (strict)**

### `ERR_TOO_MANY_REDIRECTS`
**Cause:** Infinite redirect loop, often from incorrect Cloudflare SSL setting.
**Fix:** Set Cloudflare SSL to **Full (strict)**; ensure Nginx isn't forcing HTTPS over HTTPS

### `nginx: [emerg] duplicate listen options for 0.0.0.0:80`
**Fix:** `sudo rm /etc/nginx/sites-enabled/default && sudo systemctl reload nginx`

---

## Google OAuth Errors

### `redirect_uri_mismatch`
**Cause:** The redirect URI in `.env` (`BASE_URL`) doesn't match what's in Google Console.
**Fix:**
1. Check `BASE_URL=https://yourdomain.com` (no trailing slash, exact protocol)
2. In Google Console, verify: `https://yourdomain.com/auth/google/callback` is listed
3. Restart the app after changing `.env`

### `No workspace context for Google login`
**Cause:** User navigated to `/auth/google` directly instead of via workspace login.
**Fix:** Always start from `/w/<workspace-slug>/login`

### `This app isn't verified by Google`
**Cause:** OAuth app is in Testing mode.
**Fix:** Add user's email as a test user in Google Console → OAuth consent screen, or publish the app.

---

## Session / Authentication Errors

### Users getting logged out immediately
**Cause:** `SESSION_SECRET` changed, or `connect-pg-simple` can't write to the session table.
**Fix:**
1. Verify `SESSION_SECRET` is set and stable in `.env`
2. Check session table: `psql ... -c "SELECT COUNT(*) FROM session;"`
3. Ensure `NODE_ENV=production` is set (enables secure cookies)

### `CSRF token mismatch`
**Cause:** Form submitted without `_security-token` field, or session expired.
**Fix:** Reload the page and resubmit. If persistent, check the EJS template includes `<input type="hidden" name="_security-token" value="<%= csrfToken %>">` (note: the field name is `_security-token`).

---

## Camera (QR Scan) Errors

### Camera not working on mobile
**Cause 1:** Site is not on HTTPS — camera API is blocked on HTTP.
**Fix:** Ensure SSL is working (Step 3). The camera **requires HTTPS**.

**Cause 2:** Browser hasn't been granted camera permission.
**Fix:** In the browser, tap the camera/lock icon in the address bar → Allow Camera.

**Cause 3:** Another app is using the camera.
**Fix:** Close other camera apps and reload.

---

## Email Errors

### Invite emails not arriving
1. Check spam folder
2. Verify `FROM_EMAIL` domain is verified in Resend
3. Check `RESEND_API_KEY` is valid: `npm run test-email`
4. Check Resend dashboard for failed deliveries

### `403 from Resend`
**Cause:** Invalid or expired API key.
**Fix:** Create a new API key in Resend dashboard.

---

## PM2 Errors

### App crashes on startup (PM2 shows `errored`)
```bash
pm2 logs thermio --lines 50
```
Look for the actual error. Common causes: missing `.env`, database not running, syntax error.

### PM2 not starting after reboot
```bash
pm2 startup
# Run the command it outputs
pm2 save
```

### `ENOENT .env` — env file not found
**Fix:** Create `.env` in the project root. PM2 must be started from the correct directory:
```bash
cd /home/$(whoami)/therme && pm2 start app.js --name thermio
```

---

## Permissions Errors

### `EACCES: permission denied, mkdir 'uploads/'`
**Fix:** `chmod -R 755 uploads/` or `mkdir -p uploads && chmod 755 uploads`

### `EACCES: permission denied, open 'logs/'`
**Fix:** `mkdir -p logs && chmod 755 logs`
