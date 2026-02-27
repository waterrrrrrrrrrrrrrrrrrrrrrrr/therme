// middleware/auth.js — async authentication & authorisation middleware
'use strict';

const WorkspaceRepo = require('../repositories/WorkspaceRepo');

async function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    const slug = req.session.workspaceSlug;
    return res.redirect(slug ? `/w/${slug}/login` : '/login');
  }

  // Session invalidation on password change
  const UserRepo = require('../repositories/UserRepo');
  try {
    const user = await UserRepo.getById(req.session.user.id);
    if (user && user.passwordChangedAt) {
      const sessionCreatedAt = req.session.createdAt || new Date(0).toISOString();
      if (new Date(user.passwordChangedAt) > new Date(sessionCreatedAt)) {
        const slug = req.session.workspaceSlug;
        return req.session.destroy(() => {
          res.redirect(slug ? `/w/${slug}/login?sessionExpired=1` : '/login?sessionExpired=1');
        });
      }
    }
  } catch (e) { /* continue if DB unavailable */ }

  if (req.session.user.mustChangePassword) {
    if (!['/change-password', '/logout'].includes(req.path)) return res.redirect('/change-password');
  }
  next();
}

function requireLoginSync(req, res, next) {
  // Sync wrapper for places that can't use async yet
  requireLogin(req, res, next).catch(next);
}

function requireOffice(req, res, next) {
  requireLogin(req, res, () => {
    const role = req.session.user.role;
    if (role !== 'admin' && role !== 'office' && role !== 'superadmin') return renderAccessDenied(res);
    next();
  }).catch(next);
}

function requireAdmin(req, res, next) {
  requireLogin(req, res, () => {
    const role = req.session.user.role;
    if (role !== 'admin' && role !== 'superadmin') return renderAccessDenied(res);
    next();
  }).catch(next);
}

function requireOwnerOrAdmin(req, res, next) {
  requireLogin(req, res, async () => {
    const UserRepo = require('../repositories/UserRepo');
    const role = req.session.user.role;
    if (role === 'superadmin') return next();
    try {
      const user = await UserRepo.getById(req.session.user.id);
      if (role === 'admin' || (user && user.isOwner === true)) return next();
    } catch (e) {}
    return renderAccessDenied(res);
  }).catch(next);
}

function requirePortalAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'superadmin') {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/portal/login');
  }
  next();
}

const requireSuperadmin = requirePortalAdmin;

async function attachWorkspace(req, res, next) {
  if (req.session.workspaceId) {
    try {
      const ws = await WorkspaceRepo.getById(req.session.workspaceId);
      if (ws) {
        req.workspace = ws;
        res.locals.workspace = ws;
      }
    } catch (e) { /* continue */ }
  }
  next();
}

function requireWorkspaceAccess(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    const slug = req.session.workspaceSlug;
    return res.redirect(slug ? `/w/${slug}/login` : '/login');
  }
  if (!req.workspace) {
    req.session.returnTo = req.originalUrl;
    const slug = req.session.workspaceSlug;
    return res.redirect(slug ? `/w/${slug}/login` : '/login');
  }
  if (req.session.user.role === 'superadmin') return next();
  if (req.session.user.workspaceId !== req.workspace.id) return renderAccessDenied(res);

  // Disabled state persistence: user-level flag is INDEPENDENT of workspace status.
  // Workspace being re-enabled must NOT re-enable individually disabled users.
  const sessionUser = req.session.user;
  if (sessionUser.deactivated === true || sessionUser.active === false) {
    return res.status(403).render('errors/suspended', {
      workspace: req.workspace,
      user: sessionUser,
      reason: 'account_disabled'
    });
  }

  // Workspace-level suspension check (separate from user-level)
  if (req.workspace.status === 'suspended') {
    return res.status(403).render('errors/suspended', {
      workspace: req.workspace, user: req.session.user || null
    });
  }
  next();
}

function renderAccessDenied(res) {
  return res.status(403).render('errors/access-denied', {
    user: res.locals.currentUser || null,
    workspace: res.locals.workspace || null
  });
}

function require2FAIfEnabled(req, res, next) { next(); } // 2FA removed

function regenerateSession(req, callback) {
  const data = req.session;
  req.session.regenerate((err) => {
    if (err) return callback(err);
    Object.assign(req.session, data);
    req.session.save(callback);
  });
}

module.exports = {
  requireLogin,
  requireOffice,
  requireAdmin,
  requireOwnerOrAdmin,
  requireSuperadmin,
  requirePortalAdmin,
  attachWorkspace,
  requireWorkspaceAccess,
  require2FAIfEnabled,
  regenerateSession
};
