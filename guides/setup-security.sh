#!/usr/bin/env bash
# =============================================================
# THERMIO TMS — Security Setup & Verification Guide
# =============================================================
# This script PRINTS instructions only. It does NOT run anything.
# Follow every step on your Ubuntu 24.04 VPS.
# =============================================================

cat << "GUIDE"

╔══════════════════════════════════════════════════════════════╗
║       THERMIO TMS — Security Setup & Verification Guide     ║
║       Ubuntu 24.04 · helmet · csurf · rate-limit            ║
╚══════════════════════════════════════════════════════════════╝

This guide verifies and activates all security features built
into Thermio TMS v8.4.0. Most of these are already active once
the app is running in production mode.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — INSTALL SECURITY PACKAGES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

From your app directory (/var/www/thermio):

    npm install

This installs all packages including:
  • helmet         — Security HTTP headers
  • csurf          — CSRF token protection
  • express-rate-limit — Brute force protection

Verify packages are installed:

    ls node_modules | grep -E "helmet|csurf|express-rate-limit"

What you should see:
    csurf
    express-rate-limit
    helmet

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — VERIFY NODE_ENV IS SET TO PRODUCTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check your .env file:

    grep NODE_ENV /var/www/thermio/.env

What you should see:
    NODE_ENV=production

Why it matters:
  • Secure cookies are only set in production mode
  • Error details are hidden in production
  • CSP headers are stricter

If NODE_ENV is not set, add it:

    echo "NODE_ENV=production" >> /var/www/thermio/.env

Then restart:

    pm2 restart thermio

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — CONFIRM SECURITY HEADERS ARE ACTIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

From your local computer, run:

    curl -sI https://app.loveri.ng | grep -E "X-Frame|X-Content|Content-Security|Referrer"

What you should see:
    x-frame-options: DENY
    x-content-type-options: nosniff
    content-security-policy: default-src 'self'; ...
    referrer-policy: strict-origin-when-cross-origin

If headers are missing:
  • Ensure NODE_ENV=production
  • Restart: pm2 restart thermio
  • Verify helmet is installed: ls node_modules/helmet

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4 — VERIFY CSRF PROTECTION IS ACTIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CSRF tokens are embedded in all forms automatically.
To verify, view the HTML source of any login page:

  1. Open https://app.loveri.ng/login in your browser
  2. Right-click -> View Page Source
  3. Search for: _csrf

What you should see:
    <input type="hidden" name="_csrf" value="some-token-value">

To test CSRF rejection:

    curl -X POST https://app.loveri.ng/login \
      -d "workspace=test" \
      -v 2>&1 | grep "HTTP/"

What you should see:
    HTTP/2 403

This confirms that POST requests without a valid CSRF token are rejected.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 5 — TEST BRUTE FORCE PROTECTION (LOGIN RATE LIMIT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The login route is limited to 10 attempts per IP per 15 minutes.

To test (from your local machine):

    for i in $(seq 1 12); do
      curl -s -o /dev/null -w "%{http_code}\n" \
        -X POST https://app.loveri.ng/login \
        -d "workspace=test"
    done

What you should see:
    403 (for attempts 1-10, CSRF rejection is fine here)
    429 (for attempts 11 and 12 — rate limit kicked in)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 6 — VERIFY SESSION SECURITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

In production, session cookies must have these attributes:
  • HttpOnly     — JS cannot read the cookie
  • Secure       — Only sent over HTTPS
  • SameSite     — Strict (blocks CSRF from other origins)

To verify, in your browser:
  1. Open https://app.loveri.ng
  2. Open Developer Tools (F12)
  3. Go to Application -> Cookies -> https://app.loveri.ng
  4. Find the cookie named __Host-sid

What you should see:
    HttpOnly:  checked
    Secure:    checked
    SameSite:  Strict

If Secure is NOT checked:
  • NODE_ENV must be production
  • You must be accessing via HTTPS, not HTTP

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 7 — VERIFY SESSION REGENERATION ON LOGIN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Session fixation protection: the session ID changes on login.

To test:
  1. Open https://app.loveri.ng/login in a private browser tab
  2. Note the cookie value for __Host-sid before login
  3. Log in
  4. Note the cookie value for __Host-sid after login
  5. The value should be DIFFERENT

This prevents session fixation attacks where an attacker pre-sets
a known session ID before the user logs in.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 8 — WHERE MIDDLEWARE IS ADDED (FOR DEVELOPERS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

All security middleware is in app.js:

  helmet    -> Line ~27   (app.use(helmet({...})))
  CSRF      -> Line ~62   (csrfMiddleware + csrfProtection)
  Rate limit -> Line ~82  (loginLimiter, passwordResetLimiter)
  Session   -> Line ~42   (session({...}))

To add more middleware:
  1. Install package: npm install package-name
  2. Require it in app.js: const x = require('package-name');
  3. Use it: app.use(x({...})); — add BEFORE route definitions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 9 — RECOMMENDED: FAIL2BAN FOR ADDITIONAL PROTECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fail2ban bans IPs that repeatedly trigger 429 responses.

Install:

    apt-get install -y fail2ban

Create a jail for Nginx:

    nano /etc/fail2ban/jail.local

Add:

    [nginx-limit-req]
    enabled  = true
    filter   = nginx-limit-req
    action   = iptables-multiport[name=ReqLimit, port="http,https", protocol=tcp]
    logpath  = /var/log/nginx/thermio-access.log
    findtime = 600
    bantime  = 7200
    maxretry = 10

Restart fail2ban:

    systemctl restart fail2ban

Check status:

    fail2ban-client status nginx-limit-req

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 10 — QUICK SECURITY CHECKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run through this checklist before going live:

  [ ] NODE_ENV=production in .env
  [ ] SESSION_SECRET is 64 random bytes (not the default)
  [ ] RESEND_API_KEY is set (email working)
  [ ] GOOGLE_CLIENT_ID and SECRET are set (OAuth working)
  [ ] DATABASE_URL is set (PostgreSQL connected)
  [ ] HTTPS is working (padlock in browser)
  [ ] Cloudflare SSL is "Full (strict)"
  [ ] Security headers present (curl -sI https://app.loveri.ng)
  [ ] CSRF tokens in all forms (check page source)
  [ ] Rate limit active (Step 5 test passes)
  [ ] Session cookie is HttpOnly + Secure + SameSite=Strict
  [ ] fail2ban installed and configured
  [ ] PM2 set to restart on reboot: pm2 startup && pm2 save

GUIDE
