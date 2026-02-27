// routes/features-routes.js — New feature routes
// Logs, Exceptions, Monitor, Notifications, 2FA prep, Backup/Restore, Vehicle Notes
'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const { requireLogin, requireOffice, requireAdmin, requireWorkspaceAccess, requireSuperadmin } = require('../middleware/auth');
const WorkspaceRepo = require('../repositories/WorkspaceRepo');
const UserRepo = require('../repositories/UserRepo');
const VehicleRepo = require('../repositories/VehicleRepo');
const TempLogRepo = require('../repositories/TempLogRepo');
const WorkspaceLogRepo = require('../repositories/WorkspaceLogRepo');
const NotificationRepo = require('../repositories/NotificationRepo');
const VehicleNotesRepo = require('../repositories/VehicleNotesRepo');
const { getLiveData } = require('./live');
const {
  getTodayInTz, getMonday, getSignOffDateOfWeek, extractTemps,
  evaluateTempRanges, logHasOutOfRange, formatTimeInTz
} = require('../utils/helpers');

function wsTz(ws) { return (ws && ws.settings && ws.settings.timezone) || 'Australia/Perth'; }
function wsToday(ws) { return getTodayInTz(wsTz(ws)); }
function signoffDay(ws) {
  const s = ws && ws.settings && ws.settings.signoff;
  if (s && s.dayOfWeek != null) return Number(s.dayOfWeek);
  return parseInt(process.env.SIGNOFF_DAY) || 5;
}
function getSignOff(dateStr, ws) { return getSignOffDateOfWeek(dateStr, signoffDay(ws)); }

// All feature routes require login + workspace context
router.use(requireLogin);
router.use(requireWorkspaceAccess);

// ═══════════════════════════════════════════════════════════════
// FEATURE 3: Workspace Event Console Log
// ═══════════════════════════════════════════════════════════════

router.get('/logs', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const allUsers = await UserRepo.getAllByWorkspace(ws.id);

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  const { entries, total } = await WorkspaceLogRepo.getByWorkspace(ws.id, {
    limit,
    offset,
    actionType: req.query.action || null,
    userId:     req.query.user   || null,
    search:     req.query.search || null,
    dateFrom:   req.query.from   || null,
    dateTo:     req.query.to     || null
  });

  const totalPages = Math.ceil(total / limit);

  res.render('logs', {
    user: req.session.user,
    workspace: ws,
    entries,
    allUsers,
    total,
    page,
    totalPages,
    limit,
    query: req.query,
    actions: Object.values(WorkspaceLogRepo.ACTION)
  });
});

// ═══════════════════════════════════════════════════════════════
// FEATURE 4: Notifications API
// ═══════════════════════════════════════════════════════════════

router.get('/notifications', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const notifications = await NotificationRepo.getAllByWorkspace(ws.id, 50);
  const unreadCount = await NotificationRepo.unreadCount(ws.id);
  res.json({ notifications, unreadCount });
});

router.post('/notifications/mark-read', requireOffice, async (req, res) => {
  const ws = req.workspace;
  await NotificationRepo.markAllRead(ws.id);
  res.json({ ok: true });
});

router.post('/notifications/:id/read', requireOffice, async (req, res) => {
  await NotificationRepo.markRead(req.params.id, req.workspace.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
// FEATURE 6: Exception Report
// ═══════════════════════════════════════════════════════════════

router.get('/exceptions', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const allUsers = await UserRepo.getAllByWorkspace(ws.id);
  const vehicles = await VehicleRepo.getAllByWorkspace(ws.id);
  const today = wsToday(ws);
  const tz = wsTz(ws);
  const tempRanges = (ws.settings && ws.settings.tempRanges) || null;
  const overdueMinutes = (ws.settings && ws.settings.overdueMinutes) || 120;

  // Date filters (default: last 30 days)
  const dateTo = req.query.to || today;
  const dateFrom = req.query.from || (() => {
    const d = new Date(today); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0];
  })();
  const filterVehicle = req.query.vehicle || '';
  const filterDriver  = req.query.driver  || '';

  let logs = await TempLogRepo.getByWorkspaceDateRange(ws.id, dateFrom, dateTo);

  if (filterVehicle) logs = logs.filter(l => l.truck_id === filterVehicle);
  if (filterDriver)  logs = logs.filter(l => l.driver_id === filterDriver);

  const exceptions = [];
  const overdueMs = overdueMinutes * 60 * 1000;

  logs.forEach(log => {
    const vehicle = vehicles.find(v => v.id === log.truck_id);
    const driver  = allUsers.find(u => u.id === log.driver_id);
    const vRego   = vehicle ? vehicle.rego : 'Unknown';
    const dName   = driver  ? driver.name  : 'Unknown';
    const dateLabel = log.date;

    // Out-of-range temps
    if (tempRanges && log.temps && log.temps.length > 0) {
      log.temps.forEach(t => {
        const eval_ = evaluateTempRanges(t, tempRanges);
        ['cabin', 'ambient', 'chiller', 'freezer'].forEach(zone => {
          if (eval_[zone] === 'low' || eval_[zone] === 'high') {
            exceptions.push({
              type: 'out_of_range',
              severity: 'warning',
              date: dateLabel,
              vehicle: vRego,
              vehicleId: log.truck_id,
              driver: dName,
              driverId: log.driver_id,
              description: `${zone.charAt(0).toUpperCase()+zone.slice(1)} temp ${eval_[zone]}: ${t[zone]}°C`,
              time: t.time ? formatTimeInTz(t.time, tz) : '—'
            });
          }
        });
      });
    }

    // Missed checklist
    if (!log.checklist_done) {
      exceptions.push({
        type: 'missed_checklist',
        severity: 'info',
        date: dateLabel,
        vehicle: vRego,
        vehicleId: log.truck_id,
        driver: dName,
        driverId: log.driver_id,
        description: 'Checklist not completed',
        time: '—'
      });
    }

    // Overdue (active log not updated within overdue window)
    if (!log.shift_done && log.temps && log.temps.length > 0) {
      const last = log.temps[log.temps.length - 1];
      const msSince = Date.now() - new Date(last.time).getTime();
      if (msSince > overdueMs && log.date === today) {
        exceptions.push({
          type: 'overdue',
          severity: 'critical',
          date: dateLabel,
          vehicle: vRego,
          vehicleId: log.truck_id,
          driver: dName,
          driverId: log.driver_id,
          description: `No log for ${Math.round(msSince/60000)} min (overdue: >${overdueMinutes} min)`,
          time: formatTimeInTz(last.time, tz)
        });
      }
    }

    // Missed sign-off (sign-off date has passed, shift done, no admin sig)
    const signoffDate = getSignOff(log.date, ws);
    if (log.date === signoffDate && log.shift_done && log.odometer && log.signature && !log.admin_signature) {
      if (signoffDate < today) {
        exceptions.push({
          type: 'missed_signoff',
          severity: 'critical',
          date: dateLabel,
          vehicle: vRego,
          vehicleId: log.truck_id,
          driver: dName,
          driverId: log.driver_id,
          description: 'Admin sign-off not completed',
          time: '—'
        });
      }
    }
  });

  // Sort by severity then date desc
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  exceptions.sort((a, b) => {
    const sd = (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
    if (sd !== 0) return sd;
    return b.date.localeCompare(a.date);
  });

  res.render('exceptions', {
    user: req.session.user,
    workspace: ws,
    exceptions,
    allUsers: allUsers.filter(u => u.role !== 'superadmin'),
    vehicles,
    query: { from: dateFrom, to: dateTo, vehicle: filterVehicle, driver: filterDriver }
  });
});

// ═══════════════════════════════════════════════════════════════
// FEATURE 15: Live Monitor Board
// ═══════════════════════════════════════════════════════════════

router.get('/monitor', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const liveData = getLiveData(ws.id, ws);
  res.render('monitor', {
    user: req.session.user,
    workspace: ws,
    ...liveData
  });
});

// ═══════════════════════════════════════════════════════════════
// FEATURE 12: Vehicle Notes
// ═══════════════════════════════════════════════════════════════

router.post('/assets/:id/notes', requireOffice, async (req, res) => {
  const ws = req.workspace;
  const vehicle = await VehicleRepo.getByIdAndWorkspace(req.params.id, ws.id);
  if (!vehicle) return res.status(404).send('Not found');

  const { type, content } = req.body;
  if (!content || !content.trim()) return res.redirect(`/app/assets/${req.params.id}?error=note_empty`);

  await VehicleNotesRepo.create({
    workspaceId: ws.id,
    vehicleId: vehicle.id,
    userId: req.session.user.id,
    type: type || 'general',
    content: content.trim()
  });

  await WorkspaceLogRepo.log({
    workspaceId: ws.id,
    userId: req.session.user.id,
    actionType: WorkspaceLogRepo.ACTION.WORKSPACE_UPDATED,
    description: `Vehicle note added for ${vehicle.rego}`,
    metadata: { vehicleId: vehicle.id, type }
  });

  res.redirect(`/app/assets/${req.params.id}?success=note`);
});

router.post('/assets/:id/notes/:noteId/delete', requireAdmin, async (req, res) => {
  const ws = req.workspace;
  await VehicleNotesRepo.delete(req.params.noteId, ws.id);
  res.redirect(`/app/assets/${req.params.id}`);
});

// ═══════════════════════════════════════════════════════════════
// FEATURE 2: 2FA Routes (structure ready, NOT enforced)
// ═══════════════════════════════════════════════════════════════

router.get('/enable-2fa', requireLogin, (req, res) => {
  // Placeholder — full implementation when 2FA is enabled
  res.render('two-fa', {
    user: req.session.user,
    workspace: req.workspace,
    message: '2FA is being prepared. This feature will be available soon.',
    qrCode: null
  });
});

router.post('/verify-2fa', requireLogin, (req, res) => {
  // Placeholder
  res.redirect('/app');
});

module.exports = router;
