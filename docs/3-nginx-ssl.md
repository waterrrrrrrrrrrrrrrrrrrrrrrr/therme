# Step 3 — Nginx + SSL

> **Do this BEFORE Google OAuth setup.**
> Google requires HTTPS for OAuth callback URLs. The camera on mobile also requires HTTPS.
> Certbot needs Nginx running to issue the certificate.

---

## 1. Install Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

Test: visit `http://YOUR_SERVER_IP` — you should see the Nginx welcome page.

---

## 2. Point Your Domain to This Server

In your DNS provider (Cloudflare or other), create an **A record**:

```
Type: A
Name: @ (or your subdomain)
Value: YOUR_VPS_IP_ADDRESS
TTL: Auto (or 300)
```

Wait 1–5 minutes for DNS to propagate.

Test: `curl http://yourdomain.com` — should reach Nginx.

---

## 3. Create Nginx Site Config

```bash
sudo nano /etc/nginx/sites-available/thermio
```

Paste:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 50M;
    }
}
```

Replace `yourdomain.com` with your actual domain.

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/thermio /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 4. Install Certbot and Get SSL Certificate

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Follow the prompts. Choose to redirect HTTP to HTTPS when asked.

Certbot automatically updates your Nginx config with SSL settings.

Test renewal:

```bash
sudo certbot renew --dry-run
```

Certificates auto-renew every 90 days via a systemd timer. Verify:

```bash
sudo systemctl status certbot.timer
```

---

## 5. Cloudflare SSL (If Using Cloudflare)

If your domain is behind Cloudflare:

1. In Cloudflare dashboard → SSL/TLS → set mode to **Full (strict)**
2. Make sure the Cloudflare proxy is **orange (proxied)**, not grey
3. Certbot still issues a cert from Let's Encrypt — Cloudflare just adds its own layer
4. Do NOT use "Flexible" SSL mode — it sends plaintext to your server

---

## 6. Verify HTTPS is Working

```bash
curl -I https://yourdomain.com
# Should return: HTTP/2 200
```

Visit `https://yourdomain.com` in a browser — you should see your Thermio app (or an error if `.env` isn't set yet — that's OK, Nginx is working).

---

## 7. Your BASE_URL

Now that HTTPS is working, your `BASE_URL` in `.env` must be:

```
BASE_URL=https://yourdomain.com
```

This is used for Google OAuth callback URLs and email links.

---

## Common Errors

| Error | Fix |
|-------|-----|
| `nginx: [emerg] duplicate listen options` | Remove default site: `sudo rm /etc/nginx/sites-enabled/default` |
| Certbot: `domain not resolving` | DNS hasn't propagated yet — wait 5 min and retry |
| `502 Bad Gateway` | App isn't running on port 3000 — start with PM2 |
| SSL certificate shows as expired | Run `sudo certbot renew` |
| Cloudflare `525 SSL Handshake Failed` | Change Cloudflare SSL mode to "Full (strict)" |
| `client_max_body_size` errors | Already set to 50M in config above |

---

**Next:** [Step 4 — Environment Variables](./4-environment.md)
