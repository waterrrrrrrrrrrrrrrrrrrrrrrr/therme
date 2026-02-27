# Email Setup — Thermio TMS (Resend)

This guide covers setting up transactional email via Resend for loveri.ng.

---

## Overview

Thermio TMS uses [Resend](https://resend.com) for all transactional email:

| Email type | When sent |
|-----------|-----------|
| Password invite | When a new user is added via Portal |
| Google invite | When a new user is invited via Google |
| Compliance export | After a scheduled or manual compliance export |
| Ownership transfer | When workspace ownership is transferred |
| Exception alert | When temperature exceptions are detected (optional) |

---

## Step 1 — Create a Resend Account

1. Go to [https://resend.com](https://resend.com)
2. Click **Get Started**
3. Sign up with your email
4. Verify your email address

---

## Step 2 — Add and Verify Your Domain

1. In the Resend dashboard, click **Domains** in the left sidebar
2. Click **Add Domain**
3. Enter: `loveri.ng`
4. Click **Add**

Resend will show you DNS records to add. You will need 3 records:

### SPF Record

| Type | Name | Value |
|------|------|-------|
| TXT | `@` (or `loveri.ng`) | `v=spf1 include:amazonses.com ~all` |

### DKIM Records (Resend provides 2)

| Type | Name | Value |
|------|------|-------|
| CNAME | `resend._domainkey` | (Resend provides this value) |
| CNAME | `resend2._domainkey` | (Resend provides this value) |

---

## Step 3 — Add DNS Records in Cloudflare

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click on **loveri.ng**
3. Click **DNS** in the left sidebar
4. Click **Add record** for each record:

**SPF Record:**
- Type: `TXT`
- Name: `@`
- Content: `v=spf1 include:amazonses.com ~all`
- TTL: Auto
- Proxy: OFF (grey cloud — DNS records cannot be proxied)

**DKIM Record 1:**
- Type: `CNAME`
- Name: `resend._domainkey`
- Target: (copy from Resend)
- TTL: Auto
- Proxy: OFF

**DKIM Record 2:**
- Type: `CNAME`
- Name: `resend2._domainkey`
- Target: (copy from Resend)
- TTL: Auto
- Proxy: OFF

Click **Save** after each record.

---

## Step 4 — Wait for DNS Propagation

DNS changes can take 15 minutes to 24 hours.

Check propagation:

```bash
dig TXT loveri.ng +short
```

Expected output:
```
"v=spf1 include:amazonses.com ~all"
```

In the Resend dashboard, click **Verify** on your domain.

What you should see:
```
✓ SPF verified
✓ DKIM verified
Domain status: Verified
```

If not verified after 24 hours:
- Double-check you entered the record values exactly
- Ensure the CNAME records are NOT proxied (grey cloud)
- Clear Cloudflare cache: Caching → Purge Everything

---

## Step 5 — Get API Key

1. In the Resend dashboard, click **API Keys** in the left sidebar
2. Click **Create API Key**
3. Name: `Thermio Production`
4. Permission: **Sending access**
5. Domain: `loveri.ng`
6. Click **Create**
7. Copy the key — it starts with `re_`

> ⚠️ You will only see this key once. Copy it now.

---

## Step 6 — Add to .env

```bash
nano /var/www/thermio/.env
```

Add:

```env
RESEND_API_KEY=re_YOUR_KEY_HERE
MAIL_FROM=no-reply@loveri.ng
EXCEPTION_EMAIL_ENABLED=false
```

**MAIL_FROM must use the verified domain** (`loveri.ng`). Using any other domain will fail.

---

## Step 7 — Restart PM2

```bash
pm2 restart thermio
```

---

## Step 8 — Run the Test Email Script

```bash
node /var/www/thermio/scripts/test-email.js your-real-email@gmail.com
```

Replace `your-real-email@gmail.com` with an email you can access.

**Expected successful output:**

```
=== THERMIO EMAIL TEST ===
API Key : [SET]
From    : no-reply@loveri.ng
To      : your-real-email@gmail.com

Sending test email via Resend...

SUCCESS! Email sent.
Message ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

Check your inbox (and spam folder).
```

**If you see an error:**

```
SEND FAILED:
{ name: 'validation_error', message: 'The sender domain is not verified.' }
```

Fix: The `loveri.ng` domain is not verified in Resend. Complete Steps 2-4.

---

```
SEND FAILED:
{ name: 'authentication_error', message: 'Invalid API key' }
```

Fix: The `RESEND_API_KEY` in `.env` is wrong. Re-copy from Resend dashboard.

---

## Step 9 — Verify Email Arrived

1. Check your inbox
2. Check your spam folder
3. The email should arrive within 30 seconds

Open the email and verify:
- Subject: `Thermio — Email Test`
- From: `no-reply@loveri.ng`
- Body: "Email Test Successful" message

To check SPF/DKIM passed, in Gmail:
1. Open the email
2. Click the three-dot menu → **Show original**
3. Look for:
   ```
   SPF: PASS
   DKIM: PASS
   ```

---

## Step 10 — Enable Exception Emails (Optional)

Exception emails are sent when temperature readings are out of range.

To enable, set in `.env`:

```env
EXCEPTION_EMAIL_ENABLED=true
```

Restart:

```bash
pm2 restart thermio
```

Exception emails are only sent when the mailer detects out-of-range readings during the scheduler run.

---

## How to Test Exception Email

You can manually trigger a test in a Node.js shell:

```bash
node -e "
require('dotenv').config();
process.env.EXCEPTION_EMAIL_ENABLED = 'true';
const { sendExceptionEmail } = require('./utils/mailer');
sendExceptionEmail({
  to: 'your@email.com',
  workspaceName: 'Test Workspace',
  exceptions: [
    { severity: 'critical', vehicle: 'Truck 1', description: 'Chiller at 8°C (max: 4°C)' },
    { severity: 'warning',  vehicle: 'Truck 2', description: 'Freezer at -10°C (min: -25°C)' }
  ]
}).then(r => console.log('Sent:', r)).catch(e => console.error('Error:', e));
"
```

---

## Dev Mode (No API Key)

When `RESEND_API_KEY` is not set or `NODE_ENV` is not `production`, emails are printed to the console instead of sent:

```
========= EMAIL (DEV MODE — NOT SENT) =========
TO:      recipient@example.com
FROM:    no-reply@loveri.ng
SUBJECT: Your workspace credentials
--- BODY (text) ---
Hi Name, ...
================================================
```

This lets you develop and test without sending real emails.

---

## Cloudflare DNS Screenshot Description

When you log in to Cloudflare and go to DNS for `loveri.ng`, you will see a table of DNS records.

The records you need to add will look like this in the table:

```
Type  | Name                   | Content                    | Proxy | TTL
------|------------------------|----------------------------|-------|----
TXT   | loveri.ng              | v=spf1 include:amazon...   | DNS   | Auto
CNAME | resend._domainkey      | p.bounces.amazon...        | DNS   | Auto
CNAME | resend2._domainkey     | p.bounces.amazon...        | DNS   | Auto
```

The **Proxy** column must show a grey cloud icon (DNS only), not an orange cloud (Proxied).
Orange cloud would break email delivery.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Emails going to spam | Add DKIM records. Check SPF includes `amazonses.com` |
| "sender domain not verified" error | Complete domain verification in Resend |
| Email never arrives | Check Resend logs at https://resend.com/logs |
| "Invalid API key" | Re-copy key from Resend. Ensure no spaces around `=` in .env |
| Dev mode when expecting sends | Ensure `NODE_ENV=production` and `RESEND_API_KEY` is set |
