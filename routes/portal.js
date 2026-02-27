// routes/portal.js — Portal Admin dashboard (formerly /superadmin)
'use strict';
const express = require('express');
module.exports = function(loginLimiter) {
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');

const { requirePortalAdmin } = require('../middleware/auth');
const WorkspaceRepo = require('../repositories/WorkspaceRepo');
const UserRepo = require('../repositories/UserRepo');
const VehicleRepo = require('../repositories/VehicleRepo');
const TempLogRepo = require('../repositories/TempLogRepo');
const ExportRepo = require('../repositories/ExportRepo');
const WorkspaceLogRepo = require('../repositories/WorkspaceLogRepo');
const { slugify, generatePassword, generateUsername } = require('../utils/helpers');
const { sendInvitePasswordEmail, sendGoogleInviteEmail } = require('../utils/mailer');

const restoreUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });



// ── Superadmin Login ─────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.user && req.session.user.role === 'superadmin') return res.redirect('/portal');
  res.render('portal/login', { error: null, user: null, workspace: null });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render('portal/login', { error: 'Username and password required.', user: null, workspace: null });
  }

  const user = await UserRepo.getSuperadmin();
  if (!user || !user.passwordHash || user.username !== username) {
    return res.render('portal/login', { error: 'Invalid credentials.', user: null, workspace: null });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.render('portal/login', { error: 'Invalid credentials.', user: null, workspace: null });
  }

  req.session.createdAt = new Date().toISOString(); // Track session creation time
  req.session.user = {
    id: user.id,
    name: user.name,
    username: user.username,
    role: 'superadmin',
    workspaceId: null,
    mustChangePassword: user.mustChangePassword || false
  };

  res.redirect('/portal');
});

// ── Dashboard ────────────────────────────────────────────────
router.get('/', requirePortalAdmin, async (req, res, next) => {
  try {
    const workspaces = await WorkspaceRepo.getAll();

    const wsData = await Promise.all(
      workspaces.map(async (ws) => {
        const userCount = await UserRepo.countByWorkspace(ws.id);
        const vehicleCount = await VehicleRepo.countByWorkspace(ws.id);
        const logCount = await TempLogRepo.countByWorkspace(ws.id);
        const lastActivity = await TempLogRepo.getLastActivity(ws.id);

        return { ...ws, userCount, vehicleCount, logCount, lastActivity };
      })
    );

    res.render('portal/dashboard', {
      user: req.session.user,
      workspace: null,
      workspaces: wsData
    });

  } catch (err) {
    next(err);
  }
});


// ── Platform Stats ───────────────────────────────────────────
router.get('/stats', requirePortalAdmin, async (req, res, next) => {
  try {
    const workspaces = await WorkspaceRepo.getAll();
    const todayStr = new Date().toISOString().split('T')[0];

    const wsData = await Promise.all(workspaces.map(async (ws) => {
      const logCount     = await TempLogRepo.countByWorkspace(ws.id) || 0;
      const userCount    = await UserRepo.countByWorkspace(ws.id) || 0;
      const vehicleCount = await VehicleRepo.countByWorkspace(ws.id) || 0;
      const logsToday    = TempLogRepo.countByWorkspaceAndDate
        ? (await TempLogRepo.countByWorkspaceAndDate(ws.id, todayStr) || 0)
        : 0;
      return { name: ws.name, logCount, userCount, vehicleCount, logsToday };
    }));

    const totalLogs       = wsData.reduce((sum, w) => sum + (w.logCount || 0), 0);
    const totalWorkspaces = workspaces.length;
    const totalUsers      = wsData.reduce((sum, w) => sum + (w.userCount || 0), 0);
    const logsToday       = wsData.reduce((sum, w) => sum + (w.logsToday || 0), 0);

    res.render('portal/stats', {
      user: req.session.user,
      workspace: null,
      stats: {
        totalLogs,
        totalWorkspaces,
        totalUsers,
        logsToday,
        workspaces: wsData
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── Create Workspace ─────────────────────────────────────────
router.get('/workspaces/new', requirePortalAdmin, async (req, res) => {
  res.render('portal/workspace-new', {
    user: req.session.user,
    workspace: null,
    error: null
  });
});

router.post('/workspaces/new', requirePortalAdmin, async (req, res) => {
  const { name, maxUsers, maxVehicles, adminInviteMethod, adminEmail, adminFirstName, adminLastName } = req.body;
  if (!name) {
    return res.render('portal/workspace-new', {
      user: req.session.user, workspace: null,
      error: 'Workspace name is required.'
    });
  }

  const slug = slugify(name);
  if (!await WorkspaceRepo.slugAvailable(slug)) {
    return res.render('portal/workspace-new', {
      user: req.session.user, workspace: null,
      error: `Slug "${slug}" is already taken. Choose a different name.`
    });
  }

  const { maxQuestions } = req.body;
  const ws = await WorkspaceRepo.create({
    name,
    slug,
    maxUsers: parseInt(maxUsers) || 20,
    maxVehicles: parseInt(maxVehicles) || 20,
    maxQuestions: parseInt(maxQuestions) || 5,
    adminInviteMethod: adminInviteMethod || 'password',
    adminEmail: adminEmail || null,
    adminName: (adminFirstName || '') + ' ' + (adminLastName || '')
  });

  const loginUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/w/${ws.slug}/login`;
  const existingUsernames = await UserRepo.usernamesInWorkspace(ws.id);

  // The first admin created for the workspace is designated as the Workspace Owner (isOwner: true).
  // No separate hidden account is created. The owner is the person whose name was entered.
  if (adminInviteMethod === 'google' && adminEmail) {
    const username = generateUsername(adminFirstName || 'Admin', adminLastName || '', existingUsernames);
    const ownerUser = await UserRepo.create({
      workspaceId: ws.id,
      username,
      name: `${adminFirstName || ''} ${adminLastName || ''}`.trim() || 'Admin',
      firstName: adminFirstName || '',
      lastName: adminLastName || '',
      email: adminEmail,
      role: 'admin',
      authType: 'google',
      status: 'invited',
      mustChangePassword: false,
      isOwner: true,
      active: true
    });
    await sendGoogleInviteEmail({ to: adminEmail, name: adminFirstName || 'Admin', workspaceName: ws.name, loginUrl });
    console.log(`[OWNER CREATED] Workspace: ${ws.name} (${ws.id}) | Username: ${username} | User ID: ${ownerUser.id}`);
  } else {
    // Password invite — this user becomes the Owner
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 14);
    const firstName = adminFirstName || 'Admin';
    const lastName = adminLastName || '';
    const username = generateUsername(firstName, lastName, existingUsernames);
    const ownerUser = await UserRepo.create({
      workspaceId: ws.id,
      username,
      name: `${firstName} ${lastName}`.trim(),
      firstName,
      lastName,
      email: adminEmail || null,
      passwordHash,
      role: 'admin',
      authType: 'password',
      status: 'active',
      mustChangePassword: true,
      isOwner: true,
      active: true
    });
    console.log(`[OWNER CREATED] Workspace: ${ws.name} (${ws.id}) | Username: ${username} | User ID: ${ownerUser.id}`);
    if (adminEmail) {
      await sendInvitePasswordEmail({
        to: adminEmail, name: firstName, username, password,
        workspaceName: ws.name, workspaceSlug: ws.slug, loginUrl
      });
    }
    req.session.newAdminCredentials = { username, password, loginUrl };
  }

  res.redirect(`/portal/workspaces/${ws.id}?created=1`);
});

// ── Workspace detail ─────────────────────────────────────────
router.get('/workspaces/:id', requirePortalAdmin, async (req, res) => {
  const ws = await WorkspaceRepo.getById(req.params.id);
  if (!ws) return res.status(404).render('errors/404', { user: req.session.user, workspace: null });

  const userCount = await UserRepo.countByWorkspace(ws.id);
  const vehicleCount = await VehicleRepo.countByWorkspace(ws.id);
  const logCount = await TempLogRepo.countByWorkspace(ws.id);
  const lastActivity = await TempLogRepo.getLastActivity(ws.id);
  const newCreds = req.session.newAdminCredentials || null;
  delete req.session.newAdminCredentials;

  const owner = await UserRepo.getOwnerByWorkspace(ws.id);
  const ownerResetCreds = req.session.ownerResetCredentials || null;
  delete req.session.ownerResetCredentials;

  res.render('portal/workspace-detail', {
    user: req.session.user,
    workspace: null,
    ws: { ...ws, userCount, vehicleCount, logCount, lastActivity },
    newCreds,
    created: req.query.created || null,
    limitsError: null,
    owner: owner ? { id: owner.id, username: owner.username, name: owner.name } : null,
    ownerResetCreds,
    ownerResetError: req.query.ownerResetError || null,
    ownerReset: req.query.ownerReset || null
  });
});

// ── Suspend / Activate ───────────────────────────────────────
router.post('/workspaces/:id/suspend', requirePortalAdmin, async (req, res) => {
  await WorkspaceRepo.suspend(req.params.id);
  res.redirect(`/portal/workspaces/${req.params.id}`);
});

router.post('/workspaces/:id/activate', requirePortalAdmin, async (req, res) => {
  await WorkspaceRepo.activate(req.params.id);
  res.redirect(`/portal/workspaces/${req.params.id}`);
});

// ── Edit Limits ──────────────────────────────────────────────
router.post('/workspaces/:id/limits', requirePortalAdmin, async (req, res) => {
  const ws = await WorkspaceRepo.getById(req.params.id);
  if (!ws) return res.status(404).send('Not found');

  const { maxUsers, maxVehicles, maxQuestions } = req.body;
  const newMaxUsers = parseInt(maxUsers) || 20;
  const newMaxVehicles = parseInt(maxVehicles) || 20;
  const newMaxQuestions = Math.min(Math.max(parseInt(maxQuestions) || 5, 1), 10);

  // Validate: don't lower below current usage
  const userCount = await UserRepo.countByWorkspace(ws.id);
  const vehicleCount = await VehicleRepo.countByWorkspace(ws.id);

  if (newMaxUsers < userCount) {
    const limitsError = `Cannot lower Max Users to ${newMaxUsers} — workspace currently has ${userCount} users.`;
    const _owner = await UserRepo.getOwnerByWorkspace(ws.id);
    return res.render('portal/workspace-detail', {
      user: req.session.user, workspace: null,
      ws: { ...ws, userCount, vehicleCount, logCount: await TempLogRepo.countByWorkspace(ws.id), lastActivity: await TempLogRepo.getLastActivity(ws.id) },
      newCreds: null, created: null, limitsError,
      owner: _owner ? { id: _owner.id, username: _owner.username, name: _owner.name } : null,
      ownerResetCreds: null, ownerResetError: null, ownerReset: null
    });
  }
  if (newMaxVehicles < vehicleCount) {
    const limitsError = `Cannot lower Max Assets to ${newMaxVehicles} — workspace currently has ${vehicleCount} vehicles.`;
    const _owner = await UserRepo.getOwnerByWorkspace(ws.id);
    return res.render('portal/workspace-detail', {
      user: req.session.user, workspace: null,
      ws: { ...ws, userCount, vehicleCount, logCount: await TempLogRepo.countByWorkspace(ws.id), lastActivity: await TempLogRepo.getLastActivity(ws.id) },
      newCreds: null, created: null, limitsError,
      owner: _owner ? { id: _owner.id, username: _owner.username, name: _owner.name } : null,
      ownerResetCreds: null, ownerResetError: null, ownerReset: null
    });
  }

  await WorkspaceRepo.update(req.params.id, { maxUsers: newMaxUsers, maxVehicles: newMaxVehicles, maxQuestions: newMaxQuestions });

  await WorkspaceLogRepo.log({
    workspaceId: ws.id,
    userId: req.session.user.id,
    actionType: WorkspaceLogRepo.ACTION.LIMITS_UPDATED,
    description: `Limits updated by superadmin: users=${newMaxUsers}, vehicles=${newMaxVehicles}, questions=${newMaxQuestions}`,
    metadata: { maxUsers: newMaxUsers, maxVehicles: newMaxVehicles, maxQuestions: newMaxQuestions }
  });

  res.redirect(`/portal/workspaces/${req.params.id}`);
});

// ── Backup Export ────────────────────────────────────────────
router.get('/workspaces/:id/backup', requirePortalAdmin, async (req, res) => {
  const ws = await WorkspaceRepo.getById(req.params.id);
  if (!ws) return res.status(404).send('Not found');

  const users    = await UserRepo.getAllByWorkspace(ws.id);
  const vehicles = await VehicleRepo.getAllByWorkspace(ws.id);
  const logs     = await TempLogRepo.getAllByWorkspace(ws.id);

  const backup = {
    exportedAt: new Date().toISOString(),
    exportedBy: req.session.user.username,
    workspace: ws,
    users,
    vehicles,
    logs
  };

  await WorkspaceLogRepo.log({
    workspaceId: ws.id,
    userId: req.session.user.id,
    actionType: WorkspaceLogRepo.ACTION.BACKUP_EXPORTED,
    description: `Full workspace backup exported by superadmin`,
    metadata: { users: users.length, vehicles: vehicles.length, logs: logs.length }
  });

  const filename = `backup-${ws.slug}-${new Date().toISOString().slice(0,10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(backup, null, 2));
});

// ── Backup Restore ───────────────────────────────────────────
router.post('/workspaces/:id/restore', requirePortalAdmin, restoreUpload.single('backupFile'), async (req, res) => {
  const ws = await WorkspaceRepo.getById(req.params.id);
  if (!ws) return res.status(404).send('Not found');
  if (!req.file) return res.redirect(`/portal/workspaces/${req.params.id}?restoreError=No+file+uploaded`);

  let backup;
  try {
    backup = JSON.parse(req.file.buffer.toString('utf8'));
  } catch (e) {
    return res.redirect(`/portal/workspaces/${req.params.id}?restoreError=Invalid+JSON+file`);
  }

  // Validate: must have workspace + users + vehicles + logs
  if (!backup.workspace || !Array.isArray(backup.users) || !Array.isArray(backup.vehicles) || !Array.isArray(backup.logs)) {
    return res.redirect(`/portal/workspaces/${req.params.id}?restoreError=Invalid+backup+format`);
  }

  // Validate: workspace ID must match
  if (backup.workspace.id !== ws.id) {
    return res.redirect(`/portal/workspaces/${req.params.id}?restoreError=Backup+workspace+ID+does+not+match`);
  }

  // Restore via PostgreSQL repositories (replaces legacy JSON file approach)
  // This is a soft restore: users/vehicles/logs are re-imported if they don't exist
  // WARNING: this is destructive for the target workspace — data is replaced
  try {
    for (const u of backup.users) {
      const existing = await UserRepo.getByIdAndWorkspace(u.id, ws.id).catch(() => null);
      if (!existing) {
        await UserRepo.create({ ...u, workspaceId: ws.id });
      }
    }
    for (const v of backup.vehicles) {
      const existing = await VehicleRepo.getByIdAndWorkspace(v.id, ws.id).catch(() => null);
      if (!existing) {
        await VehicleRepo.create({ ...v, workspaceId: ws.id });
      }
    }
    // Log import — TempLogs are not bulk-restored to avoid compliance integrity issues
    // Portal operators should use direct DB tools for full log restoration
  } catch (restoreErr) {
    console.error('[RESTORE ERROR]', restoreErr);
    return res.redirect(`/portal/workspaces/${req.params.id}?restoreError=${encodeURIComponent('Restore failed: ' + restoreErr.message)}`);
  }

  // Restore workspace config
  await WorkspaceRepo.update(ws.id, {
    name: backup.workspace.name,
    slug: backup.workspace.slug,
    branding: backup.workspace.branding,
    checklistQuestions: backup.workspace.checklistQuestions,
    settings: backup.workspace.settings,
    exportSettings: backup.workspace.exportSettings,
    maxUsers: backup.workspace.maxUsers,
    maxVehicles: backup.workspace.maxVehicles,
    maxQuestions: backup.workspace.maxQuestions
  });

  await WorkspaceLogRepo.log({
    workspaceId: ws.id,
    userId: req.session.user.id,
    actionType: WorkspaceLogRepo.ACTION.BACKUP_RESTORED,
    description: `Workspace restored from backup (exported: ${backup.exportedAt})`,
    metadata: { exportedAt: backup.exportedAt, exportedBy: backup.exportedBy }
  });

  res.redirect(`/portal/workspaces/${req.params.id}?restored=1`);
});

// ── Superadmin logout ────────────────────────────────────────
// ── Billing Placeholder ──────────────────────────────────────
router.get('/billing', requirePortalAdmin, async (req, res) => {
  res.render('portal/billing', {
    user: req.session.user,
    workspace: null,
    appName: process.env.APP_NAME || 'Thermio'
  });
});

// ── Portal Impersonation — Open Workspace as Admin ───────────
router.get('/workspaces/:id/open', requirePortalAdmin, async (req, res) => {
  const ws = await WorkspaceRepo.getById(req.params.id);
  if (!ws) return res.status(404).send('Workspace not found');
  if (ws.status === 'suspended') return res.status(403).send('Workspace is suspended');
  // Save portal session for restoration
  req.session.portalReturnUser = {
    id: req.session.user.id, name: req.session.user.name,
    username: req.session.user.username, role: 'superadmin', workspaceId: null
  };
  // Impersonate as admin — does NOT create a real user or modify data
  req.session.createdAt = new Date().toISOString(); // Track session creation time
  req.session.user = {
    id: req.session.user.id,
    name: 'Portal Admin', username: req.session.user.username,
    role: 'admin', workspaceId: ws.id,
    mustChangePassword: false, portalImpersonation: true
  };
  req.session.workspaceId   = ws.id;
  req.session.workspaceSlug = ws.slug;
  res.redirect('/app');
});

// ── Login as Owner ────────────────────────────────────────────
router.get('/workspaces/:id/login-as-owner', requirePortalAdmin, async (req, res) => {
  const ws = await WorkspaceRepo.getById(req.params.id);
  if (!ws) return res.status(404).send('Workspace not found');
  if (ws.status === 'suspended') return res.status(403).send('Workspace is suspended');

  const owner = await UserRepo.getOwnerByWorkspace(ws.id);
  if (!owner) return res.status(404).send('No Owner account found for this workspace.');

  // Save portal session for restoration
  req.session.portalReturnUser = {
    id: req.session.user.id, name: req.session.user.name,
    username: req.session.user.username, role: 'superadmin', workspaceId: null
  };
  // Impersonate as the actual owner user — full owner session
  req.session.createdAt = new Date().toISOString(); // Track session creation time
  req.session.user = {
    id: owner.id,
    name: owner.name,
    username: owner.username,
    role: 'admin',
    workspaceId: ws.id,
    isOwner: true,
    mustChangePassword: false,
    portalImpersonation: true
  };
  req.session.workspaceId   = ws.id;
  req.session.workspaceSlug = ws.slug;

  console.log(`[PORTAL] Login as Owner: workspace=${ws.name} (${ws.id}), owner=${owner.username}, by=${req.session.portalReturnUser.username}`);
  res.redirect('/app');
});

// ── Reset Owner Password ──────────────────────────────────────
router.post('/workspaces/:id/reset-owner-password', requirePortalAdmin, async (req, res) => {
  const ws = await WorkspaceRepo.getById(req.params.id);
  if (!ws) return res.status(404).send('Workspace not found');

  const owner = await UserRepo.getOwnerByWorkspace(ws.id);
  if (!owner) {
    return res.redirect(`/portal/workspaces/${req.params.id}?ownerResetError=No+Owner+account+found`);
  }

  const tempPassword = generatePassword(16);
  const passwordHash = await bcrypt.hash(tempPassword, 14);
  await UserRepo.updatePassword(owner.id, passwordHash, true); // mustChangePassword = true

  // Log simulated email to console (no real email sent)
  console.log(`[OWNER PASSWORD RESET] Workspace: ${ws.name} (${ws.id})`);
  console.log(`[SIMULATED EMAIL] -----------------------------------------------`);
  console.log(`  To: <owner of ${ws.name}>`);
  console.log(`  Subject: Your Workspace Owner password has been reset`);
  console.log(`  Body:`);
  console.log(`    Your temporary password is: ${tempPassword}`);
  console.log(`    Username: ${owner.username}`);
  console.log(`    Login URL: ${process.env.BASE_URL || 'http://localhost:3000'}/w/${ws.slug}/login`);
  console.log(`    You will be required to change your password on first login.`);
  console.log(`[SIMULATED EMAIL] -----------------------------------------------`);
  console.log(`[PORTAL] Password reset by: ${req.session.user.username}`);

  // Store temp password in session for one-time display
  req.session.ownerResetCredentials = {
    username: owner.username,
    tempPassword,
    loginUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/w/${ws.slug}/login`
  };

  res.redirect(`/portal/workspaces/${req.params.id}?ownerReset=1`);
});

// ── Return to Portal ─────────────────────────────────────────
router.get('/return', (req, res) => {
  if (!req.session.portalReturnUser) return res.redirect('/portal/login');
  req.session.user = req.session.portalReturnUser;
  req.session.workspaceId   = null;
  req.session.workspaceSlug = null;
  delete req.session.portalReturnUser;
  res.redirect('/portal');
});

// ── Data Retention Settings ───────────────────────────────────
router.post('/workspaces/:id/retention', requirePortalAdmin, async (req, res) => {
  const ws = await WorkspaceRepo.getById(req.params.id);
  if (!ws) return res.status(404).send('Not found');
  const retentionEnabled = req.body.retentionEnabled === '1';
  const retentionDays    = Math.max(30, parseInt(req.body.retentionDays) || 365);
  await WorkspaceRepo.updateSettings(ws.id, { retentionEnabled, retentionDays });
  res.redirect('/portal/workspaces/' + req.params.id + '?saved=1');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/portal/login'));
});

return router;
};