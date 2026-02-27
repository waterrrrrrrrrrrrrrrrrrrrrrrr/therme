#!/usr/bin/env bash
# =============================================================
# THERMIO TMS — Nginx + SSL + Cloudflare Setup Guide
# =============================================================
# This script PRINTS instructions only. It does NOT run anything.
# Follow every step on your Ubuntu 24.04 VPS.
# =============================================================

cat << "GUIDE"

╔══════════════════════════════════════════════════════════════╗
║       THERMIO TMS — Nginx + SSL + Cloudflare Guide          ║
║       Ubuntu 24.04 · Let's Encrypt · Cloudflare Full Strict ║
╚══════════════════════════════════════════════════════════════╝

Before starting:
  • Your domain (app.loveri.ng) must already point to this VPS IP in Cloudflare
  • Cloudflare proxy (orange cloud) should be OFF during certificate issuance
  • Your app must be running on port 3000 (pm2 start thermio)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — INSTALL NGINX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    apt-get update
    apt-get install -y nginx

Verify it is running:

    systemctl status nginx

What you should see:
    ● nginx.service ...
       Active: active (running)

Test by opening http://YOUR_VPS_IP in a browser.
You should see the Nginx default welcome page.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — COPY NGINX CONFIG FILES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Copy the app config:

    cp /var/www/thermio/nginx/app.loveri.ng.conf /etc/nginx/sites-available/app.loveri.ng

Copy proxy_params (if system file does not exist already):

    cp /var/www/thermio/nginx/proxy_params /etc/nginx/proxy_params

Enable the site:

    ln -s /etc/nginx/sites-available/app.loveri.ng /etc/nginx/sites-enabled/

Remove the default site:

    rm -f /etc/nginx/sites-enabled/default

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — TEMPORARILY DISABLE SSL FOR CERT ISSUANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Certbot needs port 80 to work. Before getting the cert, create
a simpler config that serves port 80 only:

    nano /etc/nginx/sites-available/app.loveri.ng

Replace the entire file with this temporary config:

    server {
        listen 80;
        server_name app.loveri.ng;
        root /var/www/html;
        location /.well-known/acme-challenge/ { }
        location / { return 301 https://$host$request_uri; }
    }

Save: Ctrl+O, Enter, Ctrl+X.

Test the config:

    nginx -t

What you should see:
    nginx: configuration file /etc/nginx/nginx.conf syntax is ok
    nginx: configuration file /etc/nginx/nginx.conf test is successful

Reload:

    systemctl reload nginx

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4 — INSTALL CERTBOT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    apt-get install -y certbot python3-certbot-nginx

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 5 — DISABLE CLOUDFLARE PROXY TEMPORARILY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IMPORTANT: Let's Encrypt must reach your server directly.
Cloudflare proxy (orange cloud) will interfere.

  1. Go to Cloudflare Dashboard -> loveri.ng -> DNS
  2. Find the A record for app.loveri.ng
  3. Click the orange cloud icon to make it grey (DNS only)
  4. Save

Wait 1-2 minutes for DNS to propagate.

Test direct connectivity:

    curl -I http://app.loveri.ng

You should see an Nginx response.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 6 — GET THE SSL CERTIFICATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    certbot --nginx -d app.loveri.ng --non-interactive --agree-tos -m your@email.com

Replace your@email.com with your real email (for renewal notices).

What you should see:
    Obtaining a new certificate
    ...
    Successfully received certificate.
    Certificate is saved at: /etc/letsencrypt/live/app.loveri.ng/fullchain.pem
    ...
    Congratulations! ...

If it fails:
  • Check that app.loveri.ng resolves to your VPS IP: dig app.loveri.ng
  • Check port 80 is open: ufw allow 80
  • Ensure Cloudflare proxy is OFF (grey cloud)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 7 — RESTORE FULL NGINX CONFIG WITH SSL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Now restore the full production config:

    cp /var/www/thermio/nginx/app.loveri.ng.conf /etc/nginx/sites-available/app.loveri.ng

Test:

    nginx -t

Should show: syntax is ok / test is successful

Reload:

    systemctl reload nginx

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 8 — CONFIGURE CLOUDFLARE SSL TO FULL (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. Go to Cloudflare Dashboard -> loveri.ng -> SSL/TLS
  2. Click "Overview"
  3. Set SSL/TLS encryption mode to: Full (strict)
     (NOT "Flexible" — that would cause redirect loops)

Then re-enable the orange cloud:
  1. Go to DNS
  2. Click the grey cloud next to app.loveri.ng
  3. Make it orange again (proxied)
  4. Save

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 9 — OPEN FIREWALL PORTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    ufw allow OpenSSH
    ufw allow 'Nginx Full'
    ufw --force enable
    ufw status

What you should see:
    Status: active
    To                  Action      From
    --                  ------      ----
    OpenSSH             ALLOW       Anywhere
    Nginx Full          ALLOW       Anywhere

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 10 — TEST HTTPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Open in your browser:

    https://app.loveri.ng

What you should see:
  • Thermio login page loads
  • Padlock icon in browser address bar
  • No SSL warnings

Test redirect (HTTP to HTTPS):

    curl -I http://app.loveri.ng

What you should see:
    HTTP/1.1 301 Moved Permanently
    Location: https://app.loveri.ng/

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 11 — AUTO-RENEWAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Certbot installs a cron job automatically. Verify:

    systemctl status certbot.timer

What you should see:
    Active: active (waiting)

Test renewal dry-run:

    certbot renew --dry-run

What you should see:
    Congratulations, all simulated renewals succeeded:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMMON ERRORS AND FIXES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ERROR: "too many redirects"
FIX: Cloudflare SSL mode is set to "Flexible". Change to "Full (strict)".

ERROR: certbot "Connection refused" or "Timeout"
FIX: Cloudflare proxy is ON during cert issuance. Turn it off (grey cloud).

ERROR: nginx -t shows "No such file or directory" for certificate
FIX: Certificate was not issued yet. Run Step 6 first.

ERROR: 502 Bad Gateway
FIX: Your Node.js app is not running on port 3000.
    pm2 status
    pm2 restart thermio

ERROR: 403 Forbidden for uploads
FIX: Check uploads directory permissions:
    chown -R www-data:www-data /var/www/thermio/uploads

GUIDE
