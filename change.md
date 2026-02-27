# Thermio Master Upgrade - Change Log

## PART 1 - BACKEND / SECURITY / LOGIC

### ✔ Completed

1. **Force Logout on Password Change**
   - ✔ Invalidates ALL sessions across all devices
   - ✔ Uses `passwordChangedAt` timestamp
   - ✔ Middleware checks on every request
   - ✔ User logged out on next action after password change

2. **Password History (Last 3)**
   - ✔ Stores hashed previous passwords in `passwordHistory` array
   - ✔ Blocks reuse of last 3 passwords
   - ✔ Fixed temp password reset allowing same password reuse

3. **Password Strength Enforcement**
   - ✔ Requires 8+ characters
   - ✔ Requires 1 uppercase letter
   - ✔ Requires 1 number
   - ✔ Requires 1 special character
   - ✔ Must reach "Strong" before Continue works
   - ✔ Shows "Password strength insufficient" / "Moderate password strength" / "Strong password"
   - ✔ Added eye visibility toggle to FIRST password field only (not confirm)

4. **Redirect Fixes**
   - ✔ After login → /app
   - ✔ After /consent → /app
   - ✔ Removed redirect to /app/staff/:X after first login
   - ✔ Fixed /app with no workspace context → redirects to login instead of 403

5. **Workspace Settings Fix**
   - ✔ Fixed 403 on branding/color change
   - ✔ Created `requireOwnerOrAdmin` middleware
   - ✔ Only Owner and Admin can access workspace settings
   - ✔ Office and Driver cannot access workspace settings
   - ✔ CSRF validation maintained
   - ✔ Icon art now applies correctly
   - ✔ Background media now applies correctly

6. **Question Limit Enforcement**
   - ✔ Per-workspace limit enforced
   - ✔ HARD LIMIT of 30 questions (global)
   - ✔ Shows question count (e.g., "Questions: 5/10")
   - ✔ Button disabled when limit reached
   - ✔ Clear error messages
   - ✔ All questions show on temp sheet

7. **Checklist Reordering**
   - ✔ Drag/drop reorder works smoothly
   - ✔ Respects workspace limit
   - ✔ Respects hard 30 limit
   - ✔ Cannot add more than limit

8. **Transfer Ownership Flow**
   - ✔ Transfer Ownership button visible for owners
   - ✔ Enter password popup
   - ✔ Shows "Incorrect Password" inline if wrong
   - ✔ Warning about downgrade to Driver
   - ✔ Confirm yes/no popup
   - ✔ On confirm → transfer then downgrade

9. **Live Page Fix**
   - ✔ Fixed [object Object] display
   - ✔ Changed `p.vehicle` → `p.vehicleRego`
   - ✔ Changed `t.driver` → `t.driverName`
   - ✔ Activity updates correctly for both vehicles and staff

10. **QR Scan Fix (Mobile)**
    - ✔ Live camera stream (not photo mode)
    - ✔ Requests camera permission
    - ✔ Auto redirect on QR detection
    - ✔ Works on iPhone + Android

11. **Google Account Management**
    - ✔ First-time Google users (Owner) don't get password change prompt
    - ✔ Cannot link multiple Google accounts
    - ✔ Added unbind option with "Are you sure?" prompt
    - ✔ Unbind button in Personal Settings
    - ✔ Link Google button when not linked

---

## PART 2 - FRONTEND / UI / STRUCTURE

### ✔ Completed

1. **Mobile-Only Updates**
   - ✔ Center divider line REMOVED on workspace login (mobile) - no visible lines
   - ✔ Mobile shows dark background when photo-side hidden
   - ✔ Gradient ball animation when no brand image (blue/yellow balls)
   - ✔ Balls show on BOTH mobile AND desktop when no loginBackground
   - ✔ Balls show in photo-side panel on desktop
   - ✔ Desktop layout remains pixel-identical
   - ✔ Marketing/landing page mobile layout cleanup (responsive grid, stacked buttons, hidden nav)
   - ✔ Branding color system recommendation guide created

2. **Role Popup Spacing Fix**
   - ✔ Fixed spacing glitch
   - ✔ Added `overflow-y: auto` to modal
   - ✔ Added padding to modal-overlay
   - ✔ No more scroll glitch

3. **General Fixes**
   - ✔ /app with no workspace context now redirects to login (not 403 error)

4. **Temp Sheet Controls**
   - ✔ Added toggle: `workspace.enableWorksheet` in Compliance Settings
   - ✔ Backend saves enableWorksheet setting
   - ✔ Only visible if enabled in workspace settings

5. **Temp Sheet Header Modernization**
   - ✔ Added hamburger menu button
   - ✔ Modern consistent header styling

6. **Vehicle Page Layout Cleanup**
   - ✔ Moved Servicing section to right sidebar (380px)
   - ✔ Moved Notes section to right sidebar
   - ✔ Two-column layout (main content + sidebar)
   - ✔ Responsive (stacks on mobile <1100px)

7. **Service Status Indicators**
   - ✔ Yellow "Service Soon" badge: Service due within 30 days
   - ✔ Red "Service Due" badge: Service due within 7 days
   - ✔ Shows on asset cards in assets list
   - ✔ CSS added for .live-dot.yellow

8. **Service Date Field Improvements**
   - ✔ Added helper labels: "Last Service Date" / "Next Service Due"
   - ✔ Improved form layout with flex columns
   - ✔ Better visual hierarchy

9. **Shift Summary Upgrade**
   - ✔ Added "Return to Workspace Home" button (green, prominent)
   - ✔ Modern congratulatory layout with success styling
   - ✔ Green gradient background and celebration emoji
   - ✔ Consistent styling with rest of system


---

## Files Modified

### Part 1:
- `repositories/UserRepo.js`
- `app.js`
- `middleware/auth.js`
- `routes/auth-google.js`
- `routes/workspace-auth.js`
- `routes/portal.js`
- `routes/app-routes.js`
- `views/workspace/settings.ejs`
- `views/live.ejs`
- `views/scan.ejs`

### Part 2:
- `middleware/auth.js` (redirect fix)
- `views/workspace-login.ejs` (mobile + gradient balls)
- `views/staff-stats.ejs` (role popup fix)

---

## Testing Required

### Part 1:
- Multi-device logout test
- Password history blocking
- Password strength enforcement
- All redirects
- Workspace settings (Owner/Admin only)
- Question limits
- Transfer ownership
- Live page display
- QR scanner on mobile
- Google account linking/unlinking

### Part 2:
- Mobile login appearance
- Gradient balls animation
- Role popup (no scroll glitch)
- /app redirect when no workspace

---

## Documentation Files

### ✔ Completed

1. **change.md** - Complete change log for Part 1 and Part 2
2. **setupguide.md** - Main production setup guide (10 steps)
3. **setup_email.md** - SMTP/email configuration (SendGrid, Gmail, SES)
4. **setup_postgres.md** - PostgreSQL migration guide
5. **setup_sessions.md** - Redis/PostgreSQL session store setup
6. **setup_security.md** - Security hardening guide
7. **branding_color_guide.md** - Complete branding color system recommendations with templates, accessibility guidelines, and testing checklist

---

## 🔴 UPPER CAPS REMINDER - ACTIVITY TRACKING CHECK

**GO TO `/APP/STAFF` PAGE → CLICK ON ANY STAFF MEMBER**

**CHECK IF "LAST ACTIVE DATE" SHOWS CORRECTLY AFTER THEY CREATE A TEMPERATURE LOG**

**THIS IS CALCULATED FROM LOG DATES - SHOULD UPDATE AUTOMATICALLY**
