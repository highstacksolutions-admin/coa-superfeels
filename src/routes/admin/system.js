'use strict';

const express = require('express');
const fsp = require('fs/promises');
const db = require('../../config/db');
const env = require('../../config/env');
const mailer = require('../../lib/mailer');
const storage = require('../../lib/storage');
const { asyncRoute } = require('../../middleware/errors');
const { isEmail, normaliseEmail } = require('../../lib/validate');

const router = express.Router();

/**
 * The one page for answering "is everything actually wired up?" without a
 * shell. It checks the things that fail silently: the mail transport, the
 * storage directory being writable and outside the web root, and how much the
 * two are holding.
 */
router.get('/', asyncRoute(async (req, res) => {
  const mail = mailer.status();

  // Is the storage root writable? A read-only mount is the failure that turns
  // every report upload into a 500 with no other warning.
  let storageWritable = false;
  let storageError = null;
  try {
    const probe = storage.resolve('.write-probe');
    await fsp.writeFile(probe, String(Date.now()));
    await fsp.unlink(probe);
    storageWritable = true;
  } catch (err) {
    storageError = err.message;
  }

  const totals = await db.one(
    `SELECT
       (SELECT COUNT(*) FROM coa_files)                       AS files,
       (SELECT COALESCE(SUM(file_size), 0) FROM coa_files)    AS bytes,
       (SELECT COUNT(*) FROM batches)                         AS batches,
       (SELECT COUNT(*) FROM lookups)                         AS lookups,
       (SELECT COUNT(*) FROM enquiries)                       AS enquiries`
  );

  return res.render('admin/system', {
    title: 'System — Super Feels COA',
    pageHeading: 'System',
    mail,
    mailHistory: mailer.history().slice(0, 40),
    storage: {
      path: env.storagePath,
      writable: storageWritable,
      error: storageError,
      bytes: totals.bytes,
    },
    totals,
    env: {
      nodeEnv: env.nodeEnv,
      appUrl: env.appUrl,
      node: process.version,
      uptime: Math.round(process.uptime()),
      warnings: env.warnings || [],
      analytics: Boolean(env.analyticsSnippet),
    },
  });
}));

router.post('/mail-test', asyncRoute(async (req, res) => {
  const to = normaliseEmail(req.body.to);
  if (!isEmail(to)) {
    req.flash('error', 'Enter a valid email address to send the test to.');
    return res.redirect('/admin/system');
  }
  await mailer.sendTest(to, req.admin.email);
  req.flash('ok', `Test queued to ${to}. Watch the history below and check the inbox.`);
  return res.redirect('/admin/system#mail');
}));

module.exports = router;
