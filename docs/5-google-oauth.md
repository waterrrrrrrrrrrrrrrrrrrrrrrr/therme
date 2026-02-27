# Step 5 — Google OAuth Setup

> **Requires HTTPS to be working first (Step 3).**
> Google will reject any redirect URI that uses HTTP (except `localhost`).

---

## 1. Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **Select a project** → **New Project**
3. Name it (e.g. `Thermio TMS`) → **Create**
4. Make sure the new project is selected in the top dropdown

---

## 2. Enable Required APIs

1. In the left menu → **APIs & Services** → **Library**
2. Search for **Google People API** → Enable it
3. (Optional) Search for **Google+ API** → Enable it if listed

---

## 3. Configure OAuth Consent Screen

1. **APIs & Services** → **OAuth consent screen**
2. User type: **External** → **Create**
3. Fill in:
   - App name: `Thermio`
   - User support email: your email
   - Developer contact: your email
4. **Save and Continue** through Scopes (no changes needed — default scopes are fine)
5. **Test users**: Add the email addresses that will test Google login during development
6. **Save and Continue** → **Back to Dashboard**

> ⚠️ While in **Testing** mode, only added test users can log in with Google. Before going live, you must publish the app (change status to **In production**).

---

## 4. Create OAuth 2.0 Credentials

1. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
2. Application type: **Web application**
3. Name: `Thermio Web`
4. **Authorised JavaScript origins:**
   ```
   https://yourdomain.com
   ```
5. **Authorised redirect URIs:**
   ```
   https://yourdomain.com/auth/google/callback
   ```
6. Click **Create**

Copy the **Client ID** and **Client Secret** — add them to your `.env`:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret
```

---

## 5. Restart the App

```bash
pm2 restart thermio
```

---

## 6. Test Google Login

1. Go to `/w/<your-workspace-slug>/login`
2. Click **Sign in with Google**
3. Complete the Google login flow
4. You should be redirected back to `/app`

---

## Publishing (Going Live)

When you're ready for real users:

1. **OAuth consent screen** → **Publish App** → **Confirm**
2. Status changes from **Testing** to **In production**
3. Any Google account can now log in (subject to your workspace user list)

---

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `redirect_uri_mismatch` | URI in Google Console doesn't match exactly | Check `BASE_URL` in `.env` matches what's in Google Console — no trailing slash, exact protocol |
| `Error 400: redirect_uri_mismatch` | Same as above | Remove and re-add the redirect URI in Google Console |
| `Access blocked: This app's request is invalid` | Consent screen not configured | Complete the OAuth consent screen setup |
| Login works but user isn't found | User isn't in the workspace | Admin must create the user in the workspace first |
| `No workspace context for Google login` | Accessing `/auth/google` directly instead of from workspace login page | Always start from `/w/<slug>/login` |
| `This app isn't verified` | App still in Testing mode with unverified users | Add the user's email as a test user |
