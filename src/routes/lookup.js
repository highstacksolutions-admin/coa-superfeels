'use strict';

const express = require('express');
const db = require('../config/db');
const coa = require('../lib/coa');
const batches = require('../lib/batches');
const analytics = require('../lib/analytics');
const limits = require('../middleware/rateLimit');
const { asyncRoute } = require('../middleware/errors');
const { batchKey, trim } = require('../lib/validate');

const router = express.Router();

const CODE_MAX = 80;

/**
 * Where the lookup came from, for the analytics breakdown.
 *
 * A QR scan arrives with no referrer at all, because the camera app is not a
 * web page. Someone using the form on our own home page arrives with a
 * same-origin referrer. Anything else is a shared or pasted link. None of this
 * needs a query parameter or a cookie, which is why it is done here rather than
 * threaded through the redirect — a `?from=form` on the report URL would end up
 * in the links people share with each other and skew the numbers permanently.
 *
 * `?qr=1` is honoured for when the printed codes are generated, so a scan can
 * be identified positively instead of by the absence of a header.
 */
function lookupSource(req) {
  if (req.query.qr) return 'qr';
  const ref = req.get('referer');
  if (!ref) return 'link';
  try {
    return new URL(ref).host === req.get('host') ? 'form' : 'link';
  } catch {
    return 'link';
  }
}

// ── Home ────────────────────────────────────────────────────────────────────

router.get('/', asyncRoute(async (req, res) => {
  const totals = await db.one(
    `SELECT
       (SELECT COUNT(*) FROM batches WHERE is_published = 1)  AS batches,
       (SELECT COUNT(DISTINCT product_id) FROM batches WHERE is_published = 1) AS products,
       (SELECT COUNT(*) FROM labs WHERE is_active = 1)        AS labs`
  );

  return res.render('pages/home', {
    title: 'Lab results — Super Feels',
    bodyClass: 'is-home',
    pageScript: '/js/lookup.js',
    totals,
    entered: '',
    error: null,
  });
}));

/**
 * The form target. Resolves nothing itself — it normalises and redirects, so
 * that every report lives at one canonical, shareable URL and so that all
 * lookup logging happens in exactly one place below.
 */
router.get('/lookup', limits.lookup, (req, res) => {
  const entered = trim(req.query.batch).slice(0, CODE_MAX);
  if (!batchKey(entered)) {
    return res.status(400).render('pages/home', {
      title: 'Lab results — Super Feels',
      bodyClass: 'is-home',
      pageScript: '/js/lookup.js',
      products: [],
      totals: { batches: 0, products: 0, labs: 0 },
      panels: coa.PANELS,
      entered,
      error: 'Enter the batch code printed on your product.',
    });
  }
  return res.redirect(302, `/coa/${encodeURIComponent(entered)}`);
});

// ── The report ──────────────────────────────────────────────────────────────

router.get('/coa/:code', limits.lookup, asyncRoute(async (req, res) => {
  const entered = trim(req.params.code).slice(0, CODE_MAX);
  const key = batchKey(entered);
  const source = lookupSource(req);

  if (!key) return res.redirect('/');

  const batch = await batches.findByKey(key, { onlyPublished: true });

  // Not awaited. The report must not wait on an analytics insert, and a failed
  // insert must not fail the lookup.
  analytics.recordLookup(req, { query: entered.toUpperCase(), batchId: batch ? batch.id : null, source });

  if (!batch) {
    return res.status(404).render('pages/notfound', {
      title: `No report for ${entered} — Super Feels`,
      // A batch code is not a page anyone should reach from a search engine,
      // and a 404 for one is certainly not.
      robots: 'noindex, nofollow',
      entered,
    });
  }

  const report = await batches.loadReport(batch);
  const siblings = await batches.siblings(batch.product_id, batch.id);

  return res.render('pages/report', {
    title: `${batch.product_name} — batch ${batch.batch_code}`,
    description: `Independent laboratory results for Super Feels ${batch.product_name}, batch ${batch.batch_code}.`,
    // Individual batch reports are for the person holding the product, not for
    // search results. They also go stale as stock sells through, and an indexed
    // report for a batch nobody can buy is worse than no result at all.
    robots: 'noindex, follow',
    bodyClass: 'is-report',
    ...report,
    siblings,
  });
}));

/** Kept so an older or hand-typed /batch/CODE link does not dead-end. */
router.get('/batch/:code', (req, res) => {
  res.redirect(301, `/coa/${encodeURIComponent(trim(req.params.code).slice(0, CODE_MAX))}`);
});

module.exports = router;
