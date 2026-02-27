# Step 6 — Email Setup (Resend)

Thermio uses [Resend](https://resend.com) to send invite emails and password reset emails.

---

## 1. Create a Resend Account

1. Go to [resend.com](https://resend.com) → Sign Up
2. Verify your email

---

## 2. Add and Verify Your Domain

1. In Resend dashboard → **Domains** → **Add Domain**
2. Enter your domain (e.g. `yourdomain.com`)
3. Resend will show you DNS records to add (SPF, DKIM, DMARC)
4. Add these records in your DNS provider (Cloudflare or other)
5. Click **Verify DNS Records** in Resend

Typical DNS records to add:

| Type | Name | Value |
|------|------|-------|
| TXT | `@` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | (long DKIM key from Resend) |
| TXT | `_dmarc` | `v=DMARC1; p=none;` |

> DNS changes can take up to 24 hours to propagate.

---

## 3. Get Your API Key

1. In Resend dashboard → **API Keys** → **Create API Key**
2. Name: `Thermio Production`
3. Permission: **Full Access**
4. Copy the key (you won't see it again)

Add to `.env`:

```env
RESEND_API_KEY=re_your_api_key_here
FROM_EMAIL=noreply@yourdomain.com
```

> `FROM_EMAIL` must be on the domain you verified in Resend.

---

## 4. Test Email

```bash
npm run test-email
```

Check the output for errors. If it succeeds, you'll receive a test email.

---

## 5. Email Types Sent by Thermio

| Email | Trigger | Template |
|-------|---------|----------|
| Password invite | Admin creates staff member | Includes username + temp password |
| Google invite | Admin creates Google-auth staff | Includes workspace login link |
| Password reset | Admin resets staff password | Includes new temp password |

---

## Common Errors

| Error | Fix |
|-------|-----|
| `403 Forbidden from Resend` | `RESEND_API_KEY` is wrong or expired — create a new one |
| `Domain not verified` | DNS records haven't propagated — wait and retry verification |
| `FROM_EMAIL` domain not matching | Use the exact domain you verified, e.g. `noreply@yourdomain.com` |
| Email goes to spam | Add DMARC record; ensure SPF and DKIM are correct |
| `rate limit exceeded` | You've hit Resend's free tier limits (100/day) — upgrade plan |
| Test email script fails | Check `RESEND_API_KEY` and `FROM_EMAIL` in `.env` |

---

**Next:** [Step 7 — VPS Hardening](./7-vps-hardening.md)
