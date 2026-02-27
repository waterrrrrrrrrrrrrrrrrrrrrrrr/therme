# Thermio TMS — Production Setup Guide

> Complete, step-by-step deployment guide for a fresh Ubuntu 22.04 server.
> Follow every step in order. Do not skip steps.

---

## Prerequisites

- Ubuntu 22.04 LTS server (minimum 1 vCPU, 1 GB RAM)
- A domain name pointing to your server (e.g. app.loveri.ng)
- Cloudflare account with Full (Strict) SSL mode
- SSH access to your server as root or a sudo user

---

## STEP 1 — Update the Server

```bash
sudo apt update && sudo apt upgrade -y
```

---

## STEP 2 — Install Node.js (v20 LTS)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # Should show v20.x.x
npm -v    # Should show 10.x.x
```

---

## STEP 3 — Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
pm2 -v    # Should show 5.x.x
```

---

## STEP 4 — Install Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

---

## STEP 5 — Install Certbot (SSL)

```bash
sudo apt install -y certbot python3-certbot-nginx
```

---

## STEP 6 — Configure Firewall (UFW)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Expected output includes: `80/tcp`, `443/tcp`, `22/tcp` all ALLOW.

---

## STEP 7 — Upload Your Application

Upload the Thermio project folder to your server. Recommended location:

```bash
sudo mkdir -p /var/www/thermio
sudo chown -R $USER:$USER /var/www/thermio
```

Then from your local machine:
```bash
scp -r ./tms-v9/* user@your-server:/var/www/thermio/
```

Or clone/upload via your preferred method (SFTP, git, rsync).

---

## STEP 8 — Configure Environment Variables

```bash
cd /var/www/thermio
cp .env.example .env
nano .env
```

Fill in these values in `.env`:

```env
NODE_ENV=production
PORT=3000

# REQUIRED: Change this to a long random string (32+ characters)
SESSION_SECRET=replace-this-with-a-long-random-secret-string-here

APP_NAME=Thermio
BASE_URL=https://app.loveri.ng

# Optional: Email settings for notifications
SUPPORT_EMAIL=support@yourdomain.com
LEGAL_EMAIL=legal@yourdomain.com
PRIVACY_EMAIL=privacy@yourdomain.com

# Optional: Google OAuth (only if using Google login)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://app.loveri.ng/auth/google/callback
```

**IMPORTANT:** Never commit `.env` to git. Never share it publicly.

---

## STEP 9 — Install Node Dependencies

```bash
cd /var/www/thermio
npm install --production
```

This installs all packages from `package.json`. Do NOT include `node_modules` in your deployment zip.

---

## STEP 10 — Create the Superadmin Account

Run the setup script to create your superadmin (portal admin) account:

```bash
cd /var/www/thermio
node scripts/create-superadmin.js
```

Follow the prompts. This creates the account that logs into `/portal`.

**Keep your superadmin credentials safe.** If you lose them, you'll need to re-run this script.

---

## STEP 11 — Verify the App Starts

Test the app starts without errors:

```bash
cd /var/www/thermio
NODE_ENV=production node app.js
```

You should see:
```
Thermio started | env=production | port=3000
```

Press `Ctrl+C` to stop. Fix any errors before continuing.

---

## STEP 12 — Start the App with PM2

```bash
cd /var/www/thermio
pm2 start app.js --name thermio --env production
pm2 save
pm2 startup   # Follow the command it outputs to enable auto-start on reboot
```

Check the app is running:
```bash
pm2 status
pm2 logs thermio --lines 50
```

---

## STEP 13 — Obtain SSL Certificate (Let's Encrypt)

**IMPORTANT:** Do this BEFORE setting up Cloudflare Full Strict mode.

Point your domain to your server IP in DNS (Cloudflare with DNS-only / grey cloud first).

Then run:
```bash
sudo certbot --nginx -d app.loveri.ng
```

Follow the prompts. Select option to redirect HTTP to HTTPS.

Verify auto-renewal works:
```bash
sudo certbot renew --dry-run
```

---

## STEP 14 — Configure Nginx

Copy the Nginx configuration files:

```bash
# Copy the Thermio nginx config
sudo cp /var/www/thermio/nginx/app.loveri.ng.conf /etc/nginx/sites-available/app.loveri.ng

# Copy the proxy params
sudo cp /var/www/thermio/nginx/thermio_proxy_params /etc/nginx/thermio_proxy_params

# Enable the site
sudo ln -sf /etc/nginx/sites-available/app.loveri.ng /etc/nginx/sites-enabled/

# Remove the default site (optional but recommended)
sudo rm -f /etc/nginx/sites-enabled/default

# Test the configuration
sudo nginx -t
```

Expected output: `syntax is ok` and `test is successful`.

If there are errors, check the config file for issues. Then:

```bash
sudo systemctl reload nginx
```

---

## STEP 15 — Enable Cloudflare Full (Strict) SSL

In your Cloudflare dashboard:

1. Go to your domain → SSL/TLS → Overview
2. Set mode to **Full (Strict)**
3. Go to SSL/TLS → Edge Certificates → Enable **Always Use HTTPS**
4. Enable **HSTS** (recommended): minimum age 6 months, include subdomains

Then toggle your DNS record from **DNS-only** (grey cloud) to **Proxied** (orange cloud).

---

## STEP 16 — Verify the Full Stack

Open your browser and visit `https://app.loveri.ng`:

1. **SSL padlock shows** — Cloudflare is proxying correctly
2. **Login page loads** — Node.js is responding
3. **No console errors** — Open DevTools → Console, check for errors
4. **Login works** — Try the superadmin login at `/portal`
5. **CSRF forms work** — Create a test workspace

---

## STEP 17 — Test Login and Password Change

### Test Login:
1. Navigate to `https://app.loveri.ng/portal`
2. Log in with superadmin credentials
3. Verify you see the portal dashboard

### Test Workspace Login:
1. Create a workspace in the portal
2. Navigate to `https://app.loveri.ng/w/your-workspace-slug/login`
3. Log in with the workspace admin credentials

### Test Password Change (Settings):
1. Log in as a workspace admin
2. Go to Settings → Personal tab
3. Type a new password (must be 8+ characters)
4. Type the same password in Confirm field
5. **"Update Password" button should enable** once both fields have matching passwords >= 8 chars
6. Click Update Password
7. You should be logged out and redirected to login

### Test Forced Change Password:
1. As superadmin, create a new staff user
2. Log in as that user
3. You should be redirected to `/change-password`
4. Type a password (8+ chars)
5. **Strength bar should appear** and update as you type
6. Type matching confirm password
7. **"Set Password & Continue" button should enable**
8. Submit — you should be redirected to the app

---

## STEP 18 — Harden Security

### Fail2Ban:
```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

Create a Thermio-specific jail in `/etc/fail2ban/jail.local`:
```ini
[nginx-http-auth]
enabled = true
port    = http,https
filter  = nginx-http-auth
logpath = /var/log/nginx/thermio-error.log
maxretry = 5
bantime  = 3600
```

```bash
sudo systemctl restart fail2ban
```

---

## Ongoing Operations

### Restart after code changes:
```bash
pm2 restart thermio
```

### View live logs:
```bash
pm2 logs thermio
```

### View Nginx error logs:
```bash
sudo tail -f /var/log/nginx/thermio-error.log
```

### Update SSL certificate manually:
```bash
sudo certbot renew
sudo systemctl reload nginx
```

### Check PM2 auto-start is configured:
```bash
pm2 list
pm2 save
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | Set to `production` |
| `PORT` | No | Default: 3000 |
| `SESSION_SECRET` | **Yes** | Long random string (32+ chars). Never share this. |
| `APP_NAME` | No | Display name, default: Thermio |
| `BASE_URL` | Yes | Full URL: `https://app.loveri.ng` |
| `SUPPORT_EMAIL` | No | Shown in footer |
| `LEGAL_EMAIL` | No | Shown in legal pages |
| `PRIVACY_EMAIL` | No | Shown in privacy pages |
| `GOOGLE_CLIENT_ID` | Only if using Google OAuth | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Only if using Google OAuth | From Google Cloud Console |
| `GOOGLE_CALLBACK_URL` | Only if using Google OAuth | Must match exactly in Google Console |

---

## Troubleshooting

### App won't start:
```bash
pm2 logs thermio --lines 100
```
Look for `Error:` lines. Common causes:
- Missing `.env` variables
- `node_modules` not installed (`npm install --production`)
- Port 3000 already in use (`sudo lsof -i :3000`)

### 403 CSRF errors:
- Restart PM2: `pm2 restart thermio`
- Clear browser cookies for the domain
- Check `SESSION_SECRET` is set in `.env` and not changing between restarts

### Nginx fails to start:
```bash
sudo nginx -t
sudo journalctl -xe
```
Common cause: SSL cert not yet obtained (run Certbot first).

### Password strength bar not showing:
- Open browser DevTools → Console
- Look for JavaScript errors
- Ensure `app.css` loads (check Network tab)
- Ensure you're on `/change-password` page with `mustChangePassword` flag set on your user

### Login redirects to wrong place:
- Check `SESSION_SECRET` is consistent (not changing on restart)
- Check Cloudflare SSL mode is `Full (Strict)` not `Flexible`
- Check `app.set('trust proxy', 1)` is in app.js (it is)

---

*Thermio TMS — Production Setup Guide*
