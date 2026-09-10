'use strict';

const crypto = require('crypto');

// Synchroniser-token CSRF. One secret per session, compared in constant time.
//
// The token is read from the parsed body for normal form posts and from the
// `x-csrf-token` header for fetch/XHR. The header path matters for the report
// uploader: multipart bodies are parsed by multer inside the route, long after
// this middleware runs, so a multipart form has no readable body field here.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const FIELD = '_csrf';

function issue(req) {
  if (!req.session) return '';
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = crypto.randomBytes(32).toString('base64url');
  }
  return req.session.csrfSecret;
}

function readToken(req) {
  const fromBody = req.body && typeof req.body[FIELD] === 'string' ? req.body[FIELD] : null;
  const fromHeader = req.get('x-csrf-token');
  return fromBody || fromHeader || null;
}

function matches(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function badToken() {
  const err = new Error('Your session expired or the form was stale. Please try again.');
  err.status = 403;
  err.code = 'EBADCSRFTOKEN';
  return err;
}

/**
 * Mounted globally. Exposes res.locals.csrfToken to every template and rejects
 * any state-changing request that does not carry a matching token.
 *
 * Multipart is the one case this cannot settle on its own: the body is parsed
 * by multer inside the route, long after this runs, so a multipart form's
 * hidden field is not readable here. Such a request is deferred rather than
 * rejected, and `enforceMultipartCsrf` finishes the job the moment multer has
 * parsed the body. `upload.js` wires that in automatically, so a route cannot
 * accept a multipart body without also getting the check.
 */
function csrf(req, res, next) {
  const secret = issue(req);
  res.locals.csrfToken = secret;
  req.csrfToken = () => secret;

  if (SAFE_METHODS.has(req.method)) return next();

  if (matches(readToken(req), secret)) {
    req.csrfVerified = true;
    return next();
  }

  if (req.is('multipart/form-data')) {
    req.csrfDeferred = true;
    return next();
  }

  return next(badToken());
}

/** Runs after multer. No-ops when the header already satisfied the check. */
function enforceMultipartCsrf(req, res, next) {
  if (req.csrfVerified) return next();

  const secret = req.session && req.session.csrfSecret;
  if (matches(readToken(req), secret)) {
    req.csrfVerified = true;
    return next();
  }
  return next(badToken());
}

module.exports = { csrf, enforceMultipartCsrf, FIELD };
