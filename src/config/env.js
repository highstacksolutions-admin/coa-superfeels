'use strict';

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const ROOT = path.join(__dirname, '..', '..');

function str(key, fallback) {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}
function int(key, fallback) {
  const v = parseInt(process.env[key], 10);
  return Number.isFinite(v) ? v : fallback;
}
function bool(key, fallback) {
  const v = str(key);
  if (v === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}
// Storage paths may be relative in dev and absolute on the host. Resolve both
// against the project root so a relative value never depends on the cwd PM2
// happens to start the process in.
function resolvePath(key, fallback) {
  return path.resolve(ROOT, str(key, fallback));
}

const env = {
  root: ROOT,
  nodeEnv: str('NODE_ENV', 'development'),
  get isProd() { return this.nodeEnv === 'production'; },
  port: int('PORT', 3000),
  appUrl: str('APP_URL', 'http://localhost:3000').replace(/\/+$/, ''),
  trustProxy: bool('TRUST_PROXY', false),
  forceHttps: bool('FORCE_HTTPS', false),

  db: {
    host: str('DB_HOST', 'localhost'),
    port: int('DB_PORT', 3306),
    database: str('DB_NAME', 'superfeels_coa'),
    user: str('DB_USER', 'root'),
    password: str('DB_PASSWORD', ''),
    connectionLimit: int('DB_CONNECTION_LIMIT', 10),
  },

  sessionSecret: str('SESSION_SECRET', ''),

  // Lab reports are streamed through the app, never served statically, so that
  // an unpublished batch cannot be reached by guessing a URL and so that every
  // download is counted. See the boot check below.
  storagePath: resolvePath('STORAGE_PATH', './storage/coa'),
  // Product photography is public by nature and is served straight from
  // ./public, so it lives in its own directory inside the web root.
  uploadsPath: resolvePath('UPLOADS_PATH', './public/uploads'),
  publicPath: path.join(ROOT, 'public'),
  maxUploadSize: int('MAX_UPLOAD_SIZE', 33554432),

  smtp: {
    host: str('SMTP_HOST', ''),
    port: int('SMTP_PORT', 465),
    secure: bool('SMTP_SECURE', true),
    user: str('SMTP_USER', ''),
    password: str('SMTP_PASSWORD', ''),
    from: str('MAIL_FROM', 'Super Feels <mail@coa.superfeels.com>'),
    replyTo: str('MAIL_REPLY_TO', ''),
    throttlePerMin: int('MAIL_THROTTLE_PER_MIN', 20),
  },

  // Where a customer enquiry from the contact form is sent. Falls back to the
  // From address so the form is never a black hole.
  contactRecipient: str('CONTACT_RECIPIENT', ''),

  analyticsSnippet: str('ANALYTICS_SNIPPET', ''),
};

if (!env.contactRecipient) {
  env.contactRecipient = (env.smtp.from.match(/<([^>]+)>/) || [, env.smtp.from])[1].trim();
}

// Fail fast on anything that would otherwise fail quietly at 3am.
const fatal = [];
if (!env.sessionSecret) fatal.push('SESSION_SECRET is required.');
if (env.isProd && env.sessionSecret.length < 32) {
  fatal.push('SESSION_SECRET must be at least 32 characters in production.');
}
// Checked against process.env, not env.db.user: the latter defaults to 'root'
// for local convenience, so it is never empty and a check on it would never
// fire. Forgetting DB_USER in production would otherwise surface as a MySQL
// access-denied for 'root' rather than as the actual mistake.
if (env.isProd && !process.env.DB_USER) fatal.push('DB_USER is required in production.');

// The one misconfiguration that would quietly undo both reasons the reports are
// streamed rather than served: publication checks and download counting.
// A draft COA sitting in the web root is a compliance problem, not a bug.
const rel = path.relative(env.publicPath, env.storagePath);
if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
  fatal.push(
    `STORAGE_PATH (${env.storagePath}) is inside the public directory ` +
    `(${env.publicPath}). Every lab report, including unpublished ones, would be ` +
    'downloadable directly and no download would be counted. Move it outside the web root.'
  );
}

if (fatal.length) {
  console.error('\nConfiguration errors:\n' + fatal.map((m) => '  - ' + m).join('\n') + '\n');
  process.exit(1);
}

// ── Non-fatal configuration warnings ────────────────────────────────────────
// Wrong but survivable settings. Each of these produces silence rather than an
// error at the point of use, which is the hardest kind of misconfiguration to
// find, so they are named at boot instead.

const warnings = [];

// The transport mode has to match the port. 465 is TLS from the first byte;
// 587 and 25 start in the clear and upgrade with STARTTLS. Mismatched,
// nodemailer waits for a handshake that never comes and every enquiry
// notification is dropped without a trace.
if (env.smtp.host) {
  if (env.smtp.secure && env.smtp.port !== 465) {
    warnings.push(
      `SMTP_SECURE is on with SMTP_PORT=${env.smtp.port}. Implicit TLS is port 465; ` +
      `${env.smtp.port} expects STARTTLS. Set SMTP_SECURE=0 for this port, or use 465. ` +
      'Mismatched, every send times out silently.'
    );
  }
  if (!env.smtp.secure && env.smtp.port === 465) {
    warnings.push(
      'SMTP_PORT=465 with SMTP_SECURE=0. Port 465 is TLS from connect; set SMTP_SECURE=1.'
    );
  }
  if (!env.smtp.password) {
    warnings.push('SMTP_HOST is set but SMTP_PASSWORD is empty, so authentication will fail.');
  }
  // Most mailbox hosts reject a From that is not the authenticated mailbox or
  // one of its aliases. The rejection arrives at SMTP time, so the app sees a
  // failed send and nobody sees the enquiry.
  const fromAddress = (env.smtp.from.match(/<([^>]+)>/) || [, env.smtp.from])[1].trim().toLowerCase();
  const fromDomain = fromAddress.split('@')[1];
  const userDomain = env.smtp.user.toLowerCase().split('@')[1];
  if (fromDomain && userDomain && fromDomain !== userDomain) {
    warnings.push(
      `MAIL_FROM (${fromAddress}) is on a different domain from SMTP_USER (${env.smtp.user}). ` +
      'Most mailbox hosts refuse to relay that and the send fails at the server.'
    );
  }
} else {
  warnings.push(
    'SMTP_HOST is empty, so contact-form enquiries are logged and stored but not emailed. ' +
    'They are all still readable in the admin under Enquiries.'
  );
}

if (!env.appUrl.startsWith('https://') && str('NODE_ENV') === 'production') {
  warnings.push(
    `APP_URL is ${env.appUrl}. Every QR code and shared report link is built from it, ` +
    'so they will point at the wrong scheme.'
  );
}

if (warnings.length) {
  // console, not the logger: this runs while the logger's own module graph is
  // still being resolved on some entry points, and it must never be filtered
  // out by LOG_LEVEL.
  console.warn('\nConfiguration warnings:\n' + warnings.map((m) => '  - ' + m).join('\n') + '\n');
}

env.warnings = warnings;

for (const dir of [env.storagePath, env.uploadsPath]) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = env;
