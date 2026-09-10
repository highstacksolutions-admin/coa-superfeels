'use strict';

const rateLimit = require('express-rate-limit');
const log = require('../lib/logger');
const { normaliseEmail } = require('../lib/validate');

// The store is in-process. That is deliberate for this deployment: the app runs
// as a single PM2 fork (see ecosystem.config.js), so one process sees every
// request. If it is ever scaled to cluster mode, swap in a shared store or the
// effective limit multiplies by the instance count.

function tooMany(req, res, message) {
  log.warn('rate limit hit', { path: req.originalUrl, ip: req.ip });
  if (req.accepts(['html', 'json']) === 'json') {
    return res.status(429).json({ ok: false, error: message });
  }
  return res.status(429).render('pages/message', {
    title: 'Slow down a moment',
    heading: 'Too many requests',
    body: message,
    action: { href: '/', label: 'Back to the lookup' },
  });
}

/** IPv6 addresses are bucketed by /64 so a single subnet cannot fan out. */
function ipKey(req) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (ip.includes(':')) {
    return ip.split(':').slice(0, 4).join(':') + '::/64';
  }
  return ip;
}

function byIp({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: ipKey,
    handler: (req, res) => tooMany(req, res, message),
  });
}

/**
 * Keyed on the submitted email. Requests without one fall through to a shared
 * bucket keyed by IP, so a blank-email flood is still bounded.
 */
function byEmail({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email = req.body && req.body.email ? normaliseEmail(req.body.email) : '';
      return email ? `email:${email}` : `noemail:${ipKey(req)}`;
    },
    handler: (req, res) => tooMany(req, res, message),
  });
}

const SLOW = 'Too many attempts from your connection. Wait a few minutes and try again.';

/**
 * The batch lookup.
 *
 * This is the one public endpoint that can be walked: batch codes are short and
 * partly sequential, so an unlimited lookup is a way to enumerate the whole
 * product catalogue and every test result in it. The limit is set well above
 * what a person standing in a shop with a jar will ever do — they look up one
 * code, maybe mistype it twice — and well below what a script needs to be
 * useful.
 */
const lookup = byIp({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: 'That is a lot of lookups. Give it a few minutes and try again.',
});

const download = byIp({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: 'That is a lot of downloads at once. Give it a few minutes.',
});

// Deliberately loose on IP and tight on address: a family or an office shares
// one IP, and the person filling this in is usually already frustrated.
const enquiry = [
  byIp({ windowMs: 60 * 60 * 1000, max: 20, message: SLOW }),
  byEmail({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: 'We already have your message. We will reply to that address shortly.',
  }),
];

const adminLogin = [
  byIp({ windowMs: 15 * 60 * 1000, max: 20, message: SLOW }),
  byEmail({
    windowMs: 15 * 60 * 1000,
    max: 8,
    message: 'Too many attempts for that email address. Wait a few minutes and try again.',
  }),
];

module.exports = { lookup, download, enquiry, adminLogin };
