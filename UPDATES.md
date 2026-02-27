# Thermio — v9.0.0 Update Log

> **PostgreSQL Migration:** This version fully migrates from JSON file storage to PostgreSQL. You are running `app-postgres.js` with the database set up as per the guides in the `docs/` folder.
>
> **Before starting:** Run the schema additions:
> ```bash
> psql "$DATABASE_URL" -f database/schema_additions.sql
> ```

---

## Summary of All Changes

### 🗄️ PostgreSQL — Full Migration

All 7 repositories are now fully async PostgreSQL-backed:

- `repositories/UserRepo.js` — users table with `is_temporary`, `expiry_date`, `password_history`, `password_changed_at`
- `repositories/WorkspaceRepo.js` — workspaces table
- `repositories/VehicleRepo.js` — vehicles table with `is_temporary`, `expiry_date`
- `repositories/TempLogRepo.js` — temp_logs table
- `repositories/WorkspaceLogRepo.js` — workspace_logs table
- `repositories/NotificationRepo.js` — notifications table
- `repositories/ExportRepo.js` — exports table
- `repositories/VehicleNotesRepo.js` — vehicle_notes table

New file: `database/pool.js` — shared connection pool using `DATABASE_URL` from `.env`.

Sessions are stored in PostgreSQL via `connect-pg-simple`.

---

### 🔐 Authentication & Security

**1. Fix Login Background (Post-Workspace)**
- Fixed layout stacking on workspace login screen
- `workspace-login.ejs`: `overflow:hidden`, no duplicate background layers
- Fully responsive on desktop and mobile

**2. Fix 429 Too Many Requests**
- `app-postgres.js`: Separated rate limiters per login path (`/login`, `/portal/login`, `/w/:slug/login`)
- Rate limiter `keyGenerator` reads Cloudflare `CF-Connecting-IP` header first, then `X-Real-IP`, then `req.ip`
- GET requests are skipped from rate limiting (only POST attempts counted)
- `trust proxy` is set to `1` — Nginx must pass `X-Forwarded-For`
- Rate limits: 15 attempts / 15 min for workspace login, 10 / 15 min for portal

**3. Fix 403 on Workspace Settings**
- Settings routes now use `requireOwnerOrAdmin` middleware instead of `requireAdmin`
- Async middleware ensures DB lookup doesn't fail silently

**4. Portal Structure**
- Portal remains on `/portal` with its own isolated login
- `app-postgres.js` passes `portalLoginLimiter` to portal routes separately
- No public links to portal anywhere

**5. Role Hierarchy**
- Role change validation: equal roles cannot modify each other
- Admin cannot modify another admin
- `deactivate()` persists even across workspace suspensions/re-activations (stored in DB)
- Owner transfer protected

**6. Remove 2FA Completely**
- Removed from all views: `features.ejs`, `pricing.ejs`, `security.ejs`
- Removed from backend middleware (`require2FAIfEnabled` is now a passthrough)
- No UI mentions anywhere
- `two_factor_enabled` column kept in schema for safe future use but never checked

---

### 🏢 Workspace & Claims

**7. Workspace Not Found**
- When workspace slug is invalid, `workspace-auth.js` renders `login-workspace-picker` with `workspaceNotFound: true`
- `login-workspace-picker.ejs` shows inline message: "Workspace does not exist."
- Auto-hides after 5 seconds
- No 404 page shown

**8. Remove Multi-Workspace Claims**
- Removed "Unlimited workspaces", "Manage multiple companies", "Platform admin can manage multiple workspaces" from:
  - `landing.ejs`, `features.ejs`, `pricing.ejs`
- Replaced with accurate single-workspace messaging

---

### 📋 Checklist & Sign-Off

**9. Remove Hard-Coded Limits**
- Removed `maxQuestions` from workspace creation forms and workspace settings view
- `max_questions` column kept in schema but no longer enforced at application level
- Staff, asset, and log limits remain configurable per workspace but no hard UI ceiling

**10. Sign-Off System**
- Sign-off respects `workspace.settings.signoff.dayOfWeek`
- Cannot bypass configured sign-off day
- Admin signature stored with IP and user agent
- No stuck states — `adminSignOff()` uses atomic PostgreSQL update

---

### 👥 Staff & Users

**11. Password Creation Rules**
- Creator cannot set or see user password
- System auto-generates secure password using `generatePassword()`
- Email sent automatically with login details
- UI shows: "Login details sent to [email]" — no credentials page shown
- Applies to all workspace users (staff, admins)

**12. Add Staff — Modal Popup**
- `views/staff.ejs`: "Add Staff" button now opens centered overlay modal
- No page redirect, no full reload
- Fields: Name, Email (required), Role, Temporary toggle
- Staff appears in list on next page load
- Success message inline in modal

**13. Temporary Staff & Assets**
- Staff creation modal includes Temporary toggle
- Warning: "Once marked temporary, this cannot be reverted."
- Duration presets: 4 weeks (1 month), 12 weeks (3 months), 24 weeks (6 months), 36 weeks (9 months), 52 weeks (1 year), or custom date
- Expiry at 12:01am on selected date
- `utils/scheduler.js`: hourly check suspends expired temporary users and assets
- Expiry email sent to user on suspension
- `database/schema_additions.sql`: `is_temporary`, `expiry_date` columns added to users and vehicles

**14. Admin Onboarding Email**
- Always sends email when workspace admin is created
- Google account: welcome email, no password
- Password account: formatted credentials in email

**15. Duplicate Asset Names**
- `VehicleRepo.getByRegoAndWorkspace()` added
- `app-routes.js`: checks for existing rego before creating
- Returns 400: "Asset with that name already exists."
- Enforced at DB level via `UNIQUE(workspace_id, rego)` constraint

**16. User Settings Cog**
- Per-user cog icon in staff list for: Reset password, Edit email, Transfer ownership

**17. Console Events & Filters**
- Renamed: `vehicle_created` → `asset_created`, `vehicles_deleted` → `asset_suspended`
- Renamed: `user_deleted` → `user_suspended`
- New: `asset_suspension_lifted`, `user_suspension_lifted`
- Removed: `sheet_locked` event (tempsheet control removed from workspace)
- Tempsheet locking only via `/portal`
- All console filters fixed — `WorkspaceLogRepo.ACTION` now has full list

---

### 🌡️ Temperature System

**18. Status Indicators**
- `live.ejs`, `monitor.ejs`: pulsing animation removed from red and yellow dots
- Yellow dot added: `.status-dot-yellow` style (amber `#f59e0b`)
- Yellow = servicing indicator

**19. Standardise Temperature Type**
- Removed "dispatch" temperature type entirely
- Added "ambient" (replaces dispatch)
- Standard types: `cabin`, `ambient`, `chiller`, `freezer`
- `database/schema_additions.sql`: updated `temperature_type` CHECK constraint to include `ambient`
- `helpers.js`: `extractTemps` updated to use `ambient` instead of `dispatch`

**20. Ambient Temp Not Showing**
- Fixed `extractTemps` in `utils/helpers.js` — now correctly extracts `ambient` readings
- Ambient displays alongside chiller/freezer on compliance sheets

**21. Avg Temp Today & Exceptions Today**
- Calculated across entire workspace (not per-vehicle)
- Fallback: shows "No data" when no logs exist (no dash placeholder)

---

### 📱 Camera

**22. Fix Camera on iOS (Behind Cloudflare)**
- `views/scan.ejs`: Updated `getUserMedia` constraints:
  ```js
  { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }
  ```
- Added per-error-type user-facing messages (`NotAllowedError`, `NotFoundError`, `NotSupportedError`)
- Page must be served over HTTPS (handled by Cloudflare + Nginx)

---

### 🖥️ UI & Visual Polish

**23. Profile Role Badge Styling**
- `header.ejs`: Role badge colours:
  - Driver → Blue (`#60a5fa`)
  - Office → Green (`#4ade80`)
  - Admin / Owner → Yellow (`#fbbf24`)
  - Superadmin → Purple (`#c084fc`)

**24. Active Page Highlight**
- CSS class `.nav-active` applied to current page link in public nav

**25. Landing Page Feature Update**
- Bell text replaced: "We support custom document layouts. Reach out to us and we can arrange it."

**26. Service Records & Notes Layout**
- `truck.ejs` (asset detail): CSS order updated
  - Asset notes under QR code
  - Service records below driver breakdown
  - Both centered above edit/compliance sections

**27. About Page**
- More engaging copy, less corporate-heavy tone

---

### 🧹 Content Cleanup

**28. Remove Technical Speak**
- Removed: "CSRF" references from public-facing views (replaced with "security protection")
- No backend jargon visible to users

**29. Replace "12 Month Retention"**
- All instances replaced with "Custom log retention" across all views and public pages

---

## Running the Updated App

```bash
# 1. Run schema additions (one-time)
psql "$DATABASE_URL" -f database/schema_additions.sql

# 2. If migrating from JSON (skip if already migrated)
node database/migrate.js

# 3. Start the app
pm2 restart thermio
# or if changing entry point:
pm2 delete thermio
pm2 start app-postgres.js --name thermio
pm2 save
```

## Key .env Variables Required

```
DATABASE_URL=postgresql://thermio_user:password@localhost:5432/thermio_db
SESSION_SECRET=your-very-long-random-secret
BASE_URL=https://yourdomain.com
NODE_ENV=production
APP_NAME=Thermio
RESEND_API_KEY=re_xxxx           # for email sending
MAIL_FROM=no-reply@yourdomain.com
GOOGLE_CLIENT_ID=xxx             # optional, for Google OAuth
GOOGLE_CLIENT_SECRET=xxx         # optional
```

---

## v9.1.0 — Correction & Stabilisation (27 Feb 2026)

### 🔴 Sign-Off System (CRITICAL — Fully Enforced)
- **End-shift duplicate prevention**: `shift_done` check blocks re-submission → `error=shift_already_ended`
- **Sign-off day enforcement**: On configured sign-off day, `requireOdometer` and `requireSignature` are validated server-side. Cannot be bypassed via direct POST.
- **Checklist idempotency guard**: `checklist_done` checked before saving — cannot re-submit completed checklist → `error=checklist_already_done`
- **Admin sign-off validation**: Requires `shift_done=true`, rejects duplicate if `admin_signature` already set → `error=already_signed` / `error=shift_not_completed`
- **Admin sign-off logging**: All admin sign-offs logged with `SIGNOFF_COMPLETED` event, IP address, and user agent stored.

### 🔴 Portal Isolation (Fully Confirmed)
- **No public portal links**: All `/portal` references removed from `features.ejs` and `pricing.ejs`.
- **Portal backup restore**: Removed legacy JSON file read/write operations; replaced with PostgreSQL repository operations.
- **Session isolation**: `requirePortalAdmin` enforces `role === 'superadmin'` — workspace users cannot escalate.
- **No portal discovery**: Portal login is not linked from any public or workspace page.
- **Return-to-portal**: Only shown when `portalImpersonation` flag is set in active impersonation session.

### 🔴 Disabled State Persistence (Fully Enforced)
- **User-level flag persisted in session**: `deactivated` and `active` stored in `req.session.user` at login.
- **Login gate**: Deactivated users blocked at login — cannot log in even if workspace is active.
- **`requireWorkspaceAccess` middleware**: Checks user-level `deactivated`/`active` **before** workspace-level suspension check. Workspace re-enable cannot override user disabled state.
- **Compliance**: Disable user → suspend workspace → re-enable workspace → user remains locked.

### 🔴 Avg Temp Today & Exceptions Today (Fixed)
- **`totalLogs`**: Fixed `await` chained to `.reduce()` — now properly: `await getAllByWorkspace()` then `.reduce()`.
- **`avgTempToday`**: Now reads `t.cabin` and `t.ambient` fields (not old `t.temp`) — workspace-wide aggregation across all today's logs.
- **`totalExceptionsToday`**: Now uses `ws.settings.tempRanges` zone thresholds (`cabin`, `ambient`, `chiller`, `freezer`) — not legacy `tempMin`/`tempMax` scalars.
- **Fallback**: Both values return `null` (rendered as `No data`) when no readings exist — no dash placeholder.

### 🔴 Ownership Transfer (Fully Enforced)
- **Only Owner can transfer**: `currentOwner.isOwner` checked — returns 403 if session user is not Owner.
- **Password confirmation required**: Current owner must confirm password before transfer proceeds.
- **Target must be Admin**: `newOwner.role === 'admin'` enforced — cannot transfer to non-admin.
- **Role hierarchy on update-role**: Added full `ROLE_RANK` hierarchy check — admin cannot modify another admin, cannot promote above own rank, cannot demote owner.
- **Ownership transfer logged**: `OWNERSHIP_TRANSFERRED` event added to `WorkspaceLogRepo.ACTION`.

### 🔴 Tempsheet Lock Event Removal (Confirmed)
- `sheet_locked` removed from `logs.ejs` CSS tag styles and filter options.
- `sheet_locked` is absent from `WorkspaceLogRepo.ACTION` — no route logs it.
- No tempsheet lock/unlock UI exists in workspace routes.

### 🔴 Threshold Input & "Cabin/Ambient" Label (Confirmed)
- Workspace settings shows **"Cabin / Ambient"** zone label for threshold inputs.
- `ambient` threshold stored as mirror of `cabin` values on save — `extractTemps()` and exception calculations both use `ambient` field.
- Console displays "Cabin/Ambient Temp" via zone labels in exceptions report.

### ✅ Service Records & Notes Layout (Confirmed Correct)
- CSS `order` corrected: **QR (1) → Notes (2) → Driver Breakdown (3) → Service Records (4) → Edit (5) → Compliance History (6)**

### ✅ Active Page Highlight (Implemented on All Public Pages)
- `.nav-active` CSS class added to all public navigation pages: `about`, `features`, `pricing`, `security`, `privacy`, `terms`, `demo`.
- Style: subtle blue-tinted background with border — non-intrusive, clearly indicates current page.

### ✅ About Page (Rewritten)
- Hero headline, lead paragraph, founder callout quote.
- Four value cards: Accuracy first, Built for speed, Isolated by design, Audit-ready always.
- Sections: Where it started, What we care about, Who we build for, Custom layouts, CTA block.
- Professional tone — approachable and direct, not corporate-heavy.

### 🔧 Async Route Handler Fixes
- All route handlers in `app-routes.js` and `features-routes.js` that use `await` are now properly marked `async`.
- Exceptions report: `dispatch` zone replaced with `ambient` in zone iteration.
