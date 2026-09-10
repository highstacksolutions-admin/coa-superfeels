'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');

const env = require('./config/env');
const db = require('./config/db');
const log = require('./lib/logger');
const format = require('./lib/format');
const coa = require('./lib/coa');
const site = require('./lib/site');
const assets = require('./lib/assets');
const { csrf } = require('./middleware/csrf');
const { loadAdmin } = require('./middleware/auth');
const { notFound, handler, asyncRoute } = require('./middleware/errors');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(env.root, 'views'));
app.set('trust proxy', env.trustProxy ? 1 : false);
app.set('x-powered-by', false);

// ── HTTPS ───────────────────────────────────────────────────────────────────
// Node sits behind the host's proxy, so the scheme comes from the forwarded
// header. `trust proxy` above is what makes req.secure meaningful.
if (env.forceHttps) {
  app.use((req, res, next) => {
    if (req.secure || req.get('x-forwarded-proto') === 'https') return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(403).send('HTTPS required.');
    return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
  });
}

// ── Security headers ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  // Nonce for the one inline script we allow: the configurable analytics tag.
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

const analyticsScriptSrc = (process.env.ANALYTICS_SCRIPT_SRC || '').split(/\s+/).filter(Boolean);
const analyticsConnectSrc = (process.env.ANALYTICS_CONNECT_SRC || '').split(/\s+/).filter(Boolean);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`, ...analyticsScriptSrc],
      // 'unsafe-inline' here covers style ATTRIBUTES, which a strict style-src
      // blocks outright — that silently drops the bar heights on the analytics
      // chart and every layout nudge in the admin. The narrower style-src-attr
      // is not supported in Safari, so it would leave those broken for a chunk
      // of real users.
      //
      // Scripts stay strict: nonce only, no 'unsafe-inline', no 'unsafe-eval'.
      // That is where the actual risk lives, and it is unaffected by this.
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'"],
      'connect-src': ["'self'", ...analyticsConnectSrc],
      // PDF.js renders the report onto a canvas from data it fetches itself
      // (connect-src 'self'), off the main thread in a web worker it loads from
      // our own origin. blob: is what pdf.js falls back to when it wraps the
      // worker — allowed here, and nowhere else. This is what makes the report
      // render without the browser's native PDF plugin, so a download-manager
      // extension has no application/pdf navigation to hijack.
      'worker-src': ["'self'", 'blob:'],
      // No plugin documents and no framing of any page. The PDF is drawn to a
      // canvas, not embedded, so neither is needed.
      'object-src': ["'none'"],
      'frame-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': env.isProd ? [] : null,
    },
  },
  hsts: env.isProd ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' },
  noSniff: true,
}));

// ── Static ──────────────────────────────────────────────────────────────────
// Only ./public is ever served statically. STORAGE_PATH is outside it, and
// src/config/env.js refuses to boot if that stops being true.
app.use(express.static(env.publicPath, {
  maxAge: env.isProd ? '30d' : 0,
  etag: true,
  index: false,
  dotfiles: 'ignore',
  redirect: false,
}));

// ── Body parsing ────────────────────────────────────────────────────────────
// The only large payloads are multipart, handled by multer, so the limits here
// are small.
//
// `extended: true` is needed for exactly one form: the results editor posts a
// whole certificate of analysis at once as
// `panels[cannabinoids][rows][3][analyte]`, which the simple parser flattens
// into a meaningless key. A lab report runs to eighty analytes across nine
// panels, so the parameter limit is raised well above the 1000 default — at
// seven fields per row the default would silently truncate a long panel, and a
// results form that drops its last few rows without saying so is the worst
// possible failure here.
//
// `depth` is pinned just above what that form needs rather than left at the
// default, so a hand-crafted body cannot make the parser build a deep object.
app.use(express.urlencoded({
  extended: true,
  limit: '512kb',
  parameterLimit: 6000,
  depth: 5,
}));
app.use(express.json({ limit: '512kb' }));

// ── Sessions ────────────────────────────────────────────────────────────────
// MySQL-backed, so a PM2 reload does not sign staff out.
//
// The admin panel gets its own cookie AND its own table. The two identities
// never share a store, so a session picked up on the public side grants nothing
// in the admin.
//
// The public session exists only to carry a CSRF secret for the contact form
// and one flash message; `saveUninitialized: false` means a visitor who only
// looks up a batch never gets a cookie or a database row at all.

function makeStore(table) {
  return new MySQLStore({
    createDatabaseTable: false,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    schema: { tableName: table },
  }, db.pool);
}

const cookieBase = {
  httpOnly: true,
  secure: env.isProd,
  sameSite: 'lax',
  path: '/',
};

const publicSession = session({
  name: 'sf_coa_sid',
  secret: env.sessionSecret,
  store: makeStore('sessions'),
  resave: false,
  saveUninitialized: false,
  cookie: { ...cookieBase, maxAge: 12 * 3600000 },
});

const adminSessionMw = session({
  name: 'sf_coa_admin_sid',
  secret: env.sessionSecret,
  store: makeStore('admin_sessions'),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { ...cookieBase, path: '/admin', maxAge: 12 * 3600000 },
});

// Exactly one session middleware runs per request, chosen by path. Running both
// would leave two express-session response hooks fighting over req.session.
app.use((req, res, next) => {
  if (req.path === '/admin' || req.path.startsWith('/admin/')) return next();
  return publicSession(req, res, next);
});

// `adminSession` has to be a live view of `req.session`, not a copy of the
// reference. session.regenerate() swaps req.session for a brand-new object, so
// a captured reference would leave sign-in writing to the old session while the
// cookie carried the new id — an admin login that appears to succeed and then
// bounces straight back to the login page.
app.use('/admin', adminSessionMw, (req, res, next) => {
  Object.defineProperty(req, 'adminSession', {
    configurable: true,
    get() { return req.session; },
    set(value) { req.session = value; },
  });
  next();
});

// ── Flash messages ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.flash = null;
  if (req.session && req.session.flash) {
    res.locals.flash = req.session.flash;
    delete req.session.flash;
  }
  req.flash = (type, message) => {
    if (req.session) req.session.flash = { type, message };
  };
  next();
});

app.use(csrf);
app.use(loadAdmin);

// ── View globals ────────────────────────────────────────────────────────────
app.use(asyncRoute(async (req, res, next) => {
  res.locals.appUrl = env.appUrl;
  res.locals.currentPath = req.path;
  res.locals.query = req.query;
  res.locals.fmt = format;
  res.locals.coa = coa;
  // Fingerprinted URLs for ./public. See src/lib/assets.js — without this a
  // CSS or JS change does not reach anyone who already has the old file, for
  // as long as the static max-age lasts.
  res.locals.asset = assets.asset;
  res.locals.title = 'Super Feels — Lab results';
  res.locals.description = 'Look up the independent laboratory report for any Super Feels batch.';
  res.locals.bodyClass = '';
  res.locals.adminCss = false;
  res.locals.pageScript = null;
  res.locals.robots = 'index, follow';

  // The header nav and the editable copy on the public pages. Skipped for
  // /admin, which has its own chrome and does not read them.
  if (req.path === '/admin' || req.path.startsWith('/admin/')) {
    res.locals.navPages = [];
    res.locals.settings = {};
  } else {
    const { settings, navPages } = await site.get();
    res.locals.settings = settings;
    res.locals.navPages = navPages;
  }

  // The analytics tag is operator-supplied markup. The CSP allows exactly one
  // inline script per response, identified by nonce, so the nonce is stamped
  // onto whatever they pasted in rather than requiring them to know about it.
  res.locals.analyticsHtml = env.analyticsSnippet
    ? env.analyticsSnippet.replace(/<script(?![^>]*\bnonce=)/gi, `<script nonce="${res.locals.cspNonce}"`)
    : '';

  next();
}));

// ── Routes ──────────────────────────────────────────────────────────────────
app.get('/healthz', async (req, res) => {
  try {
    await db.ping();
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  } catch (err) {
    log.error('healthcheck failed', err);
    res.status(503).json({ ok: false });
  }
});

app.use('/', require('./routes/lookup'));
app.use('/', require('./routes/contact'));
app.use('/download', require('./routes/download'));
app.use('/admin', require('./routes/admin'));
// Content pages are matched on a slug, so this router claims any remaining
// single-segment path and must be mounted last of the public ones.
app.use('/', require('./routes/pages'));

app.use(notFound);
app.use(handler);

module.exports = app;
