// routes/app-routes.js — main application routes (workspace-scoped)
'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const QRCode = require('qrcode');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { requireLogin, requireOffice, requireAdmin, requireOwnerOrAdmin, requireWorkspaceAccess } = require('../middleware/auth');
const WorkspaceRepo = require('../repositories/WorkspaceRepo');
const UserRepo = require('../repositories/UserRepo');
const VehicleRepo = require('../repositories/VehicleRepo');
const TempLogRepo = require('../repositories/TempLogRepo');
const ExportRepo = require('../repositories/ExportRepo');
const { getLiveData } = require('./live');
const {
  getPerthDate, getTodayInTz, getMonday, getSignOffDateOfWeek, average,
  extractTemps, getLiveStatus, requiresAdminSignOff,
  buildVehicleDayLabels, buildStaffDayLabels,
  generatePassword, generateUsername, formatPerthTime, formatTimeInTz, minutesAgoPerth,
  evaluateTempRanges, logHasOutOfRange
} = require('../utils/helpers');
const { sendInvitePasswordEmail, sendGoogleInviteEmail } = require('../utils/mailer');
const WorkspaceLogRepo = require('../repositories/WorkspaceLogRepo');
const NotificationRepo = require('../repositories/NotificationRepo');
const VehicleNotesRepo = require('../repositories/VehicleNotesRepo');

// Sign-off helpers — prefer workspace settings, fall back to env
function signoffDay(ws) {
  const s = ws && ws.settings && ws.settings.signoff;
  if (s && s.dayOfWeek != null) return Number(s.dayOfWeek);
  return parseInt(process.env.SIGNOFF_DAY) || 5;
}
function forceSignoff() { return process.env.FORCE_SIGNOFF_DAY_FOR_TESTING === 'true'; }
function getSignOff(dateStr, ws) { return getSignOffDateOfWeek(dateStr, signoffDay(ws)); }
function needsAdminSignOff(log, ws) { return requiresAdminSignOff(log, signoffDay(ws), forceSignoff()); }
// Workspace timezone helper
function wsTz(ws) { return (ws && ws.settings && ws.settings.timezone) || 'Australia/Perth'; }
function wsToday(ws) { return getTodayInTz(wsTz(ws)); }

// Upload config for branding — files stored per-workspace under uploads/branding/<workspaceId>/
const brandingStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const wsId = req.workspace ? req.workspace.id : 'unknown';
    const dir = path.join(__dirname, '..', 'uploads', 'branding', wsId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage: brandingStorage, limits: { fileSize: (parseInt(process.env.UPLOAD_MAX_MB) || 10) * 1024 * 1024 } });

// ── All app routes require login + workspace access ──────────
router.use(requireLogin);
router.use(requireWorkspaceAccess);

// ── Home / Dashboard ─────────────────────────────────────────
router.get('/', async (req, res) => {
  const user = req.session.user;
  const ws = req.workspace;
  const vehicles = await VehicleRepo.getAllByWorkspace(ws.id);
  const allUsers = await UserRepo.getAllByWorkspace(ws.id);

  if (user.role === 'admin' || user.role === 'office') {
    const vehicleCount = vehicles.length;
    const staffCount = allUsers.filter(u => u.role !== 'superadmin').length;
    const today = wsToday(ws);
    const overdueMinutes = (ws.settings && ws.settings.overdueMinutes) || 120;
    const overdueMs = overdueMinutes * 60 * 1000;
    const todayLogs = TempLogRepo.getByWorkspaceAndDate ? await TempLogRepo.getByWorkspaceAndDate(ws.id, today) : await TempLogRepo.getAllByWorkspace(ws.id).filter(l => l.date === today);
    const logsToday = todayLogs.reduce((acc, l) => acc + (l.temps ? l.temps.length : 0), 0);

    let activeVehicles = 0;
    let overdueVehicles = 0;
    let highestTempToday = null;
    let highestTempTruck = null;

    todayLogs.forEach(l => {
      if (!l.shift_done && l.temps && l.temps.length > 0) {
        const last = l.temps[l.temps.length - 1];
        const msSince = Date.now() - new Date(last.time).getTime();
        if (msSince > overdueMs) {
          overdueVehicles++;
        } else {
          activeVehicles++;
          // Create overdue notification if needed
          const since24h = new Date(Date.now() - 24*60*60*1000).toISOString();
          if (!NotificationRepo.hasRecentUnread(ws.id, NotificationRepo.TYPE.OVERDUE_VEHICLE, l.truck_id, since24h)) {
            // Only flag if truly overdue
          }
        }
        // Track highest temp today
        const tv = extractTemps(l.temps);
        tv.forEach(t => {
          if (highestTempToday === null || t > highestTempToday) {
            highestTempToday = t;
            const v = vehicles.find(v => v.id === l.truck_id);
            highestTempTruck = v ? v.rego : null;
          }
        });
      }
    });

    // Generate overdue notifications (fire-and-forget — does not block dashboard render)
    todayLogs.forEach(l => {
      if (!l.shift_done && l.temps && l.temps.length > 0) {
        const last = l.temps[l.temps.length - 1];
        const msSince = Date.now() - new Date(last.time).getTime();
        if (msSince > overdueMs) {
          const since6h = new Date(Date.now() - 6*60*60*1000).toISOString();
          if (!NotificationRepo.hasRecentUnread(ws.id, NotificationRepo.TYPE.OVERDUE_VEHICLE, l.truck_id, since6h)) {
            const v = vehicles.find(v => v.id === l.truck_id);
            NotificationRepo.create({
              workspaceId: ws.id,
              type: NotificationRepo.TYPE.OVERDUE_VEHICLE,
              title: `Overdue: ${v ? v.rego : 'Vehicle'}`,
              body: `No log for ${Math.round(msSince/60000)} minutes`,
              vehicleId: l.truck_id
            }).catch(err => console.error('[notification] create failed:', err.message));
          }
        }
      }
    });

    // ── Extra stats for home-admin dashboard ─────────────────
    // totalLogs: count of all temp readings across workspace today
    const allWorkspaceLogs = await TempLogRepo.getAllByWorkspace(ws.id);
    const totalLogs = allWorkspaceLogs.reduce((acc, l) => acc + (l.temps ? l.temps.length : 0), 0);

    // Average Cabin/Ambient temp today — across entire workspace
    const allTodayTemps = [];
    todayLogs.forEach(l => {
      if (l.temps) l.temps.forEach(t => {
        // Use cabin or ambient (standardised — dispatch removed)
        const v = t.cabin != null ? parseFloat(t.cabin)
                : t.ambient != null ? parseFloat(t.ambient) : NaN;
        if (!isNaN(v)) allTodayTemps.push(v);
      });
    });
    const avgTempToday = allTodayTemps.length > 0
      ? Math.round((allTodayTemps.reduce((a, b) => a + b, 0) / allTodayTemps.length) * 10) / 10
      : null;

    // Exceptions today — based on workspace tempRanges thresholds
    const tempRanges = (ws.settings && ws.settings.tempRanges) || {};
    let totalExceptionsToday = 0;
    todayLogs.forEach(l => {
      if (!l.temps) return;
      l.temps.forEach(t => {
        const zones = ['cabin', 'ambient', 'chiller', 'freezer'];
        zones.forEach(zone => {
          if (t[zone] == null) return;
          const v = parseFloat(t[zone]);
          if (isNaN(v)) return;
          const range = tempRanges[zone] || tempRanges['cabin']; // cabin = ambient zone
          if (!range) return;
          if ((range.min != null && v < range.min) || (range.max != null && v > range.max)) {
            totalExceptionsToday++;
          }
        });
      });
    });

    // Last log time today (most recent temp entry across all today's logs)
    let lastLogTime = null;
    let lastLogMs = 0;
    todayLogs.forEach(l => {
      if (l.temps) l.temps.forEach(t => {
        const ms = t.time ? new Date(t.time).getTime() : 0;
        if (ms > lastLogMs) { lastLogMs = ms; lastLogTime = t.time; }
      });
    });
    if (lastLogTime) lastLogTime = formatTimeInTz(lastLogTime, wsTz(ws));

    return res.render('home-admin', {
      user, workspace: ws, vehicleCount, staffCount,
      activeVehicles, overdueVehicles, logsToday, highestTempToday, highestTempTruck, overdueMinutes,
      totalLogs, avgTempToday, totalExceptionsToday, lastLogTime
    });
  }

  // Driver / staff view
  const logs = await TempLogRepo.getByWorkspaceAndDriver(ws.id, user.id);
  const weeklyGroups = {};
  const dayLabels = buildStaffDayLabels(logs, vehicles);
  const stats = {
    shiftsCompleted: logs.length,
    trucksDriven: new Set(logs.map(l => l.truck_id)).size,
    totalTempChecks: logs.reduce((acc, l) => acc + (l.temps ? l.temps.length : 0), 0)
  };

  logs.forEach(log => {
    const monday = getMonday(log.date);
    if (!weeklyGroups[monday]) weeklyGroups[monday] = [];
    weeklyGroups[monday].push(log);
  });
  Object.values(weeklyGroups).forEach(w => w.sort((a, b) => b.date.localeCompare(a.date)));

  let weekKeys = Object.keys(weeklyGroups).sort((a, b) => new Date(b) - new Date(a));
  if (user.role === 'driver') weekKeys = weekKeys.slice(0, 5);
  const limitedWeeklyGroups = {};
  weekKeys.forEach(k => { limitedWeeklyGroups[k] = weeklyGroups[k]; });

  res.render('home-staff', { user, workspace: ws, staffStats: stats, weeklyGroups: limitedWeeklyGroups, dayLabels, signOffDay: signoffDay(ws) });
});


// ── Misc / More Tools ────────────────────────────────────────
router.get('/misc', requireLogin, requireWorkspaceAccess, (req, res) => {
  res.render('misc', { user: req.session.user, workspace: req.workspace });
});

// ── Staff management ─────────────────────────────────────────
router.get('/staff', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const allUsers = await UserRepo.getAllByWorkspace(ws.id);
  const vehicles = await VehicleRepo.getAllByWorkspace(ws.id);
  const logs = await TempLogRepo.getAllByWorkspace(ws.id);
  const today = wsToday(ws);
  const signOffDate = getSignOff(today, ws);

  const staffWithStats = allUsers
    .filter(u => u.role !== 'superadmin')
    .map(u => {
      const personLogs = logs.filter(l => l.driver_id === u.id);
      const todayLog = personLogs.find(l => l.date === today && !l.shift_done);
      const liveStatus = todayLog ? getLiveStatus(todayLog, allUsers) : null;
      const vehicle = todayLog ? vehicles.find(v => v.id === todayLog.truck_id) : null;
      const live = liveStatus ? { ...liveStatus, vehicleRego: vehicle ? vehicle.rego : 'Unknown' } : null;

      const signOffLog = personLogs.find(l => l.date === signOffDate);
      const requiresSignOff = needsAdminSignOff(signOffLog, ws);
      const temps = personLogs.flatMap(l => l.temps || []);
      const tempValues = extractTemps(temps);

      return {
        ...u,
        isLive: !!live,
        live,
        requiresSignOff,
        stats: {
          totalShifts: personLogs.length,
          totalLogs: temps.length,
          missedChecklists: personLogs.filter(l => !l.checklist_done).length,
          lastActiveDate: personLogs.length ? [...personLogs].sort((a,b) => b.date.localeCompare(a.date))[0].date : null,
          averageTemp: tempValues.length ? Math.round((tempValues.reduce((a,b) => a+b, 0) / tempValues.length) * 10) / 10 : null
        }
      };
    });

  staffWithStats.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return 0;
  });

  res.render('staff', { user: req.session.user, workspace: ws, staff: staffWithStats, staffCount: staffWithStats.length });
});

router.get('/staff/credentials', requireAdmin, (req, res) => {
  const creds = req.session.newUserCredentials || null;
  delete req.session.newUserCredentials;
  res.render('staff-credentials', { user: req.session.user, workspace: req.workspace, creds });
});

router.get('/staff/:id', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const person = await UserRepo.getByIdAndWorkspace(req.params.id, ws.id);
  if (!person) return res.status(404).render('errors/404', { user: req.session.user, workspace: ws });

  const allUsers = await UserRepo.getAllByWorkspace(ws.id);
  const vehicles = await VehicleRepo.getAllByWorkspace(ws.id);
  const personLogs = await TempLogRepo.getByWorkspaceAndDriver(ws.id, person.id);
  const weeklyGroups = {};

  personLogs.forEach(log => {
    const monday = getMonday(log.date);
    if (!weeklyGroups[monday]) weeklyGroups[monday] = [];
    weeklyGroups[monday].push(log);
  });
  Object.values(weeklyGroups).forEach(w => w.sort((a,b) => a.date.localeCompare(b.date)));

  const allTemps = extractTemps(personLogs.flatMap(l => l.temps || []));
  const allTimes = personLogs.flatMap(l => (l.temps||[]).map(t => new Date(t.time)).filter(d => !isNaN(d)));
  const intervals = [];
  for (let i = 1; i < allTimes.length; i++) intervals.push((allTimes[i] - allTimes[i-1]) / 60000);
  const shiftDurations = personLogs.filter(l => l.shift_done && l.temps && l.temps.length > 1)
    .map(l => { const t = l.temps.map(x => new Date(x.time)); return (t[t.length-1] - t[0]) / 60000; });

  // Enhanced performance metrics
  // On-time: shift_done within the day (all shifts that were completed)
  const completedShifts = personLogs.filter(l => l.shift_done);
  const onTimePct = personLogs.length > 0 ? Math.round((completedShifts.length / personLogs.length) * 100) : null;

  // Total exceptions: logs with any out-of-range temp
  const settings = ws.settings || {};
  const tempRanges = settings.tempRanges || {};
  let totalExceptions = 0;
  personLogs.forEach(log => {
    if (logHasOutOfRange(log, tempRanges)) totalExceptions++;
  });

  // Most driven vehicle
  const truckFreq = {};
  personLogs.forEach(l => { truckFreq[l.truck_id] = (truckFreq[l.truck_id] || 0) + 1; });
  let mostDrivenVehicle = null;
  if (Object.keys(truckFreq).length > 0) {
    const topId = Object.entries(truckFreq).sort((a,b) => b[1]-a[1])[0][0];
    const topVehicle = vehicles.find(v => v.id === topId);
    mostDrivenVehicle = topVehicle ? topVehicle.rego : topId;
  }

  // Longest consecutive day logging streak
  const logDates = [...new Set(personLogs.map(l => l.date))].sort();
  let longestStreak = 0, currentStreak = 0;
  for (let i = 0; i < logDates.length; i++) {
    if (i === 0) { currentStreak = 1; }
    else {
      const prev = new Date(logDates[i-1]);
      const curr = new Date(logDates[i]);
      const diff = (curr - prev) / 86400000;
      currentStreak = diff === 1 ? currentStreak + 1 : 1;
    }
    if (currentStreak > longestStreak) longestStreak = currentStreak;
  }

  const staffStats = {
    shiftsCompleted: personLogs.length,
    trucksDriven: [...new Set(personLogs.map(l => l.truck_id))].length,
    totalTempChecks: allTemps.length,
    avgTimeBetweenChecks: intervals.length ? average(intervals) : null,
    avgShiftDuration: shiftDurations.length ? average(shiftDurations) : null,
    highestTemp: allTemps.length ? Math.max(...allTemps) : null,
    lowestTemp: allTemps.length ? Math.min(...allTemps) : null,
    lastShiftDate: personLogs.length ? [...personLogs].sort((a,b) => b.date.localeCompare(a.date))[0].date : null,
    onTimePct,
    totalExceptions,
    mostDrivenVehicle,
    longestStreak
  };

  const dayLabels = buildStaffDayLabels(personLogs, vehicles);

  // For the Ownership Transfer modal: list admins who could receive ownership
  // (only relevant if logged-in user is the owner)
  const sessionUser = req.session.user;
  const sessionUserFull = await UserRepo.getByIdAndWorkspace(sessionUser.id, ws.id);
  const isSessionOwner = sessionUserFull && sessionUserFull.isOwner === true;
  const adminStaff = isSessionOwner
    ? allUsers.filter(u => u.role === 'admin' && !u.isOwner && u.active !== false && !u.deactivated)
    : [];

  res.render('staff-stats', {
    user: req.session.user, workspace: ws, person, staffStats, weeklyGroups, dayLabels,
    totalVehiclesCount: vehicles.length, signOffDay: signoffDay(ws),
    isSessionOwner,
    adminStaff,
    transferError: req.query.transferError || null
  });
});

router.post('/staff/add', requireAdmin, async (req, res) => {
  const ws = req.workspace;
  const { firstName, lastName, role, accountType, email } = req.body;
  const allowedRoles = ['driver', 'office'];
  if (req.session.user.role === 'admin') allowedRoles.push('admin');

  if (!firstName) return res.redirect('/app/staff?error=Name+required');

  const userCount = await UserRepo.countByWorkspace(ws.id);
  if (userCount >= (ws.maxUsers || 20)) {
    return res.redirect('/app/staff?error=User+limit+reached');
  }

  const existingUsernames = await UserRepo.usernamesInWorkspace(ws.id);
  const username = generateUsername(firstName, lastName || '', existingUsernames);
  const name = `${firstName} ${lastName || ''}`.trim();
  const loginUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/w/${ws.slug}/login`;

  if (accountType === 'google') {
    if (!email) return res.redirect('/app/staff?error=Email+required+for+Google+invite');
    await UserRepo.create({
      workspaceId: ws.id, username, name, firstName, lastName: lastName || '',
      email, role: role || 'driver', authType: 'google', status: 'invited',
      mustChangePassword: false, active: true
    });
    await sendGoogleInviteEmail({ to: email, name: firstName, workspaceName: ws.name, loginUrl });
    return res.redirect('/app/staff?created=google');
  }

  // Password user
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);
  // Temporary staff support — expiry at 12:01am in workspace timezone (not server/UTC)
  const { DateTime } = require('luxon');
  const wsTzStr = (ws.settings && ws.settings.timezone) || 'Australia/Perth';
  let isTemporary = req.body.isTemporary === 'on' || req.body.isTemporary === '1';
  let expiryDate = null;
  if (isTemporary && req.body.expiryDate) {
    expiryDate = DateTime.fromISO(req.body.expiryDate, { zone: wsTzStr })
      .set({ hour: 0, minute: 1, second: 0, millisecond: 0 })
      .toJSDate();
  } else if (isTemporary && req.body.expiryPreset && req.body.expiryPreset !== 'custom') {
    const weeks = parseInt(req.body.expiryPreset);
    expiryDate = DateTime.now().setZone(wsTzStr)
      .plus({ weeks })
      .set({ hour: 0, minute: 1, second: 0, millisecond: 0 })
      .toJSDate();
  }

  const newUser = await UserRepo.create({
    workspaceId: ws.id, username, name, firstName, lastName: lastName || '',
    email: email || null, passwordHash, role: role || 'driver',
    authType: 'password', status: 'active', mustChangePassword: true, active: true,
    isTemporary, expiryDate: expiryDate ? expiryDate.toISOString() : null
  });

  if (email) {
    await sendInvitePasswordEmail({ to: email, name: firstName, username, password, workspaceName: ws.name, workspaceSlug: ws.slug, loginUrl });
  }

  // Log event
  await WorkspaceLogRepo.log({
    workspaceId: ws.id,
    userId: req.session.user.id,
    actionType: WorkspaceLogRepo.ACTION.USER_CREATED,
    description: `Staff created: ${name} (${role || 'driver'})`,
    metadata: { username, role: role || 'driver', authType: 'password' }
  });

  // Login details sent to email - no credentials page shown to creator (spec item 11)
  res.redirect('/app/staff?created=1');
});

router.post('/staff/update-role', requireAdmin, async (req, res) => {
  const ws = req.workspace;
  const { staffId, role } = req.body;
  const sessionUser = req.session.user;

  if (staffId === sessionUser.id) return res.status(400).send('Cannot change your own role.');

  const person = await UserRepo.getByIdAndWorkspace(staffId, ws.id);
  if (!person) return res.status(404).send('Not found');

  // Owner role cannot be modified — must use Transfer Ownership
  if (person.isOwner) return res.status(403).send('Cannot change the Workspace Owner\'s role. Use Transfer Ownership.');

  // Role hierarchy: equal roles cannot modify each other
  // Admin cannot demote another Admin — only Owner can
  const ROLE_RANK = { driver: 0, office: 1, admin: 2, owner: 3, superadmin: 99 };
  const actorRank   = ROLE_RANK[sessionUser.role] || 0;
  const targetRank  = ROLE_RANK[person.role]      || 0;
  const newRoleRank = ROLE_RANK[role]              || 0;

  if (actorRank <= targetRank) {
    return res.status(403).send('You cannot modify a user with equal or higher role than your own.');
  }
  // Cannot promote someone to a rank equal to or above your own
  if (newRoleRank >= actorRank) {
    return res.status(403).send('Cannot promote a user to a role equal to or higher than your own.');
  }

  await UserRepo.setRole(staffId, role);
  await WorkspaceLogRepo.log({
    workspaceId: ws.id,
    userId: sessionUser.id,
    actionType: WorkspaceLogRepo.ACTION.SETTINGS_UPDATED,
    description: `Role changed: ${person.name} → ${role}`,
    metadata: { targetUserId: staffId, oldRole: person.role, newRole: role }
  });
  res.redirect('/app/staff?success=role');
});

// ── Transfer Ownership ────────────────────────────────────────
// Only the current Owner can trigger this.
router.post('/staff/transfer-ownership', async (req, res) => {
  const ws = req.workspace;
  const sessionUser = req.session.user;

  // Must be the Owner
  const currentOwner = await UserRepo.getByIdAndWorkspace(sessionUser.id, ws.id);
  if (!currentOwner || !currentOwner.isOwner) {
    return res.status(403).send('Only the Workspace Owner can transfer ownership.');
  }

  const { newOwnerId, confirmPassword } = req.body;
  const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest' || req.headers['accept'] === 'application/json';

  function fail(msg, code) {
    if (isAjax) return res.status(code || 400).json({ error: msg });
    return res.redirect(`/app/staff/${newOwnerId || ''}?transferError=${encodeURIComponent(msg)}`);
  }

  if (!newOwnerId || !confirmPassword) {
    return fail('Missing required fields.', 400);
  }

  // Validate password
  if (!currentOwner.passwordHash) {
    return fail('Your account does not have a password set. Please set a password first.', 403);
  }
  const valid = await bcrypt.compare(confirmPassword, currentOwner.passwordHash);
  if (!valid) {
    return fail('Incorrect Password', 403);
  }

  // New owner must be an Admin in this workspace (not the current owner, not themselves)
  const newOwner = await UserRepo.getByIdAndWorkspace(newOwnerId, ws.id);
  if (!newOwner || newOwner.role !== 'admin' || newOwner.isOwner) {
    return fail('Selected user is not a valid Admin.', 400);
  }

  // Perform transfer: promote newOwner to Owner, demote current owner to Driver
  await UserRepo.setOwner(newOwner.id, true);
  await UserRepo.update(newOwner.id, { isOwner: true });

  await UserRepo.setOwner(currentOwner.id, false);
  await UserRepo.setRole(currentOwner.id, 'driver');

  // Update session to reflect demotion
  req.session.user = {
    ...sessionUser,
    role: 'driver',
    isOwner: false
  };

  console.log(`[OWNERSHIP TRANSFER] Workspace: ${ws.name} (${ws.id})`);
  console.log(`  Previous owner: ${currentOwner.username} (${currentOwner.id}) → demoted to Driver`);
  console.log(`  New owner: ${newOwner.username} (${newOwner.id}) → promoted to Owner`);

  await WorkspaceLogRepo.log({
    workspaceId: ws.id,
    userId: currentOwner.id,
    actionType: 'OWNERSHIP_TRANSFERRED',
    description: `Ownership transferred from ${currentOwner.username} to ${newOwner.username}`,
    metadata: { previousOwner: currentOwner.id, newOwner: newOwner.id }
  });

  if (isAjax) return res.json({ ok: true, redirect: '/app?ownershipTransferred=1' });
  res.redirect('/app?ownershipTransferred=1');
});

router.post('/staff/deactivate/:id', requireAdmin, async (req, res) => {
  const person = await UserRepo.getByIdAndWorkspace(req.params.id, req.workspace.id);
  if (!person) return res.status(404).send('Not found');
  if (person.isOwner) return res.status(403).send('Cannot deactivate the Workspace Owner account.');
  await UserRepo.deactivate(req.params.id);
  res.redirect('/app/staff');
});

router.post('/staff/reactivate/:id', requireAdmin, async (req, res) => {
  const person = await UserRepo.getByIdAndWorkspace(req.params.id, req.workspace.id);
  if (!person) return res.status(404).send('Not found');
  await UserRepo.reactivate(req.params.id);
  res.redirect('/app/staff');
});

router.post('/staff/reset-password/:id', requireAdmin, async (req, res) => {
  const ws = req.workspace;
  const person = await UserRepo.getByIdAndWorkspace(req.params.id, ws.id);
  if (!person) return res.status(404).send('Not found');
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);
  await UserRepo.updatePassword(req.params.id, passwordHash, true);
  req.session.newUserCredentials = { username: person.username, password, name: person.name };
  res.redirect('/app/staff/credentials');
});

// ── Vehicles ──────────────────────────────────────────────────
router.get('/assets', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const vehicles = await VehicleRepo.getAllByWorkspace(ws.id);
  const logs = await TempLogRepo.getAllByWorkspace(ws.id);
  const allUsers = await UserRepo.getAllByWorkspace(ws.id);
  const today = wsToday(ws);

  const vehiclesWithStats = vehicles.map(v => {
    const truckLogs = logs.filter(l => l.truck_id === v.id);
    const requiresSignOff = truckLogs.some(l => needsAdminSignOff(l, ws));
    const todayLog = truckLogs.find(l => l.date === today);
    const live = getLiveStatus(todayLog, allUsers);
    const temps = truckLogs.flatMap(l => l.temps || []);
    const cabinValues = temps.map(t => t.cabin ?? t.dispatch ?? null).filter(x => x !== null && !isNaN(x));

    return {
      ...v,
      isLive: !!live,
      live,
      requiresSignOff,
      stats: {
        totalShifts: truckLogs.length,
        missedChecklists: truckLogs.filter(l => !l.checklist_done).length,
        lastActiveDate: truckLogs.length ? [...truckLogs].sort((a,b) => b.date.localeCompare(a.date))[0].date : null,
        averageTemp: cabinValues.length ? Math.round((cabinValues.reduce((a,b) => a+Number(b),0) / cabinValues.length) * 10) / 10 : null
      }
    };
  });

  vehiclesWithStats.sort((a, b) => {
    if (a.requiresSignOff !== b.requiresSignOff) return a.requiresSignOff ? -1 : 1;
    if (a.deactivated !== b.deactivated) return a.deactivated ? 1 : -1;
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return 0;
  });

  const wsThresholds = (ws.settings && ws.settings.tempRanges) || {};
  res.render('assets', { user: req.session.user, workspace: ws, vehicles: vehiclesWithStats, vehicleCount: vehicles.length, wsThresholds });
});

router.get('/assets/:id', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const truck = await VehicleRepo.getByIdAndWorkspace(req.params.id, ws.id);
  if (!truck) return res.status(404).render('errors/404', { user: req.session.user, workspace: ws });

  const allUsers = await UserRepo.getAllByWorkspace(ws.id);
  const truckLogs = await TempLogRepo.getByWorkspaceAndVehicle(ws.id, truck.id);
  const weeklyGroups = {};

  truckLogs.forEach(log => {
    const monday = getMonday(log.date);
    if (!weeklyGroups[monday]) weeklyGroups[monday] = [];
    weeklyGroups[monday].push(log);
  });
  Object.values(weeklyGroups).forEach(w => w.sort((a,b) => a.date.localeCompare(b.date)));

  const allTemps = extractTemps(truckLogs.flatMap(l => l.temps || []));
  const allTimes = truckLogs.flatMap(l => (l.temps||[]).map(t => new Date(t.time)).filter(d => !isNaN(d)));
  const intervals = [];
  for (let i = 1; i < allTimes.length; i++) intervals.push((allTimes[i] - allTimes[i-1]) / 60000);
  const shiftDurations = truckLogs.filter(l => l.shift_done && l.temps && l.temps.length > 1)
    .map(l => { const t = l.temps.map(x => new Date(x.time)); return (t[t.length-1] - t[0]) / 60000; });

  const vehicleStats = {
    totalShifts: truckLogs.length,
    totalTempChecks: allTemps.length,
    avgTimeBetweenChecks: intervals.length ? average(intervals) : null,
    avgShiftDuration: shiftDurations.length ? average(shiftDurations) : null,
    highestTemp: allTemps.length ? Math.max(...allTemps) : null,
    lowestTemp: allTemps.length ? Math.min(...allTemps) : null
  };

  const driverMap = {};
  truckLogs.forEach(log => {
    const did = log.driver_id || 'unknown';
    if (!driverMap[did]) driverMap[did] = { shifts: 0, temps: [], intervals: [], durations: [] };
    driverMap[did].shifts++;
    const temps = extractTemps(log.temps || []);
    driverMap[did].temps.push(...temps);
    const times = (log.temps || []).map(t => new Date(t.time)).filter(d => !isNaN(d));
    for (let i = 1; i < times.length; i++) driverMap[did].intervals.push((times[i] - times[i-1]) / 60000);
    if (log.shift_done && times.length > 1) driverMap[did].durations.push((times[times.length-1] - times[0]) / 60000);
  });
  const driverStats = Object.entries(driverMap).map(([did, d]) => ({
    driverId: did,
    driverName: (allUsers.find(u => u.id === did) || {}).name || did,
    shifts: d.shifts,
    totalTempChecks: d.temps.length,
    avgTimeBetweenChecks: d.intervals.length ? average(d.intervals) : null,
    avgShiftDuration: d.durations.length ? average(d.durations) : null,
    highestTemp: d.temps.length ? Math.max(...d.temps) : null,
    lowestTemp: d.temps.length ? Math.min(...d.temps) : null
  }));

  const qrUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/app/truck/${truck.id}`;
  const qrImage = await QRCode.toDataURL(qrUrl, { color: { dark: '#ffffff', light: '#1c1f26' }, margin: 2 });
  const dayLabels = buildVehicleDayLabels(truckLogs, allUsers);

  const vehicleNotes = await VehicleNotesRepo.getByVehicle(truck.id, ws.id);

  const wsThresholds = (ws.settings && ws.settings.tempRanges) || {};
  res.render('vehicle-stats', {
    user: req.session.user, workspace: ws, truck, vehicleStats, driverStats, qrImage,
    weeklyGroups, dayLabels, totalVehiclesCount: await VehicleRepo.getAllByWorkspace(ws.id).length,
    getSignOffDateOfWeek: getSignOff, requiresAdminSignOff: needsAdminSignOff,
    vehicleNotes, signOffDay: signoffDay(ws),
    typeUpdated: req.query.typeUpdated || null,
    wsThresholds
  });
});

router.post('/assets/add', requireAdmin, async (req, res) => {
  const ws = req.workspace;
  const vehicleCount = await VehicleRepo.countByWorkspace(ws.id);
  if (vehicleCount >= (ws.maxVehicles || 20)) return res.redirect('/app/assets?error=Vehicle+limit+reached');
  const assetType = req.body.assetType || 'Vehicle';
  const temperatureType = req.body.temperatureType || null;
  const newVehicle = await VehicleRepo.create({
    workspaceId: ws.id,
    rego: req.body.rego,
    vehicleClass: req.body.class || null,
    assetType,
    temperatureType
  });
  await WorkspaceLogRepo.log({
    workspaceId: ws.id,
    userId: req.session.user.id,
    actionType: WorkspaceLogRepo.ACTION.ASSET_CREATED,
    description: `Asset created: ${req.body.rego} (${assetType})`,
    metadata: { vehicleId: newVehicle.id, rego: req.body.rego, assetType, temperatureType }
  });
  res.redirect('/app/assets');
});

// ── Edit Asset Type / Temperature Type ───────────────────────
router.post('/assets/:id/edit-type', requireAdmin, async (req, res) => {
  const ws = req.workspace;
  const v = await VehicleRepo.getByIdAndWorkspace(req.params.id, ws.id);
  if (!v) return res.status(404).send('Asset not found');

  const { assetType, temperatureType } = req.body;
  const allowedAssetTypes = ['Vehicle', 'Fridge', 'Freezer', 'Freezer Room', 'Walk-In Fridge', 'Walk-In Freezer'];
  const allowedTempTypes  = ['chiller', 'freezer', 'cabin'];

  const updates = {};
  if (assetType && allowedAssetTypes.includes(assetType)) updates.assetType = assetType;
  if (temperatureType && allowedTempTypes.includes(temperatureType)) updates.temperatureType = temperatureType;

  if (Object.keys(updates).length === 0) return res.redirect(`/app/assets/${req.params.id}`);

  await VehicleRepo.update(req.params.id, updates);
  await WorkspaceLogRepo.log({
    workspaceId: ws.id,
    userId: req.session.user.id,
    actionType: WorkspaceLogRepo.ACTION.WORKSPACE_UPDATED,
    description: `Asset type updated: ${v.rego}`,
    metadata: { vehicleId: v.id, ...updates }
  });
  res.redirect(`/app/assets/${req.params.id}?typeUpdated=1`);
});

router.post('/assets/deactivate/:id', requireAdmin, async (req, res) => {
  const v = await VehicleRepo.getByIdAndWorkspace(req.params.id, req.workspace.id);
  if (!v) return res.status(404).send('Not found');
  await VehicleRepo.deactivate(req.params.id);
  res.redirect('/app/assets');
});

router.post('/assets/reactivate/:id', requireAdmin, async (req, res) => {
  const v = await VehicleRepo.getByIdAndWorkspace(req.params.id, req.workspace.id);
  if (!v) return res.status(404).send('Not found');
  await VehicleRepo.reactivate(req.params.id);
  res.redirect('/app/assets');
});

// ── Temperature sheet ─────────────────────────────────────────
router.get('/assets/:id/sheet', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const { date } = req.query;
  if (!date) return res.send('Date is required. Example: ?date=2026-02-05');

  const truck = await VehicleRepo.getByIdAndWorkspace(req.params.id, ws.id);
  if (!truck) return res.status(404).send('Truck not found');

  const allUsers = await UserRepo.getAllByWorkspace(ws.id);
  const monday = getMonday(date);
  const signOffDate = getSignOff(monday, ws);

  const weekLogs = await TempLogRepo.getByWorkspaceDateRange(ws.id, monday, signOffDate)
    .filter(l => l.truck_id === truck.id);

  const signOffLog = weekLogs.find(l => l.date === signOffDate);
  if (signOffLog) {
    const driver = allUsers.find(u => u.id === signOffLog.driver_id);
    signOffLog.driverName = driver ? driver.name : '';
  }

  const dayNames = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const dayMap = {};
  weekLogs.forEach(log => {
    const dayName = new Date(log.date + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'long' }).toUpperCase();
    const driver = allUsers.find(u => u.id === log.driver_id);
    dayMap[dayName] = { ...log, driverName: driver ? driver.name : '' };
  });

  // Use workspace checklist questions for column headers
  const checklistQuestions = ws.checklistQuestions || [];

  res.render('vehicle-temp-sheet', {
    truck, monday, dayNames, dayMap,
    signOffLog: signOffLog || null,
    checklistQuestions,
    workspace: ws,
    tempRanges: (ws.settings && ws.settings.tempRanges) || null,
    sheetMeta:  (ws.settings && ws.settings.sheetMeta)  || null,
    timezone: wsTz(ws)
  });
});

// ── Admin sign-off ────────────────────────────────────────────
router.post('/assets/:id/week-note', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const { monday, signature, comments } = req.body;

  const truck = await VehicleRepo.getByIdAndWorkspace(req.params.id, ws.id);
  if (!truck) return res.status(404).send('Not found');

  const targetDateStr = getSignOff(monday, ws);
  const log = await TempLogRepo.getByWorkspaceVehicleDate(ws.id, truck.id, targetDateStr);
  if (!log) return res.status(404).send(`No log found for date: ${targetDateStr}`);

  if (signature) {
    await TempLogRepo.adminSignOff(log.id, ws.id, {
      signature,
      signedBy: req.session.user.name,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null
    });
    await WorkspaceLogRepo.log({
      workspaceId: ws.id,
      userId: req.session.user.id,
      actionType: WorkspaceLogRepo.ACTION.SIGNOFF_COMPLETED,
      description: `Admin sign-off for week of ${monday} (${truck.rego})`,
      metadata: { vehicleId: truck.id, rego: truck.rego, logId: log.id, monday }
    });
  }
  if (comments !== undefined) {
    await TempLogRepo.updateComments(log.id, ws.id, comments.trim());
  }

  res.redirect(`/app/assets/${req.params.id}`);
});

// ── Admin sign-off signature ──────────────────────────────────
router.post('/assets/:id/admin-sign', requireAdmin, async (req, res) => {
  const ws = req.workspace;
  const { monday, signature } = req.body;

  if (!signature || !signature.trim()) {
    return res.redirect(`/app/assets/${req.params.id}?error=signature_required`);
  }

  const truck = await VehicleRepo.getByIdAndWorkspace(req.params.id, ws.id);
  if (!truck) return res.status(404).send('Not found');

  const targetDateStr = getSignOff(monday, ws);
  const log = await TempLogRepo.getByWorkspaceVehicleDate(ws.id, truck.id, targetDateStr);
  if (!log) return res.status(404).send(`No log found for sign-off date: ${targetDateStr}`);

  // Shift must be completed before admin can sign off
  if (!log.shift_done) {
    return res.redirect(`/app/assets/${req.params.id}?error=shift_not_completed`);
  }
  // Prevent duplicate admin sign-off
  if (log.admin_signature) {
    return res.redirect(`/app/assets/${req.params.id}?error=already_signed`);
  }

  await TempLogRepo.adminSignOff(log.id, ws.id, {
    signature: signature.trim(),
    signedBy: req.session.user.name,
    ipAddress: req.ip || null,
    userAgent: req.headers['user-agent'] || null
  });

  await WorkspaceLogRepo.log({
    workspaceId: ws.id,
    userId: req.session.user.id,
    actionType: WorkspaceLogRepo.ACTION.SIGNOFF_COMPLETED,
    description: `Admin sign-off completed for ${truck.rego} (week of ${monday})`,
    metadata: { vehicleId: truck.id, rego: truck.rego, logId: log.id, monday }
  });

  res.redirect(`/app/assets/${req.params.id}?success=signed`);
});

// ── Truck (driver) page ───────────────────────────────────────
router.get('/truck/:id', requireLogin, requireWorkspaceAccess, async (req, res) => {
  const ws = req.workspace;
  const truck = await VehicleRepo.getByIdAndWorkspace(req.params.id, ws.id);

  if (!truck || truck.deactivated) {
    return res.status(404).render('errors/truck-deactivated', { user: req.session.user, workspace: ws });
  }

  const today = wsToday(ws);
  const log = await TempLogRepo.createOrGet(ws.id, truck.id, req.session.user.id, today);

  // Attach checklist questions from workspace settings
  const checklistQuestions = ws.checklistQuestions || [
    'Is the vehicle clean and free from contamination?',
    'Is the refrigeration unit operating correctly?',
    'Are all temperature loggers calibrated and working?',
    'Is the load secured and not exceeding capacity?',
    'Are all seals and door gaskets intact?'
  ];

  const reqSignOff = needsAdminSignOff(log, ws);
  const wsSignoff = (ws.settings && ws.settings.signoff) || {};
  const todayDow = new Date(new Date().toLocaleString('en-AU', { timeZone: wsTz(ws) })).getDay();
  const isSignoffDay = todayDow === signoffDay(ws);
  res.render('truck', {
    user: req.session.user,
    workspace: ws,
    truck,
    log,
    checklistQuestions,
    requiresSignOff: reqSignOff,
    signoffDay: signoffDay(ws),
    isSignoffDay,
    requireOdometer:  isSignoffDay ? (wsSignoff.requireOdometer  !== false) : false,
    requireSignature: isSignoffDay ? (wsSignoff.requireSignature !== false) : false,
    tempRanges: (ws.settings && ws.settings.tempRanges) || null,
    timezone: wsTz(ws)
  });
});

router.post('/truck/:id/checklist', requireLogin, requireWorkspaceAccess, async (req, res) => {
  const ws = req.workspace;
  const truck = await VehicleRepo.getByIdAndWorkspace(req.params.id, ws.id);
  if (!truck) return res.status(404).send('Not found');

  const today = wsToday(ws);
  const log = await TempLogRepo.getByWorkspaceVehicleDate(ws.id, truck.id, today);
  if (!log) return res.redirect(`/app/truck/${req.params.id}`);

  // Prevent re-submission of completed checklist
  if (log.checklist_done) {
    return res.redirect(`/app/truck/${req.params.id}?error=checklist_already_done`);
  }

  // Snapshot question text at time of answering
  const checklistQuestions = ws.checklistQuestions || [];
  const checklistSnapshot = checklistQuestions.map((q, i) => ({
    question: q,
    answer: req.body[`q${i+1}`] || req.body[`q${i}`] || null
  }));

  await TempLogRepo.saveChecklist(log.id, ws.id, req.body, checklistSnapshot);
  res.redirect(`/app/truck/${req.params.id}`);
});

router.post('/truck/:id/temps', requireLogin, requireWorkspaceAccess, async (req, res) => {
  const ws = req.workspace;
  const truck = await VehicleRepo.getByIdAndWorkspace(req.params.id, ws.id);
  if (!truck) return res.status(404).send('Not found');

  const today = wsToday(ws);
  const log = await TempLogRepo.getByWorkspaceVehicleDate(ws.id, truck.id, today);
  if (!log || log.shift_done) return res.send('Shift already ended or not started.');

  if (!log.temps || log.temps.length === 0) {
    await TempLogRepo.addTemp(log.id, ws.id, {
      type: 'start',
      dispatch: req.body.dispatch,
      chiller: req.body.chiller,
      freezer: req.body.freezer
    });
  } else {
    if (!req.body.cabin) return res.send('Cabin temp required');
    await TempLogRepo.addTemp(log.id, ws.id, { type: 'cabin', cabin: req.body.cabin });
  }

  res.redirect(`/app/truck/${req.params.id}`);
});

router.post('/truck/:id/temps/edit/:tempId', requireLogin, requireWorkspaceAccess, async (req, res) => {
  const ws = req.workspace;
  const truck = await VehicleRepo.getByIdAndWorkspace(req.params.id, ws.id);
  if (!truck) return res.status(404).send('Not found');

  const today = wsToday(ws);
  const log = await TempLogRepo.getByWorkspaceVehicleDate(ws.id, truck.id, today);
  if (!log) return res.redirect(`/app/truck/${req.params.id}`);

  await TempLogRepo.editTemp(log.id, ws.id, req.params.tempId, {
    dispatch: req.body.dispatch || null,
    chiller: req.body.chiller || null,
    freezer: req.body.freezer || null,
    cabin: req.body.cabin || null
  });

  res.redirect(`/app/truck/${req.params.id}`);
});

router.post('/truck/:id/end-shift', requireLogin, requireWorkspaceAccess, async (req, res) => {
  const ws = req.workspace;
  const truck = await VehicleRepo.getByIdAndWorkspace(req.params.id, ws.id);
  if (!truck) return res.status(404).send('Not found');

  const today = wsToday(ws);
  const log = await TempLogRepo.getByWorkspaceVehicleDate(ws.id, truck.id, today);
  if (!log) return res.send('No shift found for today.');

  // Prevent duplicate end-shift
  if (log.shift_done) {
    return res.redirect(`/app/truck/${req.params.id}?error=shift_already_ended`);
  }

  // Sign-off day enforcement — odometer and signature mandatory when configured
  const wsSignoff = (ws.settings && ws.settings.signoff) || {};
  const todayDow = new Date(new Date().toLocaleString('en-AU', { timeZone: wsTz(ws) })).getDay();
  const isSignoffDay = todayDow === signoffDay(ws);
  if (isSignoffDay) {
    if (wsSignoff.requireOdometer !== false && !req.body.odometer) {
      return res.redirect(`/app/truck/${req.params.id}?error=odometer_required`);
    }
    if (wsSignoff.requireSignature !== false && !req.body.signature) {
      return res.redirect(`/app/truck/${req.params.id}?error=signature_required`);
    }
  }

  await TempLogRepo.endShift(log.id, ws.id, {
    odometer: req.body.odometer || null,
    signature: req.body.signature || null,
    cabin: req.body.cabin || null
  });

  await WorkspaceLogRepo.log({
    workspaceId: ws.id,
    userId: req.session.user.id,
    actionType: WorkspaceLogRepo.ACTION.SHIFT_ENDED,
    description: `Shift ended for ${truck.rego} on ${today}`,
    metadata: { vehicleId: truck.id, rego: truck.rego, date: today }
  });

  res.redirect(`/app/truck/${req.params.id}`);
});

// ── Scan page ─────────────────────────────────────────────────
router.get('/scan', requireLogin, (req, res) => {
  res.render('scan', { user: req.session.user, workspace: req.workspace });
});

// ── Live page ─────────────────────────────────────────────────
router.get('/live', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const liveData = await getLiveData(ws.id, ws);
  res.render('live', { user: req.session.user, workspace: ws, ...liveData });
});

// ── Workspace settings (admin only or owner) ──────────────────────────
router.get('/settings', requireLogin, (req, res) => {
  const ws = req.workspace;
  res.render('workspace/settings', { user: req.session.user, workspace: ws, error: req.query.error || null, success: req.query.success || null, UserRepo });
});

// Settings route - admin or owner
router.post('/settings/branding', requireOwnerOrAdmin, upload.fields([
  { name: 'favicon', maxCount: 1 },
  { name: 'loginBackground', maxCount: 1 }
]), async (req, res) => {
  const ws = req.workspace;
  const brandingUpdates = {};

  if (req.body.primaryColor) brandingUpdates.primaryColor = req.body.primaryColor;
  if (req.body.accentColor) brandingUpdates.accentColor = req.body.accentColor;
  if (req.body.profileColor) brandingUpdates.profileColor = req.body.profileColor;
  if (req.body.secondaryColor) brandingUpdates.secondaryColor = req.body.secondaryColor;
  if (req.body.theme) brandingUpdates.theme = req.body.theme;

  if (req.files && req.files.favicon) {
    brandingUpdates.favicon = '/uploads/branding/' + ws.id + '/' + req.files.favicon[0].filename;
  }
  if (req.files && req.files.loginBackground) {
    brandingUpdates.loginBackground = '/uploads/branding/' + ws.id + '/' + req.files.loginBackground[0].filename;
  }

  await WorkspaceRepo.updateBranding(ws.id, brandingUpdates);
  res.redirect('/app/settings?success=branding');
});

// Settings route - admin or owner
router.post('/settings/checklist', requireOwnerOrAdmin, async (req, res) => {
  const ws = req.workspace;
  // Support both new dynamic format (questions[]) and legacy format (q1, q2, ...)
  let questions = [];
  if (req.body.questions) {
    const raw = Array.isArray(req.body.questions) ? req.body.questions : [req.body.questions];
    questions = raw.map(q => (q || '').trim()).filter(Boolean);
  } else {
    // Legacy: q1..q10
    for (let i = 1; i <= 20; i++) {
      const q = (req.body[`q${i}`] || '').trim();
      if (q) questions.push(q);
    }
  }
  if (questions.length === 0) return res.redirect('/app/settings?error=questions');

  // HARD LIMIT: 30 questions max (global limit)
  const HARD_LIMIT = 30;
  if (questions.length > HARD_LIMIT) {
    return res.redirect('/app/settings?error=hard_limit_exceeded');
  }

  // Workspace-specific limit
  const workspaceLimit = ws.maxQuestions || 10;
  if (questions.length > workspaceLimit) {
    return res.redirect('/app/settings?error=workspace_limit_exceeded');
  }

  await WorkspaceRepo.updateChecklistQuestions(ws.id, questions);
  await WorkspaceLogRepo.log({
    workspaceId: ws.id,
    userId: req.session.user.id,
    actionType: WorkspaceLogRepo.ACTION.SETTINGS_UPDATED,
    description: `Checklist questions updated (${questions.length} questions)`,
    metadata: {}
  });
  res.redirect('/app/settings?success=checklist');
});

// Settings route - admin or owner
router.post('/settings/compliance', requireOwnerOrAdmin, async (req, res) => {
  const ws = req.workspace;
  const body = req.body;

  const parseNum = (v) => (v !== '' && v != null && !isNaN(Number(v))) ? Number(v) : null;

  const partial = {
    timezone: body.timezone || 'Australia/Perth',
    overdueMinutes: parseInt(body.overdueMinutes) || 120,
    enableWorksheet: body.enableWorksheet === '1',
    maxAssetsPerDay: parseNum(body.maxAssetsPerDay),
    tempRanges: {
      cabin:   { min: parseNum(body.cabin_min),   max: parseNum(body.cabin_max)   },
      ambient: { min: parseNum(body.cabin_min),   max: parseNum(body.cabin_max)   }, // ambient = cabin zone
      chiller: { min: parseNum(body.chiller_min), max: parseNum(body.chiller_max) },
      freezer: { min: parseNum(body.freezer_min), max: parseNum(body.freezer_max) }
    },
    signoff: {
      dayOfWeek:        parseInt(body.signoff_day) || 5,
      requireOdometer:  body.requireOdometer === '1',
      requireSignature: body.requireSignature === '1'
    },
    sheetMeta: {
      companyDisplayName: (body.sheetCompanyName || '').trim(),
      footerText:         (body.sheetFooter      || '').trim(),
      phone:              (body.sheetPhone        || '').trim(),
      email:              (body.sheetEmail        || '').trim(),
      signatureLabel:     (body.sheetSigLabel     || '').trim()
    }
  };

  await WorkspaceRepo.updateSettings(ws.id, partial);
  await WorkspaceLogRepo.log({
    workspaceId: ws.id,
    userId: req.session.user.id,
    actionType: WorkspaceLogRepo.ACTION.SETTINGS_UPDATED,
    description: 'Compliance settings updated',
    metadata: { timezone: partial.timezone, overdueMinutes: partial.overdueMinutes }
  });
  res.redirect('/app/settings?success=compliance');
});

// Settings route - admin or owner
router.post('/settings/export', requireAdmin, (req, res) => {
  const ws = req.workspace;
  const { frequency, scheduleDay, scheduleTime, recipients, includeInactiveVehicles, retentionDays } = req.body;
  const recipientList = (recipients || '').split(',').map(e => e.trim()).filter(Boolean);
  WorkspaceRepo.updateExportSettings(ws.id, {
    frequency: frequency || 'weekly',
    scheduleDay: scheduleDay || 'sunday',
    scheduleTime: scheduleTime || '18:00',
    recipients: recipientList,
    includeInactiveVehicles: includeInactiveVehicles === 'on',
    retentionDays: parseInt(retentionDays) || 365
  });
  res.redirect('/app/settings?success=export');
});

// ── Personal password change ──────────────────────────────────
// Settings route - admin or owner
router.post('/settings/change-password', requireLogin, async (req, res) => {
  const user = req.session.user;
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.redirect('/app/settings?error=missing_fields#personal');
  }
  if (newPassword !== confirmPassword) {
    return res.redirect('/app/settings?error=pw_mismatch#personal');
  }
  if (newPassword.length < 8) {
    return res.redirect('/app/settings?error=pw_too_short#personal');
  }
  // Server-side strength validation
  const hasUpper   = /[A-Z]/.test(newPassword);
  const hasNumber  = /[0-9]/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
  if (!hasUpper || !hasNumber || !hasSpecial) {
    return res.redirect('/app/settings?error=pw_weak#personal');
  }

  const fullUser = UserRepo.getById ? await UserRepo.getById(user.id) : await UserRepo.getByIdAndWorkspace(user.id, req.workspace.id);
  if (!fullUser || !fullUser.passwordHash) {
    return res.redirect('/app/settings?error=no_password_account#personal');
  }

  const match = await bcrypt.compare(currentPassword, fullUser.passwordHash);
  if (!match) {
    return res.redirect('/app/settings?error=wrong_password#personal');
  }

  // Check if password is being reused (current or last 3)
  const isSame = await bcrypt.compare(newPassword, fullUser.passwordHash);
  if (isSame) {
    return res.redirect('/app/settings?error=pw_reuse#personal');
  }
  const isReused = await UserRepo.isPasswordReused(user.id, newPassword);
  if (isReused) {
    return res.redirect('/app/settings?error=pw_reuse#personal');
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await UserRepo.updatePassword(user.id, newHash, false);

  await WorkspaceLogRepo.log({
    workspaceId: req.workspace.id,
    userId: user.id,
    actionType: WorkspaceLogRepo.ACTION.SETTINGS_UPDATED,
    description: `Password changed by ${user.name}`,
    metadata: {}
  });

  // FORCE LOGOUT: Destroy session so user must log in again
  req.session.destroy(() => {
    res.redirect('/login?passwordChanged=1');
  });
});

// ── Exports ───────────────────────────────────────────────────
router.get('/exports', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const exports = await ExportRepo.getAllByWorkspace(ws.id);
  res.render('workspace/exports', { user: req.session.user, workspace: ws, exports });
});

router.post('/exports/generate', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const { periodStart, periodEnd } = req.body;
  if (!periodStart || !periodEnd) return res.redirect('/app/exports?error=dates');

  const { generateExport } = require('../utils/exporter');
  const record = await ExportRepo.create({
    workspaceId: ws.id,
    type: 'manual',
    periodStart,
    periodEnd,
    createdByUserId: req.session.user.id
  });

  try {
    await generateExport(ws, record, periodStart, periodEnd);
    res.redirect('/app/exports?success=1');
  } catch (err) {
    console.error('Export generation error:', err);
    res.redirect('/app/exports?error=generate');
  }
});

router.get('/exports/:id/download', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const record = await ExportRepo.getById(req.params.id, ws.id);
  if (!record || !record.zipPath) return res.status(404).send('Export not found');
  const zipPath = path.join(__dirname, '..', record.zipPath);
  if (!fs.existsSync(zipPath)) return res.status(404).send('ZIP file not found');
  res.download(zipPath);
});

// ── Service Records ────────────────────────────────────────────
router.post('/assets/:id/service/add', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const truck = await VehicleRepo.getByIdAndWorkspace(req.params.id, ws.id);
  if (!truck) return res.status(404).send('Not found');

  const { category, serviceDate, description, dueDate } = req.body;
  if (!category || !serviceDate || !description) {
    return res.redirect(`/app/assets/${req.params.id}?error=service_fields`);
  }

  await VehicleRepo.addServiceRecord(req.params.id, {
    category,
    serviceDate,
    description: description.trim(),
    dueDate: dueDate || null,
    addedBy: req.session.user.name
  });

  await WorkspaceLogRepo.log({
    workspaceId: ws.id,
    userId: req.session.user.id,
    actionType: WorkspaceLogRepo.ACTION.WORKSPACE_UPDATED,
    description: `Service record added for ${truck.rego}: ${category}`,
    metadata: { vehicleId: truck.id, category, serviceDate }
  });

  res.redirect(`/app/assets/${req.params.id}?success=service`);
});

router.post('/assets/:id/service/:recordId/delete', requireAdmin, async (req, res) => {
  const ws = req.workspace;
  const truck = await VehicleRepo.getByIdAndWorkspace(req.params.id, ws.id);
  if (!truck) return res.status(404).send('Not found');

  await VehicleRepo.deleteServiceRecord(req.params.id, req.params.recordId);
  res.redirect(`/app/assets/${req.params.id}?success=service_deleted`);
});

module.exports = router;
