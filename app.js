// app-postgres.js — Thermio — PostgreSQL entry point
// Start this file with PM2: pm2 start app-postgres.js --name thermio
'use strict';

require('dotenv').config();

const express    = require('express');
const bodyParser = require('body-parser');
const session    = require('express-session');
const pgSession  = require('connect-pg-simple')(session);
const path       = require('path');
const fs         = require('fs');
const rateLimit  = require('express-rate-limit');
const passport   = require('passport');
const helmet     = require('helmet');
const csrf       = require('csurf');

// PostgreSQL pool (reads DATABASE_URL from .env)
const pool = require('./database/pool');

const app  = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── Trust proxy — CRITICAL for Cloudflare + Nginx ────────────
// Cloudflare sits in front, then Nginx, then Express.
// 'CF-Connecting-IP' header carries the real client IP.
// Setting trust proxy to 1 makes req.ip read from X-Forwarded-For.
// The Nginx config must pass: proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      fontSrc:    ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameSrc:   ["'none'"],
      objectSrc:  ["'none'"],
      baseUri:    ["'self'"],
      formAction: ["'self'"],
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// ── Session (PostgreSQL store) ────────────────────────────────
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'thermio-dev-secret-change-in-production',
  name: 'thermio_sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProd,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

// ── Body parsing ──────────────────────────────────────────────
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));

// ── Static files ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── View engine ───────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Passport (Google OAuth) ───────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());
const { configurePassport } = require('./routes/auth-google');
configurePassport(passport);

// ── Workspace + user context ──────────────────────────────────
const { attachWorkspace } = require('./middleware/auth');
app.use(async (req, res, next) => {
  try { await attachWorkspace(req, res, next); } catch (e) { next(e); }
});

app.use((req, res, next) => {
  res.locals.currentUser        = req.session.user || null;
  res.locals.workspace          = req.workspace || null;
  res.locals.appName            = process.env.APP_NAME || 'Thermio';
  res.locals.baseUrl            = process.env.BASE_URL || 'http://localhost:3000';
  res.locals.supportEmail       = process.env.SUPPORT_EMAIL || 'hello@loveri.ng';
  res.locals.legalEmail         = process.env.LEGAL_EMAIL   || 'legal@loveri.ng';
  res.locals.privacyEmail       = process.env.PRIVACY_EMAIL || 'privacy@loveri.ng';
  res.locals.portalImpersonation = !!(req.session.user && req.session.user.portalImpersonation);
  next();
});

// ── CSRF protection ───────────────────────────────────────────
const csrfProtection = csrf({
  cookie: false,
  value: (req) => {
    if (!req) return '';
    return (req.body && (req.body._security-token || req.body._csrf)) ||
      (req.query && req.query._csrf) ||
      req.headers['csrf-token'] ||
      req.headers['xsrf-token'] ||
      req.headers['x-csrf-token'] ||
      req.headers['x-xsrf-token'] ||
      '';
  }
});

function csrfMiddleware(req, res, next) {
  const skip = [
    req.path.startsWith('/api/'),
    req.path.startsWith('/auth/'),
    Boolean(req.path.match(/^\/portal\/workspaces\/[^/]+\/restore$/)),
    Boolean(req.path.match(/^\/app\/assets\/[^/]+\/sheet$/)),
  ].some(Boolean);
  if (skip) return next();
  csrfProtection(req, res, next);
}
app.use(csrfMiddleware);

app.use((req, res, next) => {
  try { res.locals.csrfToken = req.csrfToken ? req.csrfToken() : ''; }
  catch { res.locals.csrfToken = ''; }
  next();
});

// ── Rate limiters — separated per path to prevent stacking ────
// Using keyGenerator that reads Cloudflare real IP header first
function getRealIp(req) {
  return req.headers['cf-connecting-ip'] ||
         req.headers['x-real-ip'] ||
         req.ip;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRealIp,
  skip: (req) => req.method === 'GET',  // Only limit POST attempts
  handler: (req, res) => res.status(429).render('errors/rate-limit', {
    message: 'Too many login attempts. Please try again in 15 minutes.',
    retryAfter: '15 minutes',
    user: null,
    workspace: req.workspace || null
  })
});

const portalLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRealIp,
  skip: (req) => req.method === 'GET',
  handler: (req, res) => res.status(429).render('errors/rate-limit', {
    message: 'Too many login attempts. Please try again in 15 minutes.',
    retryAfter: '15 minutes',
    user: null,
    workspace: null
  })
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRealIp
});

// ── Ensure upload/export directories exist ───────────────────
['uploads/branding', 'exports/pdfs', 'exports/zips'].forEach(d => {
  const full = path.join(__dirname, d);
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
});

// ── Routes ────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.render('public/landing', { user: req.session.user || null, workspace: null });
});

// Public pages
app.get('/features', (req, res) => res.render('public/features', { user: null, workspace: null }));
app.get('/pricing',  (req, res) => res.render('public/pricing',  { user: null, workspace: null }));
app.get('/about',    (req, res) => res.render('public/about',    { user: null, workspace: null }));
app.get('/security', (req, res) => res.render('public/security', { user: null, workspace: null }));
app.get('/demo',     (req, res) => res.render('public/demo',     { user: null, workspace: null }));
app.get('/terms',               (req, res) => res.render('public/terms',               { user: null, workspace: null }));
app.get('/privacy',             (req, res) => res.render('public/privacy',             { user: null, workspace: null }));
app.get('/data-responsibility', (req, res) => res.render('public/data-responsibility', { user: null, workspace: null }));
app.get('/acceptable-use',      (req, res) => res.render('public/acceptable-use',      { user: null, workspace: null }));

// Login (workspace picker)
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/app');
  res.render('login-workspace-picker', { error: null, user: null, workspace: null });
});

app.post('/login', loginLimiter, (req, res) => {
  const slug = (req.body.workspace || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!slug) return res.render('login-workspace-picker', {
    error: 'Please enter your workspace name.',
    user: null, workspace: null
  });
  res.redirect(`/w/${slug}/login`);
});

// Portal routes (passes its own rate limiter)
app.use('/portal', require('./routes/portal')(portalLoginLimiter));

// Workspace auth
app.use('/w', require('./routes/workspace-auth')(loginLimiter, passport));

// Google OAuth
app.use('/auth', require('./routes/auth-google').router);

// App routes (consent required)
app.use('/app', (req, res, next) => requireConsent(req, res, next));
app.use('/app', require('./routes/app-routes'));
app.use('/app', require('./routes/features-routes'));

// QR scan
const { requireLogin } = require('./middleware/auth');
app.get('/scan', requireLogin, (req, res) => {
  res.render('scan', { user: req.session.user, workspace: req.workspace || null });
});

// ── Consent ───────────────────────────────────────────────────
async function requireConsent(req, res, next) {
  const user = req.session.user;
  if (!user) return next();
  if (user.role === 'superadmin') return next();
  if (user.consentAccepted) return next();
  const UserRepo = require('./repositories/UserRepo');
  if (await UserRepo.hasAcceptedConsent(user.id)) {
    req.session.user.consentAccepted = true;
    return next();
  }
  req.session.returnTo = req.originalUrl;
  return res.redirect('/consent');
}

app.get('/consent', requireLogin, (req, res) => {
  if (req.session.user && req.session.user.role === 'superadmin') return res.redirect('/portal');
  res.render('consent', { user: req.session.user, workspace: req.workspace || null, error: null });
});

app.post('/consent', requireLogin, async (req, res) => {
  const { tos, privacy, data, use, contact } = req.body;
  if (!tos || !privacy || !data || !use || !contact) {
    return res.render('consent', {
      user: req.session.user, workspace: req.workspace || null,
      error: 'Please tick all boxes to continue.'
    });
  }
  const UserRepo = require('./repositories/UserRepo');
  await UserRepo.acceptConsent(req.session.user.id);
  req.session.user.consentAccepted = true;
  delete req.session.returnTo;
  res.redirect('/app');
});

// ── Change password ───────────────────────────────────────────
app.get('/change-password', requireLogin, (req, res) => {
  res.render('change-password', { error: null, user: req.session.user, workspace: req.workspace || null });
});

app.post('/change-password', requireLogin, passwordResetLimiter, async (req, res) => {
  const bcrypt   = require('bcrypt');
  const UserRepo = require('./repositories/UserRepo');
  const { newPassword, confirmPassword } = req.body;

  const renderErr = (error) => res.render('change-password', {
    error, user: req.session.user, workspace: req.workspace || null
  });

  if (!newPassword || newPassword.length < 8) return renderErr('Password must be at least 8 characters.');
  if (newPassword !== confirmPassword)         return renderErr('Passwords do not match.');

  if (!/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
    return renderErr('Password must contain at least 1 uppercase letter, 1 number, and 1 special character.');
  }

  const fullUser = await UserRepo.getById(req.session.user.id);
  if (fullUser && fullUser.passwordHash) {
    const isSame = await bcrypt.compare(newPassword, fullUser.passwordHash);
    if (isSame) return renderErr('You cannot reuse your current password.');
  }

  if (await UserRepo.isPasswordReused(req.session.user.id, newPassword)) {
    return renderErr('You cannot reuse any of your last 3 passwords.');
  }

  const hash = await bcrypt.hash(newPassword, 14);
  await UserRepo.updatePassword(req.session.user.id, hash, false);
  req.session.destroy(() => res.redirect('/login?passwordChanged=1'));
});

// Personal settings shortcut
app.get('/personal-settings', requireLogin, (req, res) => {
  res.redirect('/app/settings#personal');
});

// Google link
app.get('/profile/link-google', requireLogin, async (req, res) => {
  const UserRepo = require('./repositories/UserRepo');
  const user = await UserRepo.getById(req.session.user.id);
  if (user && user.googleId) return res.redirect('/app/settings?error=google_already_linked#personal');
  req.session.linkGoogleUserId     = req.session.user.id;
  req.session.linkGoogleWorkspaceId = req.session.user.workspaceId;
  passport.authenticate('google', { scope: ['profile', 'email'], state: 'link' })(req, res);
});

// Google unbind
app.post('/profile/unbind-google', requireLogin, async (req, res) => {
  const UserRepo = require('./repositories/UserRepo');
  const user = await UserRepo.getById(req.session.user.id);
  if (!user || !user.googleId) return res.redirect('/app/settings?error=no_google_linked#personal');
  if (!user.passwordHash) return res.redirect('/app/settings?error=set_password_first#personal');
  await UserRepo.unlinkGoogle(req.session.user.id);
  res.redirect('/app/settings?success=google_unbound#personal');
});

// Live API
app.get('/api/live', requireLogin, (req, res) => {
  const role = req.session.user ? req.session.user.role : null;
  if (role !== 'admin' && role !== 'office') return res.status(403).json({ error: 'Forbidden' });
  const { getLiveData } = require('./routes/live');
  getLiveData(req.session.workspaceId || req.session.user.workspaceId)
    .then(data => res.json(data))
    .catch(() => res.json({ assets: [] }));
});

// Logout
app.get('/logout', (req, res) => {
  if (req.session.user && req.session.user.portalImpersonation && req.session.portalReturnUser) {
    return res.redirect('/portal/return');
  }
  req.session.destroy(() => res.redirect('/login'));
});

// ── Error handlers ────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('errors/404', { user: req.session.user || null, workspace: req.workspace || null });
});

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('errors/access-denied', {
      user: req.session.user || null, workspace: req.workspace || null
    });
  }
  if (!isProd) console.error('Unhandled error:', err);
  res.status(500).render('errors/500', {
    user: req.session.user || null,
    workspace: req.workspace || null,
    message: !isProd ? err.message : 'Something went wrong.'
  });
});

// ── Scheduler ─────────────────────────────────────────────────
try { require('./utils/scheduler'); } catch (e) {
  if (!isProd) console.warn('Scheduler not loaded:', e.message);
}

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`${process.env.APP_NAME || 'Thermio'} | env=${process.env.NODE_ENV || 'development'} | port=${PORT}`);
});

module.exports = app;
