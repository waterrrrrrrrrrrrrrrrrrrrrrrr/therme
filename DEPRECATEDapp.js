// ⚠️  DEPRECATED — This file uses in-memory sessions and legacy JSON data patterns.
// Use app.js (formerly app-postgres.js) for all production use.
// This file is retained for historical reference ONLY. Do NOT start with this file.
'use strict';

require('dotenv').config();

const express    = require('express');
const bodyParser = require('body-parser');
const session    = require('express-session');
const path       = require('path');
const fs         = require('fs');
const rateLimit  = require('express-rate-limit');
const passport   = require('passport');
const helmet     = require('helmet');
const csrf       = require('csurf');

const app  = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── Trust proxy (Nginx / Cloudflare) ─────────────────────────
app.set('trust proxy', 1);

// ── Security headers (helmet) ─────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'"],   // EJS inline <script> blocks
      scriptSrcAttr: ["'unsafe-inline'"],             // inline event handlers (onclick, oninput, etc.)
      styleSrc:      ["'self'", "'unsafe-inline'"],   // EJS inline styles
      imgSrc:     ["'self'", 'data:', 'blob:'],
      fontSrc:    ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameSrc:   ["'none'"],
      objectSrc:  ["'none'"],
      baseUri:    ["'self'"],
      formAction: ["'self'"],
    }
  },
  crossOriginEmbedderPolicy: false,  // allow QR code canvas
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// ── Session ──────────────────────────────────────────────────
// NOTE: Cookie name changed from '__Host-sid' to 'thermio_sid'.
// '__Host-' prefix cookies are rejected/stripped by Cloudflare proxies
// in many configurations, causing session loss and CSRF token mismatch errors.
// 'thermio_sid' is still httpOnly + secure in production.
app.use(session({
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

// ── Body parsing ─────────────────────────────────────────────
// MUST come before CSRF middleware so req.body is populated when
// csurf reads the _csrf field from POST body.
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));

// ── Static files ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── View engine ───────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Passport (Google OAuth) ──────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());
const { configurePassport } = require('./routes/auth-google');
configurePassport(passport);

// ── Workspace + user context middleware ──────────────────────
const { attachWorkspace } = require('./middleware/auth');
app.use(attachWorkspace);

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

// ── CSRF protection ──────────────────────────────────────────
// Applied after session AND body-parser. csurf reads tokens from req.body._csrf
// on POST requests, so body-parser must run first.
// GET/HEAD/OPTIONS requests are safe-method — csurf validates no token but still
// attaches req.csrfToken() so forms can render a valid _csrf hidden field.
// Skipped only for API, OAuth callbacks, and multipart restore (multer handles body).
const csrfProtection = csrf({ cookie: false });

function csrfMiddleware(req, res, next) {
  const skip = [
    req.path.startsWith('/api/'),
    req.path.startsWith('/auth/'),
    // /portal/workspaces/:id/restore uses multipart/form-data (multer).
    // csurf cannot read the token from a multipart body, so we skip it here.
    // The restore route is portal-admin-only (session-authenticated), so the
    // CSRF risk is already mitigated by requirePortalAdmin.
    Boolean(req.path.match(/^\/portal\/workspaces\/[^/]+\/restore$/)),
    // Vehicle temp-sheet PDF endpoint — read-only GET, no form submission
    Boolean(req.path.match(/^\/app\/assets\/[^/]+\/sheet$/)),
  ].some(Boolean);

  if (skip) return next();
  csrfProtection(req, res, next);
}

app.use(csrfMiddleware);

// Expose CSRF token to all views via res.locals so every EJS template
// can use <%= csrfToken %> without each route passing it explicitly.
app.use((req, res, next) => {
  try {
    res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  } catch {
    res.locals.csrfToken = '';
  }
  next();
});

// ── Rate limiters ─────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).render('errors/rate-limit', {
    message: 'Too many login attempts. Please try again in 15 minutes.',
    retryAfter: '15 minutes',
    user: null,
    workspace: req.workspace || null
  })
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many password reset attempts. Please try again in 1 hour.'
});

// ── Data directory initialisation ────────────────────────────
const dataDirs = [
  path.join(__dirname, 'data'),
  path.join(__dirname, 'data', 'workspaces'),
  path.join(__dirname, 'uploads', 'branding'),
  path.join(__dirname, 'exports', 'pdfs'),
  path.join(__dirname, 'exports', 'zips')
];
dataDirs.forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

['users.json', 'vehicles_v2.json', 'logs_v2.json', 'exports.json', 'workspace_logs.json', 'notifications.json', 'vehicle_notes.json'].forEach(fname => {
  const f = path.join(__dirname, 'data', fname);
  if (!fs.existsSync(f)) fs.writeFileSync(f, '[]');
});
if (!fs.existsSync(path.join(__dirname, 'data', 'workspaces', 'index.json'))) {
  fs.writeFileSync(path.join(__dirname, 'data', 'workspaces', 'index.json'), '[]');
}

// ── Routes ───────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.render('public/landing', { user: req.session.user || null, workspace: null });
});

// Public pages
app.get('/features', (req, res) => res.render('public/features', { user: null, workspace: null }));
app.get('/pricing',  (req, res) => res.render('public/pricing',  { user: null, workspace: null }));
app.get('/about',    (req, res) => res.render('public/about',    { user: null, workspace: null }));
app.get('/security', (req, res) => res.render('public/security', { user: null, workspace: null }));
app.get('/demo',     (req, res) => res.render('public/demo',     { user: null, workspace: null }));
app.get('/terms',              (req, res) => res.render('public/terms',              { user: null, workspace: null }));
app.get('/privacy',            (req, res) => res.render('public/privacy',            { user: null, workspace: null }));
app.get('/data-responsibility',(req, res) => res.render('public/data-responsibility',{ user: null, workspace: null }));
app.get('/acceptable-use',     (req, res) => res.render('public/acceptable-use',     { user: null, workspace: null }));

// Generic login (workspace picker)
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/app');
  res.render('login-workspace-picker', { error: null, user: null, workspace: null });
});

app.post('/login', loginLimiter, (req, res) => {
  const slug = (req.body.workspace || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!slug) return res.render('login-workspace-picker', {
    error: 'Please enter your workspace name.',
    user: null,
    workspace: null
  });
  res.redirect(`/w/${slug}/login`);
});

// Portal Admin routes
app.use('/portal', require('./routes/portal'));

// Workspace auth routes (login, oauth)
app.use('/w', require('./routes/workspace-auth')(loginLimiter, passport));

// Google OAuth
app.use('/auth', require('./routes/auth-google').router);

// Main app routes (workspace-scoped) — consent required
app.use('/app', (req, res, next) => requireConsent(req, res, next));
app.use('/app', require('./routes/app-routes'));

// Feature routes (event log, notifications, exceptions, monitor, 2FA, vehicle notes)
app.use('/app', require('./routes/features-routes'));

// QR scan page
const { requireLogin } = require('./middleware/auth');
app.get('/scan', requireLogin, (req, res) => {
  res.render('scan', { user: req.session.user, workspace: req.workspace || null });
});

// ── First-login consent ───────────────────────────────────────
function requireConsent(req, res, next) {
  const user = req.session.user;
  if (!user) return next();
  if (user.role === 'superadmin') return next();
  if (user.consentAccepted) return next();
  const UserRepo = require('./repositories/UserRepo');
  if (UserRepo.hasAcceptedConsent(user.id)) {
    req.session.user.consentAccepted = true;
    return next();
  }
  req.session.returnTo = req.originalUrl;
  return res.redirect('/consent');
}

app.get('/consent', requireLogin, (req, res) => {
  if (req.session.user && req.session.user.role === 'superadmin') {
    return res.redirect('/portal');
  }
  res.render('consent', {
    user: req.session.user,
    workspace: req.workspace || null,
    error: null
  });
});

app.post('/consent', requireLogin, (req, res) => {
  const { tos, privacy, data, use, contact } = req.body;
  if (!tos || !privacy || !data || !use || !contact) {
    return res.render('consent', {
      user: req.session.user,
      workspace: req.workspace || null,
      error: 'Please tick all boxes to continue.'
    });
  }
  const UserRepo = require('./repositories/UserRepo');
  UserRepo.acceptConsent(req.session.user.id);
  req.session.user.consentAccepted = true;
  // Always redirect to /app after consent
  delete req.session.returnTo;
  res.redirect('/app');
});

// Change password (forced on first login — mustChangePassword flag)
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

  // Password strength enforcement
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
  if (!hasUpper || !hasNumber || !hasSpecial) {
    return renderErr('Password must contain at least 1 uppercase letter, 1 number, and 1 special character.');
  }

  const fullUser = UserRepo.getById(req.session.user.id);

  // Check current password (not reuse immediately)
  if (fullUser && fullUser.passwordHash) {
    const isSame = await bcrypt.compare(newPassword, fullUser.passwordHash);
    if (isSame) return renderErr('You cannot reuse your current password. Please choose a different password.');
  }

  // Check password history (last 3)
  const isReused = await UserRepo.isPasswordReused(req.session.user.id, newPassword);
  if (isReused) return renderErr('You cannot reuse any of your last 3 passwords. Please choose a different password.');

  const hash = await bcrypt.hash(newPassword, 14);
  UserRepo.updatePassword(req.session.user.id, hash, false);
  req.session.user.mustChangePassword = false;

  // FORCE LOGOUT: Destroy session so user must log in again
  const redirectTo = '/app';
  req.session.destroy(() => {
    res.redirect('/login?passwordChanged=1');
  });
});

// Personal settings shortcut
app.get('/personal-settings', requireLogin, (req, res) => {
  res.redirect('/app/settings#personal');
});

// Link Google
app.get('/profile/link-google', requireLogin, (req, res) => {
  const UserRepo = require('./repositories/UserRepo');
  const user = UserRepo.getById(req.session.user.id);

  // Check if user already has Google linked
  if (user && user.googleId) {
    return res.redirect('/app/settings?error=google_already_linked#personal');
  }

  req.session.linkGoogleUserId     = req.session.user.id;
  req.session.linkGoogleWorkspaceId = req.session.user.workspaceId;
  passport.authenticate('google', { scope: ['profile', 'email'], state: 'link' })(req, res);
});

// Unbind Google
app.post('/profile/unbind-google', requireLogin, (req, res) => {
  const UserRepo = require('./repositories/UserRepo');
  const user = UserRepo.getById(req.session.user.id);

  if (!user || !user.googleId) {
    return res.redirect('/app/settings?error=no_google_linked#personal');
  }

  // User must have a password set before unbinding Google
  if (!user.passwordHash) {
    return res.redirect('/app/settings?error=set_password_first#personal');
  }

  UserRepo.unlinkGoogle(req.session.user.id);
  res.redirect('/app/settings?success=google_unbound#personal');
});

// Live API
app.get('/api/live', requireLogin, (req, res) => {
  const role = req.session.user ? req.session.user.role : null;
  if (role !== 'admin' && role !== 'office') return res.status(403).json({ error: 'Forbidden' });
  const { getLiveData } = require('./routes/live');
  res.json(getLiveData(req.session.workspaceId || req.session.user.workspaceId));
});

// Logout
app.get('/logout', (req, res) => {
  if (req.session.user && req.session.user.portalImpersonation && req.session.portalReturnUser) {
    return res.redirect('/portal/return');
  }
  req.session.destroy(() => res.redirect('/login'));
});

// ── Error pages ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('errors/404', { user: req.session.user || null, workspace: req.workspace || null });
});

app.use((err, req, res, next) => {
  // CSRF token errors — return 403
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('errors/access-denied', {
      user: req.session.user || null,
      workspace: req.workspace || null
    });
  }
  if (!isProd) console.error('Unhandled error:', err);
  res.status(500).render('errors/500', {
    user: req.session.user || null,
    workspace: req.workspace || null,
    message: !isProd ? err.message : 'Something went wrong.'
  });
});

// ── Scheduler ────────────────────────────────────────────────
try { require('./utils/scheduler'); } catch (e) {
  if (!isProd) console.warn('Scheduler not loaded:', e.message);
}

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`${process.env.APP_NAME || 'Thermio'} started | env=${process.env.NODE_ENV || 'development'} | port=${PORT}`);
});

module.exports = app;
