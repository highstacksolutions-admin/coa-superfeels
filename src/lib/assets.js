'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const log = require('./logger');

// Cache-busting for the static files under ./public.
//
// express.static serves this directory with a long max-age in production. With
// fixed URLs, a browser that had already loaded /css/app.css would not ask for
// it again until that expired — not even a conditional request — so a CSS or JS
// fix would reach only first-time visitors.
//
// So the URL carries a fingerprint of the file's own bytes. Same bytes, same
// URL, still cached; changed bytes, new URL, fetched at once. That is what
// makes a long cache lifetime safe rather than a liability.

const HASH_LENGTH = 10;
const cache = new Map();

/**
 * Fingerprinted URL for a path under ./public, e.g.
 *   asset('/css/app.css') -> '/css/app.css?v=1f4c9ab207'
 *
 * Paths here are literals written in templates, never request input, but the
 * root is enforced anyway — a fingerprint helper is exactly the kind of thing
 * that later gets handed something dynamic.
 *
 * A missing or unreadable file returns the plain path and warns. A stylesheet
 * that 404s is obvious; silently dropping the tag would not be.
 */
function asset(urlPath) {
  if (typeof urlPath !== 'string' || !urlPath.startsWith('/')) return urlPath;
  if (cache.has(urlPath)) return cache.get(urlPath);

  const abs = path.resolve(env.publicPath, `.${urlPath}`);
  const rel = path.relative(env.publicPath, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    log.warn('asset() asked for a path outside the public directory', { urlPath });
    return urlPath;
  }

  let out = urlPath;
  try {
    const digest = crypto.createHash('sha256')
      .update(fs.readFileSync(abs))
      .digest('hex')
      .slice(0, HASH_LENGTH);
    out = `${urlPath}?v=${digest}`;
  } catch (err) {
    log.warn('asset could not be fingerprinted; serving it unversioned', {
      urlPath,
      error: err.message,
    });
  }

  // Only cached in production. In development the file changes under a running
  // process constantly, and a cached hash there would mean editing CSS and
  // seeing nothing until a restart.
  if (env.isProd) cache.set(urlPath, out);
  return out;
}

module.exports = { asset };
