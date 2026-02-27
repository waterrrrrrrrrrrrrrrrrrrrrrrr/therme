# Google OAuth Setup — Thermio TMS

This guide walks you through creating a Google OAuth 2.0 client and connecting it to Thermio TMS.

---

## Overview

Google OAuth allows workspace users to sign in with their Google account instead of a password.

**What works:**
- Users can log in with Google at `/w/YOUR_SLUG/login`
- Existing password users can link their Google account in Account Settings
- Invitations support both password and Google methods

**Important restrictions:**
- Each Google account can only join ONE workspace
- Google login is per-workspace — users must belong to the workspace before they can sign in with Google

---

## Step 1 — Go to Google Cloud Console

Open a browser and go to:

```
https://console.cloud.google.com
```

Sign in with your Google account (the one you use for your business).

---

## Step 2 — Create a New Project

1. Click the project selector dropdown at the top left (next to the Google Cloud logo)
2. Click **New Project**
3. Enter Project name: `Thermio TMS`
4. Leave Organisation as default
5. Click **Create**
6. Wait 10-15 seconds for the project to be created
7. Click the notification bell → click **Select Project**

---

## Step 3 — Enable the Google+ API / People API

1. In the left sidebar, click **APIs & Services** → **Library**
2. Search for: `Google People API`
3. Click it → Click **Enable**

Also enable:

4. Search for: `Google OAuth2 API`
5. Click it → Click **Enable**

---

## Step 4 — Configure OAuth Consent Screen

1. In the left sidebar, click **APIs & Services** → **OAuth consent screen**
2. Select **External** (so any Google user can log in, not just your org)
3. Click **Create**

Fill in the form:

| Field | Value |
|-------|-------|
| App name | Thermio TMS |
| User support email | your@email.com |
| App logo | (optional — upload your logo) |
| App domain | `app.loveri.ng` |
| Authorised domains | `loveri.ng` |
| Developer contact email | your@email.com |

Click **Save and Continue**.

---

## Step 5 — Add Scopes

On the Scopes page:

1. Click **Add or Remove Scopes**
2. Search and select:
   - `../auth/userinfo.email`
   - `../auth/userinfo.profile`
3. Click **Update**
4. Click **Save and Continue**

---

## Step 6 — Add Test Users (Development Only)

If you selected External user type, Google shows a warning screen.

For development:
1. Add your own email as a test user
2. Click **Save and Continue**

For production: Click **Publish App** (removes the "unverified" warning for users)

---

## Step 7 — Create OAuth Credentials

1. In the left sidebar, click **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** at the top
3. Select **OAuth client ID**
4. Application type: **Web application**
5. Name: `Thermio TMS Web`

Under **Authorised JavaScript origins**, add:
```
https://app.loveri.ng
```

Under **Authorised redirect URIs**, add EXACTLY:
```
https://app.loveri.ng/auth/google/callback
```

> ⚠️ This URI must match exactly. No trailing slash. No http://.

Click **Create**.

---

## Step 8 — Copy Client ID and Secret

A popup will show:
- **Your Client ID** — looks like: `123456789-abc123.apps.googleusercontent.com`
- **Your Client Secret** — looks like: `GOCSPX-abc123xyz`

Copy both. You will not see the secret again after closing this popup.

(You can always regenerate the secret from the Credentials page.)

---

## Step 9 — Add to .env

```bash
nano /var/www/thermio/.env
```

Paste in:

```env
GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET
BASE_URL=https://app.loveri.ng
```

`BASE_URL` must match your production domain exactly — this is used to construct the callback URL.

---

## Step 10 — Restart PM2

```bash
pm2 restart thermio
pm2 logs thermio --lines 20
```

---

## Step 11 — Test Google Login

1. Go to `https://app.loveri.ng/w/YOUR_WORKSPACE_SLUG/login`
2. Click **Sign in with Google**
3. Select your Google account
4. You should be redirected back and logged in

If you see "No account found for email@gmail.com":
- The user has not been added to the workspace yet
- Go to Portal → Workspace → Add user with their Gmail address and invite method = Google

---

## Common OAuth Errors

| Error | Meaning | Fix |
|-------|---------|-----|
| `redirect_uri_mismatch` | Callback URL does not match | Check BASE_URL in .env and the URI in Google Console match exactly |
| `invalid_client` | Wrong client ID or secret | Re-copy from Google Console |
| `access_denied` | User denied permissions | User clicked Cancel — try again |
| `No account found` | User not in workspace | Add user to workspace first via Portal |
| `Workspace mismatch` | Google account linked to different workspace | Each Google account can only be in one workspace |
| `app not verified` | Google shows warning screen | Click "Advanced" → "Go to app" during testing |

---

## Example Redirect URIs

For local development:
```
http://localhost:3000/auth/google/callback
```

For production:
```
https://app.loveri.ng/auth/google/callback
```

You can add both to the same OAuth client. This lets you test locally and run in production with the same credentials.

---

## Linking Google to Existing Password Account

Users with a password account can link their Google account:

1. Log in with password
2. Go to Account Settings (top right menu → Personal Settings)
3. Click **Link Google Account**
4. Authorise
5. They can now log in with either password OR Google

---

## One Workspace Per Google Account

If a user tries to join a second workspace with the same Google account, they will see:

> "This Google account is already linked to another user in this workspace."

This is intentional. Each Google account maps to exactly one user record per workspace.

---

## Where the Code Lives

- OAuth strategy: `routes/auth-google.js`
- Callback handler: `routes/auth-google.js` (router.get('/google/callback'))
- Link Google: `app.js` (GET /profile/link-google)
- Workspace login with Google: `routes/workspace-auth.js` (GET /:slug/auth/google)
