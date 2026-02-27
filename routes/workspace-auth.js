// routes/workspace-auth.js — workspace-scoped login (async PostgreSQL)
'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const WorkspaceRepo = require('../repositories/WorkspaceRepo');
const UserRepo = require('../repositories/UserRepo');
const { regenerateSession } = require('../middleware/auth');

module.exports = function(loginLimiter, passport) {
  const router = express.Router();

  // ── Resolve workspace from slug ────────────────────────────
  async function resolveWorkspace(req, res, next) {
    try {
      const slug = req.params.slug;
      const ws = await WorkspaceRepo.getBySlug(slug);
      if (!ws) {
        // Fix item 7: show inline message instead of 404
        return res.render('login-workspace-picker', {
          error: null,
          workspaceNotFound: true,
          user: null,
          workspace: null
        });
      }
      req.workspace = ws;
      res.locals.workspace = ws;
      next();
    } catch (e) { next(e); }
  }

  // ── GET /w/:slug/login ──────────────────────────────────────
  router.get('/:slug/login', resolveWorkspace, (req, res) => {
    if (!req.workspace) return; // already handled by resolveWorkspace
    if (req.session.user && req.session.user.workspaceId === req.workspace.id) {
      return res.redirect('/app');
    }
    if (req.workspace.status === 'suspended') {
      return res.render('errors/suspended', { workspace: req.workspace, user: null });
    }
    res.render('workspace-login', {
      workspace: req.workspace, error: null, user: null
    });
  });

  // ── POST /w/:slug/login ─────────────────────────────────────
  router.post('/:slug/login', loginLimiter, resolveWorkspace, async (req, res) => {
    if (!req.workspace) return;
    if (req.workspace.status === 'suspended') {
      return res.render('errors/suspended', { workspace: req.workspace, user: null });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.render('workspace-login', {
        workspace: req.workspace, error: 'Username and password are required.', user: null
      });
    }

    try {
      const user = await UserRepo.getByUsername(username, req.workspace.id);
      if (!user || !user.active || user.status === 'suspended' || user.deactivated) {
        return res.render('workspace-login', {
          workspace: req.workspace, error: 'Invalid username or password.', user: null
        });
      }

      if (!user.passwordHash || user.authType === 'google') {
        return res.render('workspace-login', {
          workspace: req.workspace,
          error: 'This account uses Google login. Please use the Sign in with Google button.',
          user: null
        });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.render('workspace-login', {
          workspace: req.workspace, error: 'Invalid username or password.', user: null
        });
      }

      req.session.workspaceId   = req.workspace.id;
      req.session.workspaceSlug = req.workspace.slug;
      req.session.createdAt     = new Date().toISOString();
      // Check if user is deactivated — block login regardless of workspace state
      if (user.deactivated === true || user.active === false) {
        return res.render('workspace-login', {
          workspace: req.workspace, error: 'Your account has been disabled. Please contact your administrator.', user: null
        });
      }

      req.session.user = {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        workspaceId: req.workspace.id,
        mustChangePassword: user.mustChangePassword || false,
        // Persist disabled flags in session so middleware can check without DB round-trip
        deactivated: user.deactivated || false,
        active: user.active !== false,
        isOwner: user.isOwner || false
      };

      if (user.mustChangePassword) {
        return regenerateSession(req, (err) => res.redirect('/change-password'));
      }

      const returnTo = req.session.returnTo;
      const redirectTo = (returnTo && !returnTo.startsWith('/portal')) ? returnTo : '/app';
      delete req.session.returnTo;

      regenerateSession(req, (err) => res.redirect(redirectTo));
    } catch (e) {
      res.render('workspace-login', {
        workspace: req.workspace, error: 'Login error. Please try again.', user: null
      });
    }
  });

  // ── Google OAuth entry ──────────────────────────────────────
  router.get('/:slug/auth/google', resolveWorkspace, (req, res, next) => {
    if (!req.workspace) return;
    req.session.googleWorkspaceSlug = req.params.slug;
    passport.authenticate('google', {
      scope: ['profile', 'email'],
      state: req.params.slug
    })(req, res, next);
  });

  return router;
};
