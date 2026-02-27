# Email Setup Guide

## Overview

Configure SMTP email for user invites, password resets, and notifications.

---

## Step 1: Choose Email Provider

### Option A: Gmail (Easy for Testing)

**⚠️ Not recommended for production** - Gmail has strict rate limits.

### Option B: SendGrid (Recommended for Production)

**Why SendGrid:**
- Free tier: 100 emails/day
- Reliable delivery
- Easy setup
- Good reputation

### Option C: Amazon SES

**Why SES:**
- Very cheap ($0.10 per 1000 emails)
- Highly scalable
- Requires verification

### Option D: Your Own SMTP Server

**Use if:**
- You have existing mail server
- Complete control needed

---

## Step 2: Get SMTP Credentials

### SendGrid Setup (Recommended)

1. **Sign up:**
   - Go to https://sendgrid.com/
   - Click "Start for Free"
   - Complete registration

2. **Create API Key:**
   - Dashboard → Settings → API Keys
   - Click "Create API Key"
   - Name: `Thermio Production`
   - Permissions: "Full Access"
   - Click "Create & View"
   - **COPY THE KEY NOW** - you won't see it again!

3. **Verify Sender:**
   - Dashboard → Settings → Sender Authentication
   - Click "Verify a Single Sender"
   - Enter: `noreply@yourdomain.com`
   - Complete verification

### Gmail Setup (Testing Only)

1. **Enable 2FA:**
   - Google Account → Security
   - Turn on 2-Step Verification

2. **Create App Password:**
   - Google Account → Security → 2-Step Verification
   - Scroll to "App passwords"
   - Select app: "Mail"
   - Select device: "Other" → "Thermio"
   - Copy the 16-character password

---

## Step 3: Configure Environment Variables

Edit `.env` file:

```bash
nano /var/www/thermio_production/.env
```

### SendGrid Configuration

```env
# SendGrid SMTP
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=SG.your-actual-api-key-here

# Email addresses
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=Thermio
```

### Gmail Configuration (Testing)

```env
# Gmail SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=your-16-char-app-password

# Email addresses
EMAIL_FROM=your-gmail@gmail.com
EMAIL_FROM_NAME=Thermio
```

### Amazon SES Configuration

```env
# SES SMTP
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-ses-smtp-username
SMTP_PASS=your-ses-smtp-password

# Email addresses
EMAIL_FROM=verified@yourdomain.com
EMAIL_FROM_NAME=Thermio
```

---

## Step 4: Test Email Configuration

### Create Test Script

```bash
nano /var/www/thermio_production/test-email.js
```

**Paste this:**

```javascript
require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function test() {
  try {
    const info = await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to: 'your-test-email@example.com', // ← CHANGE THIS TO YOUR EMAIL
      subject: 'Thermio Email Test',
      html: '<h1>Success!</h1><p>Email configuration is working correctly.</p>'
    });
    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
  } catch (error) {
    console.error('❌ Email failed:', error.message);
  }
}

test();
```

### Run Test

```bash
cd /var/www/thermio_production
node test-email.js
```

**Expected Output:**
```
✅ Email sent successfully!
Message ID: <xxxxx@yourdomain.com>
```

### If Test Fails

**Check:**
1. SMTP credentials are correct
2. Firewall allows outbound port 587
3. Email provider account is active
4. Sender email is verified (SendGrid/SES)

---

## Step 5: Test In-App Invites

1. **Login to Thermio**
2. **Go to Staff Management:**
   - `/app/staff`
   - Click "+ Add Staff"

3. **Create User with Email:**
   - First Name: Test
   - Last Name: User
   - Email: your-email@example.com
   - Account Type: Password
   - Click "Add Staff Member"

4. **Check Email:**
   - Should receive invite email
   - Contains username and temporary password
   - Login link included

---

## Step 6: Test Google OAuth Invites

1. **Add Google User:**
   - Go to Staff Management
   - Click "+ Add Staff"
   - Email: google-test@example.com
   - Account Type: Google
   - Click "Add Staff Member"

2. **Check Email:**
   - Should receive Google invite
   - Contains workspace name
   - "Sign in with Google" link

---

## Troubleshooting

### "SMTP connection failed"

**Check firewall:**
```bash
# Allow outbound SMTP
sudo ufw allow out 587/tcp
sudo ufw allow out 465/tcp
```

**Test connection:**
```bash
telnet smtp.sendgrid.net 587
# Should connect successfully
```

### "Authentication failed"

**SendGrid:**
- Verify API key is correct
- Ensure you used `apikey` as SMTP_USER
- Check API key permissions

**Gmail:**
- Verify 2FA is enabled
- Regenerate app password
- Don't use your regular Gmail password

**SES:**
- Verify SMTP credentials (not AWS access keys!)
- Check region matches

### "Sender address rejected"

**SendGrid/SES:**
- Verify sender email in dashboard
- Check email domain is verified
- Wait for verification email

### Emails go to spam

**Fix:**
1. **SPF Record:** Add to DNS
   ```
   v=spf1 include:sendgrid.net ~all
   ```

2. **DKIM:** Configure in SendGrid/SES dashboard

3. **From Address:** Use your domain, not Gmail

---

## Production Best Practices

### 1. Use Dedicated Email Domain

```env
EMAIL_FROM=noreply@thermio.yourdomain.com
```

### 2. Setup Email Templates

Located in `utils/mailer.js` - customize HTML templates.

### 3. Monitor Email Delivery

**SendGrid Dashboard:**
- Dashboard → Activity
- View sent/delivered/bounced

### 4. Handle Bounces

Check SendGrid bounce logs regularly.

### 5. Rate Limiting

**SendGrid Free:** 100 emails/day
**Plan ahead** if sending bulk invites.

---

## Email Template Customization

Edit templates in `utils/mailer.js`:

```javascript
async function sendInvitePasswordEmail({ to, name, username, password, workspaceName, workspaceSlug, loginUrl }) {
  // Customize email content here
}
```

**Variables available:**
- `name` - User's first name
- `username` - Login username
- `password` - Temporary password
- `workspaceName` - Company name
- `loginUrl` - Direct login link

---

## Common Email Providers - Quick Reference

| Provider | SMTP Host | Port | User | Pass |
|----------|-----------|------|------|------|
| SendGrid | smtp.sendgrid.net | 587 | apikey | API Key |
| Gmail | smtp.gmail.com | 587 | your@gmail.com | App Password |
| SES | email-smtp.region.amazonaws.com | 587 | SMTP Username | SMTP Password |
| Mailgun | smtp.mailgun.org | 587 | postmaster@... | API Key |
| Outlook | smtp-mail.outlook.com | 587 | your@outlook.com | Password |

---

## Next Steps

✅ Email working → Continue to [setup_postgres.md](./setup_postgres.md)
