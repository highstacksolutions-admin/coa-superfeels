'use strict';

const log = require('../lib/logger');
const env = require('../config/env');

function notFound(req, res, next) {
  const err = new Error('That page does not exist.');
  err.status = 404;
  next(err);
}

/** Wrap an async route so a rejected promise reaches this handler. */
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function handler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    log.error('request failed', {
      method: req.method,
      path: req.originalUrl,
      adminId: req.admin ? req.admin.id : null,
      error: err,
    });
  } else {
    log.warn('request rejected', {
      method: req.method, path: req.originalUrl, status, message: err.message,
    });
  }

  // A download that already started streaming cannot be turned into an error
  // page — the headers are gone. Kill the response instead.
  if (res.headersSent) return req.socket.destroy();

  const isJson = req.xhr
    || req.get('x-requested-with') === 'XMLHttpRequest'
    || req.accepts(['html', 'json']) === 'json';

  const message = status >= 500 && env.isProd
    ? 'Something went wrong on our end. Try again in a moment.'
    : err.message;

  if (isJson) {
    return res.status(status).json({ ok: false, error: message });
  }

  const isAdmin = req.originalUrl.startsWith('/admin');
  const copy = {
    404: { heading: 'Not found', body: 'That page does not exist, or it moved.' },
    403: { heading: 'No access', body: message },
    413: { heading: 'File too large', body: message },
  }[status] || { heading: 'Something went wrong', body: message };

  return res.status(status).render('pages/message', {
    title: copy.heading,
    heading: copy.heading,
    body: copy.body,
    action: isAdmin
      ? { href: '/admin', label: 'Back to admin' }
      : { href: '/', label: 'Look up a batch' },
  });
}

module.exports = { notFound, handler, asyncRoute };
