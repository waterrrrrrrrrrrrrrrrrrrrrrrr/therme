# Thermio TMS — Setup Guide

Complete deployment guide for a fresh Ubuntu 24.04 VPS.
Follow the steps **in order** — each step depends on the previous one.

---

## Step Order

| # | Guide | What It Does | Required Before |
|---|-------|-------------|-----------------|
| 1 | [Server Setup](./1-server-setup.md) | Install Node, PM2, UFW basics | Everything |
| 2 | [Database Setup](./2-database.md) | Install PostgreSQL, create DB, run schema | App startup |
| 3 | [Nginx + SSL](./3-nginx-ssl.md) ⚠️ | Reverse proxy + HTTPS | Google OAuth, Camera |
| 4 | [Environment Variables](./4-environment.md) | `.env` configuration | App startup |
| 5 | [Google OAuth](./5-google-oauth.md) | Google login setup | Requires HTTPS |
| 6 | [Email (Resend)](./6-email-setup.md) | Invite + password emails | Staff creation |
| 7 | [VPS Hardening](./7-vps-hardening.md) | Fail2Ban, SSH, firewall | Going live |
| 8 | [Common Errors](./8-common-errors.md) | Troubleshooting reference | — |

> **⚠️ Why Nginx comes before Google OAuth:**
> Google requires your callback URL to use HTTPS. The camera on mobile devices also requires HTTPS. You must have SSL working before you can configure Google OAuth in the Google Console.

---

## Production Checklist

Before going live, verify:

- [ ] `node app.js` starts with no errors (test on port 3000)
- [ ] PostgreSQL is running and schema is applied
- [ ] `.env` has `NODE_ENV=production` and all required vars
- [ ] `BASE_URL` is your real `https://yourdomain.com`
- [ ] Nginx reverse proxy is running and reachable
- [ ] SSL certificate is valid (`curl https://yourdomain.com`)
- [ ] Google OAuth redirect URI matches `BASE_URL/auth/google/callback`
- [ ] PM2 starts on system boot (`pm2 startup`)
- [ ] Fail2Ban is active (`sudo fail2ban-client status sshd`)
- [ ] UFW only allows ports 22 (or custom SSH port), 80, 443
- [ ] SSH password auth is disabled (key-only)
- [ ] `/portal` is blocked in `robots.txt`
- [ ] Test login via `/w/<your-slug>/login`
- [ ] Test Google login flow end to end

---

## Quick Reference

```bash
# Start app
pm2 start app.js --name thermio

# Restart
pm2 restart thermio

# View logs
pm2 logs thermio

# Check status
pm2 status

# Check Nginx
sudo nginx -t && sudo systemctl reload nginx

# Check PostgreSQL
sudo systemctl status postgresql
```
