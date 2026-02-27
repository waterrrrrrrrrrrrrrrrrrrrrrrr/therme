# Step 4 — Environment Variables

Create the `.env` file in the project root. This file is NOT committed to git.

```bash
cd /home/$(whoami)/therme
nano .env
```

---

## Full .env Template

```env
# ── Application ─────────────────────────────────────────────────
NODE_ENV=production
PORT=3000

# Your domain (must match Nginx and Google OAuth redirect URI)
# Must include https:// and no trailing slash
BASE_URL=https://yourdomain.com

# ── Database ─────────────────────────────────────────────────────
DATABASE_URL=postgresql://thermio_user:your_password@localhost:5432/thermio_db

# ── Session ──────────────────────────────────────────────────────
# Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
SESSION_SECRET=your_very_long_random_secret_here

# ── Google OAuth ──────────────────────────────────────────────────
# From Google Cloud Console → APIs & Services → Credentials
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_google_client_secret

# ── Email (Resend) ────────────────────────────────────────────────
RESEND_API_KEY=re_your_resend_api_key
FROM_EMAIL=noreply@yourdomain.com

# ── Security ─────────────────────────────────────────────────────
# Number of bcrypt rounds (14 is recommended for production)
BCRYPT_ROUNDS=14

# ── Sign-off ─────────────────────────────────────────────────────
# Day of week for weekly sign-off (0=Sun, 1=Mon, 5=Fri)
SIGNOFF_DAY=5

# Set to 'true' ONLY when testing sign-off on non-signoff days (dev only)
# FORCE_SIGNOFF_DAY_FOR_TESTING=false
```

---

## Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | Set to `production` — enables secure cookies, disables verbose errors |
| `PORT` | No | Defaults to 3000 |
| `BASE_URL` | Yes | Your HTTPS domain. Must match Google OAuth redirect URI exactly |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Long random string. Changing this logs everyone out |
| `GOOGLE_CLIENT_ID` | Yes* | From Google Console. Required if using Google login |
| `GOOGLE_CLIENT_SECRET` | Yes* | From Google Console. Required if using Google login |
| `RESEND_API_KEY` | Yes* | From Resend dashboard. Required for invite emails |
| `FROM_EMAIL` | Yes* | Must be a verified domain in Resend |
| `BCRYPT_ROUNDS` | No | Defaults to 12 if unset. 14 recommended for production |
| `SIGNOFF_DAY` | No | Defaults to 5 (Friday). Overridden per-workspace in settings |

*Required for that feature to work, not required for app to start.

---

## Generate SESSION_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copy the output into your `.env`.

---

## Protect the .env File

```bash
chmod 600 .env
```

Verify `.env` is in `.gitignore`:

```bash
grep '.env' .gitignore
# Should output: .env
```

---

## Common Errors

| Error | Fix |
|-------|-----|
| `SESSION_SECRET` not set | App will still run but sessions won't persist — set it |
| `GOOGLE_CLIENT_ID_NOT_SET` in logs | Google OAuth not configured — add vars or disable Google login |
| Email not sending | Check `RESEND_API_KEY` and `FROM_EMAIL` domain verification |
| `Invalid connection string` | Check `DATABASE_URL` format — must start with `postgresql://` |
| App starts but no session persistence | Check `SESSION_SECRET` is set and not empty |

---

**Next:** [Step 5 — Google OAuth](./5-google-oauth.md)
