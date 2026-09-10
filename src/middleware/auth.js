'use strict';

const db = require('../config/db');
const log = require('../lib/logger');

// The public side of this site has no accounts — anyone with a batch code can
// read its report, which is the entire point of publishing them. So the only
// identity here is staff, on its own cookie and its own session store (see
// app.js), scoped to /admin.

async function loadAdmin(req, res, next) {
  res.locals.admin = null;
  req.admin = null;

  const id = req.adminSession && req.adminSession.adminId;
  if (!id) return next();

  try {
    const admin = await db.one(
      'SELECT id, name, email, role, is_active, last_login_at FROM admins WHERE id = ?',
      [id]
    );
    // Deactivated in the admin while signed in: drop the session immediately.
    if (!admin || !admin.is_active) {
      return req.adminSession.destroy(() => next());
    }
    req.admin = admin;
    res.locals.admin = admin;
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireAdmin(req, res, next) {
  if (req.admin) return next();
  const target = req.originalUrl && req.originalUrl.startsWith('/admin') ? req.originalUrl : '/admin';
  return res.redirect(`/admin/login?next=${encodeURIComponent(target)}`);
}

/**
 * Role gate. `editor` may manage products, batches, results and reports —
 * everything needed to publish a COA. Anything touching customer data, staff
 * accounts or the audit trail is `admin` only.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.admin) return requireAdmin(req, res, next);
    if (roles.includes(req.admin.role)) return next();
    log.warn('admin role denied', { adminId: req.admin.id, role: req.admin.role, path: req.originalUrl });
    const err = new Error('Your account does not have access to that area.');
    err.status = 403;
    return next(err);
  };
}

/**
 * Establish a staff session. Regenerates the session id first so a pre-auth
 * cookie cannot be fixated into an authenticated one.
 */
function signInAdmin(req, admin) {
  return new Promise((resolve, reject) => {
    req.adminSession.regenerate((err) => {
      if (err) return reject(err);
      req.adminSession.adminId = admin.id;
      req.adminSession.signedInAt = Date.now();
      req.adminSession.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

module.exports = { loadAdmin, requireAdmin, requireRole, signInAdmin };
