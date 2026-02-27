// routes/auth-google.js — Google OAuth strategy + callback
const express = require('express');
const router = express.Router();
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const WorkspaceRepo = require('../repositories/WorkspaceRepo');
const UserRepo = require('../repositories/UserRepo');

function configurePassport(passport) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'GOOGLE_CLIENT_ID_NOT_SET',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'GOOGLE_CLIENT_SECRET_NOT_SET',
    callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`,
    passReqToCallback: true
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
      const googleId = profile.id;
      const state = req.query.state || req.session.googleWorkspaceSlug;
      const isLink = state === 'link';

      // ── LINKING mode (existing user linking their Google account) ──
      if (isLink && req.session.linkGoogleUserId) {
        const userId = req.session.linkGoogleUserId;
        const workspaceId = req.session.linkGoogleWorkspaceId;
        const user = await UserRepo.getById(userId);
        if (!user) return done(null, false, { message: 'User not found.' });
        if (user.workspaceId !== workspaceId) return done(null, false, { message: 'Workspace mismatch.' });

        // Prevent linking if user already has a Google account linked
        if (user.googleId) {
          return done(null, false, { message: 'You already have a Google account linked. Unbind it first to link a different account.' });
        }

        // Check email belongs to this workspace
        if (email) {
          const byEmail = await UserRepo.getByEmail(email, workspaceId);
          if (byEmail && byEmail.id !== userId) {
            return done(null, false, { message: 'This Google account is already linked to another user in this workspace.' });
          }
        }
        await UserRepo.linkGoogle(userId, googleId, email);
        delete req.session.linkGoogleUserId;
        delete req.session.linkGoogleWorkspaceId;
        return done(null, { ...user, googleId, linked: true });
      }

      // ── WORKSPACE LOGIN mode ──
      const slug = state || req.session.googleWorkspaceSlug;
      if (!slug) return done(null, false, { message: 'No workspace context for Google login.' });

      const ws = WorkspaceRepo.getBySlug(slug);
      if (!ws) return done(null, false, { message: 'Workspace not found.' });
      if (ws.status === 'suspended') return done(null, false, { message: 'Workspace is suspended.' });

      // Find user by Google ID first, then by email
      let user = await UserRepo.getByGoogleId(googleId, ws.id);
      if (!user && email) {
        user = await UserRepo.getByEmail(email, ws.id);
      }

      if (!user) {
        return done(null, false, { message: `No account found for ${email} in this workspace. Contact your administrator.` });
      }

      if (!user.active || user.status === 'suspended') {
        return done(null, false, { message: 'Your account is inactive. Contact your administrator.' });
      }

      // If first Google login (status=invited), attach googleId and activate
      if (!user.googleId || user.status === 'invited') {
        await UserRepo.linkGoogle(user.id, googleId);
        UserRepo.update(user.id, { status: 'active' });
        user = await UserRepo.getById(user.id);
      }

      return done(null, { ...user, workspaceId: ws.id, workspaceSlug: ws.slug });
    } catch (err) {
      return done(err);
    }
  }));

  passport.serializeUser((user, done) => done(null, { id: user.id, workspaceId: user.workspaceId }));
passport.serializeUser((user, done) => {
  done(null, { id: user.id, workspaceId: user.workspaceId });
});

passport.deserializeUser(async (data, done) => {
  try {
    if (!data || !data.id) {
      return done(null, false);
    }

    const user = await UserRepo.getById(data.id);

    if (!user) {
      return done(null, false);
    }

    done(null, user);
  } catch (err) {
    done(err);
  }
});
}

// Callback route
router.get('/google/callback',
  (req, res, next) => {
    const slug = req.query.state || req.session.googleWorkspaceSlug;
    req.session.googleWorkspaceSlug = slug;
    next();
  },
  (req, res, next) => {
    require('passport').authenticate('google', { failureRedirect: '/login', session: false }, async (err, user, info) => {
      if (err) return next(err);
      const slug = req.session.googleWorkspaceSlug;
      const ws = slug ? WorkspaceRepo.getBySlug(slug) : null;

      if (!user) {
        const message = info && info.message ? info.message : 'Google login failed.';
        if (ws) {
          return res.render('workspace-login', { workspace: ws, error: message, user: null });
        }
        return res.render('login-workspace-picker', { error: message, user: null, workspace: null });
      }

      // Handle link mode
      if (user.linked) {
        return res.redirect('/app?linked=google');
      }

      const workspace = ws || await WorkspaceRepo.getById(user.workspaceId);
      req.session.workspaceId = workspace ? workspace.id : null;
      req.session.workspaceSlug = workspace ? workspace.slug : null;
      req.session.createdAt = new Date().toISOString(); // Track session creation time
      req.session.user = {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        workspaceId: workspace ? workspace.id : null,
        mustChangePassword: false,  // Google users never need to change password
        consentAccepted: user.consentAccepted || false,
        isOwner: user.isOwner || false
      };

      // Always redirect to /app after Google login
      delete req.session.returnTo;
      res.redirect('/app');
    })(req, res, next);
  }
);

module.exports = { configurePassport, router };
