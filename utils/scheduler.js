// utils/scheduler.js — per-workspace timezone scheduler (uses Luxon)
'use strict';

let cron;
try { cron = require('node-cron'); }
catch (e) {
  if (process.env.NODE_ENV !== 'production') console.warn('node-cron not available, scheduler disabled.');
  module.exports = {};
  return;
}

let DateTime;
try { ({ DateTime } = require('luxon')); }
catch (e) {
  if (process.env.NODE_ENV !== 'production') console.warn('luxon not available, scheduler disabled.');
  module.exports = {};
  return;
}

const fs   = require('fs');
const path = require('path');
const WorkspaceRepo = require('../repositories/WorkspaceRepo');
const ExportRepo    = require('../repositories/ExportRepo');
const { generateExport } = require('./exporter');

const DATA_DIR = path.join(__dirname, '..', 'data');

const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

// Get timezone from workspace settings — no global fallback constant allowed
function getWorkspaceTz(ws) {
  return (ws.settings && ws.settings.timezone) ? ws.settings.timezone : 'Australia/Perth';
}

// Get current hour in workspace timezone using Luxon — never raw JS Date
function getLocalHour(tz) {
  try { return DateTime.now().setZone(tz).hour; }
  catch (e) { return -1; }
}

// Get today's date string (YYYY-MM-DD) in workspace timezone using Luxon
function getTodayInTz(tz) {
  try { return DateTime.now().setZone(tz).toISODate(); }
  catch (e) { return DateTime.now().toISODate(); }
}

// Get the Monday of the week containing dateStr (Luxon weeks start Monday)
function getMondayOf(dateStr) {
  return DateTime.fromISO(dateStr, { zone: 'UTC' }).startOf('week').toISODate();
}

// Convert Luxon weekday (1=Mon…7=Sun) to JS day-of-week (0=Sun…6=Sat)
function luxonToJsDow(luxonDow) {
  return luxonDow === 7 ? 0 : luxonDow;
}

// ── Export Scheduler — runs every hour at :00 ─────────────────
// Triggers export at midnight (hour 0) local workspace time on the configured schedule day.
cron.schedule('0 * * * *', async () => {
  const workspaces = WorkspaceRepo.getAll();
  for (const ws of workspaces) {
    if (ws.status !== 'active') continue;
    const settings = ws.exportSettings || (ws.settings && ws.settings.export);
    if (!settings || !settings.frequency) continue;

    try {
      const tz = getWorkspaceTz(ws);
      if (getLocalHour(tz) !== 0) continue;

      const today = getTodayInTz(tz);
      const todayDt = DateTime.fromISO(today, { zone: tz });
      const jsDow = luxonToJsDow(todayDt.weekday);

      const scheduledDayNum = DAY_MAP[settings.scheduleDay] !== undefined
        ? DAY_MAP[settings.scheduleDay] : 0;
      if (jsDow !== scheduledDayNum) continue;

      const monday = getMondayOf(today);
      const mondayDt = DateTime.fromISO(monday, { zone: tz });

      let periodStart, periodEnd;
      if (settings.frequency === 'weekly') {
        periodStart = mondayDt.minus({ days: 7 }).toISODate();
        periodEnd   = mondayDt.minus({ days: 1 }).toISODate();
      } else if (settings.frequency === 'fortnightly') {
        periodStart = mondayDt.minus({ days: 14 }).toISODate();
        periodEnd   = mondayDt.minus({ days: 1 }).toISODate();
      } else if (settings.frequency === 'monthly') {
        periodStart = todayDt.startOf('month').minus({ months: 1 }).toISODate();
        periodEnd   = todayDt.startOf('month').minus({ days: 1 }).toISODate();
      } else { continue; }

      const record = ExportRepo.create({
        workspaceId: ws.id, type: settings.frequency,
        periodStart, periodEnd, createdByUserId: 'scheduler'
      });
      await generateExport(ws, record, periodStart, periodEnd);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[Scheduler] Export failed for "${ws.name}":`, err.message);
      }
    }
  }
});

// ── Data Retention — runs every hour at :05 ───────────────────
// Purges logs at 02:00 in each workspace's own timezone. No global retention.
cron.schedule('5 * * * *', () => {
  const workspaces = WorkspaceRepo.getAll();
  const logsFile = path.join(DATA_DIR, 'logs_v2.json');
  if (!fs.existsSync(logsFile)) return;

  let allLogs = [];
  try { allLogs = JSON.parse(fs.readFileSync(logsFile, 'utf8')); }
  catch (e) { return; }

  let totalRemoved = 0;

  const kept = allLogs.filter(log => {
    const ws = workspaces.find(w => w.id === log.workspaceId);
    if (!ws) return true;

    if (!(ws.settings && ws.settings.retentionEnabled)) return true;

    const tz = getWorkspaceTz(ws);
    if (getLocalHour(tz) !== 2) return true;

    const retentionDays = parseInt((ws.settings && ws.settings.retentionDays) || 365);
    if (!log.date) return true;

    const logDt = DateTime.fromISO(log.date, { zone: tz }).startOf('day');
    const cutoff = DateTime.now().setZone(tz).startOf('day').minus({ days: retentionDays });
    const keep = logDt >= cutoff;
    if (!keep) totalRemoved++;
    return keep;
  });

  if (totalRemoved > 0) {
    fs.writeFileSync(logsFile, JSON.stringify(kept, null, 2));
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Retention] Purged ${totalRemoved} logs past retention period.`);
    }
  }
});

module.exports = {};


// ── Temporary Staff & Asset Expiry Check ──────────────────────
// Runs hourly to check for expired temporary users and assets
const { checkTemporaryExpiry } = (() => {
  async function checkTemporaryExpiry() {
    try {
      const UserRepo = require('../repositories/UserRepo');
      const VehicleRepo = require('../repositories/VehicleRepo');
      const WorkspaceLogRepo = require('../repositories/WorkspaceLogRepo');
      const { sendMail } = require('./mailer');
      const now = new Date();

      // Check expired temporary users
      const pool = require('../database/pool');
      const expiredUsers = await pool.query(
        `SELECT u.*, w.name as workspace_name, w.slug as workspace_slug
         FROM users u JOIN workspaces w ON u.workspace_id = w.id
         WHERE u.is_temporary = true AND u.active = true
           AND u.expiry_date IS NOT NULL AND u.expiry_date <= $1`,
        [now.toISOString()]
      );
      for (const user of expiredUsers.rows) {
        await UserRepo.deactivate(user.id);
        await WorkspaceLogRepo.log({
          workspaceId: user.workspace_id,
          actionType: WorkspaceLogRepo.ACTION.USER_SUSPENDED,
          description: `Temporary user expired: ${user.name} (${user.username})`,
          metadata: { reason: 'temporary_expiry', expiryDate: user.expiry_date }
        });
        console.log(`[EXPIRY] User suspended: ${user.username} in ${user.workspace_name}`);
        // Send expiry notification email if email exists
        if (user.email) {
          try {
            await sendMail({
              to: user.email,
              subject: `Your access to ${user.workspace_name} has expired`,
              text: `Hi ${user.name},\n\nYour temporary access to ${user.workspace_name} has expired.\n\nIf you believe this is an error, please contact your administrator.\n\n— ${process.env.APP_NAME || 'Thermio'}`,
              html: `<p>Hi ${user.name},</p><p>Your temporary access to <strong>${user.workspace_name}</strong> has expired.</p><p>If you believe this is an error, please contact your administrator.</p>`
            });
          } catch (e) {}
        }
      }

      // Check expired temporary vehicles/assets
      const expiredVehicles = await pool.query(
        `SELECT v.*, w.name as workspace_name FROM vehicles v JOIN workspaces w ON v.workspace_id = w.id
         WHERE v.is_temporary = true AND v.deactivated = false
           AND v.expiry_date IS NOT NULL AND v.expiry_date <= $1`,
        [now.toISOString()]
      );
      for (const vehicle of expiredVehicles.rows) {
        await VehicleRepo.deactivate(vehicle.id);
        await WorkspaceLogRepo.log({
          workspaceId: vehicle.workspace_id,
          actionType: WorkspaceLogRepo.ACTION.ASSET_SUSPENDED,
          description: `Temporary asset expired: ${vehicle.rego}`,
          metadata: { reason: 'temporary_expiry', expiryDate: vehicle.expiry_date }
        });
        console.log(`[EXPIRY] Asset suspended: ${vehicle.rego} in ${vehicle.workspace_name}`);
      }
    } catch (e) {
      console.error('[EXPIRY CHECK]', e.message);
    }
  }
  return { checkTemporaryExpiry };
})();

// Run expiry check every hour
setInterval(checkTemporaryExpiry, 60 * 60 * 1000);
// Also run on startup after 30 seconds
setTimeout(checkTemporaryExpiry, 30 * 1000);
