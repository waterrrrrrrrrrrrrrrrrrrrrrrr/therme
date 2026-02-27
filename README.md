# Thermio

Thermio is a temperature monitoring and compliance system built for cold chain operators. It provides digital temperature logging, real-time fleet visibility, automated compliance records, and multi-workspace management — all in one platform.

---

## Who It Is For

Thermio is designed for businesses that transport or store temperature-sensitive goods, including:

- Refrigerated transport operators
- Cold storage facilities
- Food distribution companies
- Multi-site operations with multiple fleets or locations

---

## Platform Structure

Thermio operates as a **multi-workspace** platform. Each workspace is a fully isolated environment representing a single business or site.

### Portal (System Level)
The Portal is accessed by Portal Admins only. It is the top-level management layer:

- Create and manage workspaces
- Set usage limits (users, assets, checklist questions)
- Access workspace owner accounts
- Reset owner passwords
- View system-wide statistics
- Configure per-workspace data retention

### Workspace (Business Level)
Each workspace contains:

- Staff accounts (Owner, Admin, Office, Driver)
- Assets (vehicles, fridges, freezer rooms)
- Temperature logs and compliance records
- Checklist questions
- Settings (timezone, sign-off day, thresholds, branding)

---

## Roles

| Role | Access |
|------|--------|
| **Driver** | Log temperatures, complete checklists |
| **Office** | View all data and reports (read-only) |
| **Admin** | Full workspace access — manage staff, assets, settings, sign-offs |
| **Owner** | Same as Admin, plus can transfer ownership. Internal flag only. |
| **Portal Admin** | Manages all workspaces via the portal |

---

## Workspace Owner

Each workspace has exactly one Owner account. The Owner is created automatically when a workspace is provisioned.

- The Owner flag (`isOwner: true`) is internal and is never shown in role dropdowns
- The Owner account has the same permissions as Admin
- Owner credentials are managed exclusively via the Portal
- Portal Admins can log in as the Owner or reset the owner password at any time

### Ownership Transfer

An Owner can transfer their ownership to any existing Admin within the same workspace:

1. Navigate to the Admin's staff profile (`/app/staff/:id`)
2. Click **Transfer Ownership**
3. Confirm your password in the modal
4. Upon confirmation, the selected Admin becomes the new Owner and the previous Owner is demoted to Driver

This action is irreversible and takes effect immediately.

---

## Password Reset Behaviour

When a Portal Admin resets an Owner's password:

- A new 16-character temporary password is generated
- The password is hashed using bcrypt with 14 rounds
- `mustChangePassword` is set to `true` — the owner must change their password on next login
- The temporary password is displayed **once** in the portal UI and will not be shown again
- A simulated email is logged to the server console (no real email is sent)

---

## Temperature Threshold System

Temperature thresholds are configured per workspace in **Workspace Settings → Temperature Ranges**.

- **Chiller**: Configurable minimum and maximum (e.g. 0°C to 4°C)
- **Freezer**: Configurable minimum and maximum (e.g. -18°C to -20°C)

Thresholds are displayed next to temperature type options when creating or editing assets. If a logged temperature falls outside the configured range, it is recorded as an **exception**.

There are no hard-coded temperature values in the system. All ranges come from workspace settings.

---

## Sign-Off Configuration

Each workspace has a configurable **sign-off day** — the day of the week on which the weekly temperature sheet is finalised and requires admin sign-off.

- Configured in: Workspace Settings → Sign-Off Day
- Default: Friday
- The compliance week runs from Monday to the configured sign-off day
- Drivers must complete their shift and sign the sheet before the sign-off day

---

## Timezone Handling

Each workspace has a configurable timezone. All date and time calculations — including "today's" date for logging, the live fleet status, and overdue vehicle detection — use the workspace's configured timezone via the Luxon library.

Supported timezones include all IANA timezone identifiers (e.g. `Australia/Perth`, `Australia/Sydney`, `Pacific/Auckland`).

---

## Data Retention

Each workspace can enable automatic data retention with a configurable retention period (minimum 30 days, default 365 days).

When enabled, temperature logs older than the retention period are automatically purged during the nightly scheduled job.

Retention is configured per workspace via the Portal: **Portal → Workspace → Data Retention**.

---

## Demo Mode

A public demo is available at `/demo`. It runs entirely in the browser with no backend connection:

- All data is stored in `localStorage` and resets on page refresh
- The demo includes: Assets, Staff, Temperature Logging, Live Monitor
- No account or login is required

---

## Homepage Live Fleet Preview

The landing page shows a live-updating fleet summary panel:

- Animated counters: Live Vehicles, Overdue, Logs Today
- Six simulated vehicle rows with colour-coded temperature readings
- Updates every 4 seconds with a smooth fade transition
- Pure frontend — no API calls

---

## Installation

### Prerequisites

- Node.js 18+
- npm

### Steps

```bash
# 1. Clone the repository
git clone <repository-url>
cd tms-v8

# 2. Install dependencies
npm install

# 3. Copy the environment file
cp .env.example .env

# 4. Edit .env with your settings (see Environment Variables below)

# 5. Create the data directory
mkdir -p data

# 6. Start the server
npm start
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `SESSION_SECRET` | Secret key for session encryption | *(required)* |
| `BASE_URL` | Public base URL for the application | `http://localhost:3000` |
| `APP_NAME` | Application display name | `Thermio` |
| `NODE_ENV` | Environment (`development` / `production`) | `development` |
| `SIGNOFF_DAY` | Default sign-off day of week (0=Sun, 5=Fri) | `5` |
| `UPLOAD_MAX_MB` | Max file upload size in MB | `10` |
| `FORCE_SIGNOFF_DAY_FOR_TESTING` | Force sign-off day for testing | `false` |
| `SUPPORT_EMAIL` | Support contact email shown in UI | `hello@thermio.com.au` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (optional) | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret (optional) | — |

---

## Production Deployment

1. Set `NODE_ENV=production` in your environment
2. Set a strong, random `SESSION_SECRET` (at least 64 characters)
3. Set `BASE_URL` to your public domain (e.g. `https://app.thermio.com.au`)
4. Serve behind a reverse proxy (nginx, Caddy) with HTTPS
5. Ensure `data/` and `uploads/` directories are writable and persistent
6. Use a process manager (pm2, systemd) to keep the server running

```bash
NODE_ENV=production npm start
```

---

## Data Storage

Thermio uses JSON file-based storage in the `data/` directory:

- `data/users.json` — All workspace and system accounts
- `data/workspaces.json` — Workspace configurations
- `data/temp_logs.json` — Temperature log entries
- `data/vehicles.json` — Asset records
- `data/workspace_logs.json` — Audit trail

All data is workspace-scoped. One workspace cannot access another's data.

---

## Branding

Each workspace can upload a custom logo and favicon via **Workspace Settings → Branding**. Files are stored under `uploads/branding/<workspaceId>/` and are isolated per workspace.
