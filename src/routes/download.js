'use strict';

const path = require('path');
const fsp = require('fs/promises');
const express = require('express');
const db = require('../config/db');
const log = require('../lib/logger');
const storage = require('../lib/storage');
const analytics = require('../lib/analytics');
const limits = require('../middleware/rateLimit');
const { asyncRoute } = require('../middleware/errors');
const { toId } = require('../lib/validate');

const router = express.Router();

/**
 * Lab reports are streamed through here rather than served as static files.
 * Two reasons, and both of them are the whole reason STORAGE_PATH lives outside
 * the web root:
 *
 *   1. A report attached to an unpublished batch must not be reachable. A
 *      static handler cannot know what "published" means.
 *   2. Every download is counted. "How many people actually opened the report
 *      for this batch" is the question the operator cannot answer any other
 *      way.
 */

/**
 * A filename safe to put in a Content-Disposition header, named after the batch
 * rather than after whatever the lab called its export. Someone who downloads
 * four reports wants four distinguishable files, not four copies of
 * "COA_final_v2.pdf".
 */
function downloadName(row) {
  const base = `superfeels-${row.batch_code}-coa`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const ext = path.extname(row.original_filename || '').toLowerCase();
  return `${base}${/^\.[a-z0-9]+$/.test(ext) ? ext : '.pdf'}`;
}

router.get('/:id', limits.download, asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  if (!id) {
    const err = new Error('That report link is not valid.');
    err.status = 404;
    return next(err);
  }

  // The publication check is part of the lookup, not a second query, so there
  // is no window in which a row is found and then judged.
  const file = await db.one(
    `SELECT f.id, f.batch_id, f.original_filename, f.file_path, f.mime_type, f.file_size,
            b.batch_code, b.is_published, p.id AS product_id, p.is_published AS product_published
       FROM coa_files f
       JOIN batches b  ON b.id = f.batch_id
       LEFT JOIN products p ON p.id = b.product_id
      WHERE f.id = ?`,
    [id]
  );

  // A draft batch's report is treated as absent rather than forbidden. A 403
  // would confirm that the batch exists, which is exactly what an unpublished
  // batch should not do. A batch filed under no product answers to its own
  // publish flag alone.
  if (!file || !file.is_published || (file.product_id && !file.product_published)) {
    const err = new Error('That report is not available.');
    err.status = 404;
    return next(err);
  }

  const stat = await storage.stat(file.file_path);
  if (!stat) {
    // The row exists and the file does not. That is an operational fault worth
    // a loud log line: it means storage was restored without the database, or
    // the other way round.
    log.error('lab report missing from storage', {
      coaFileId: file.id, batchId: file.batch_id, path: file.file_path,
    });
    const err = new Error('That report could not be found on disk. Please let us know.');
    err.status = 404;
    return next(err);
  }

  // Three ways the same file is served, distinguished by query:
  //   (default)   → attachment, a deliberate save. Counts.
  //   ?inline=1   → inline, opened in a browser tab. Counts.
  //   ?embed=1    → the bytes the on-page PDF.js viewer fetches. Base64 text,
  //                 not a PDF response — see below. Does NOT count: the report
  //                 view is already recorded as a lookup, and counting the
  //                 render too would make every page load look like a download.
  const embed = req.query.embed === '1';
  const inline = req.query.inline === '1';

  if (embed) {
    // The whole reason this branch exists: a download-manager browser
    // extension (Internet Download Manager and its kind) hooks the network
    // layer and grabs any response whose Content-Type is application/pdf —
    // including the fetch the on-page viewer makes — throwing its own dialog
    // and leaving the report blank on every page load.
    //
    // So the embed path sends the file as base64 in a text/plain body. There is
    // no PDF response for the extension to detect, so it stays out of the way,
    // and PDF.js decodes the text back to bytes and renders it on a canvas. The
    // file is read whole, which is fine here — a COA is a few pages, not a
    // video. The 33% base64 overhead is a rounding error at this size and buys
    // certainty that nothing on the wire looks like a downloadable file.
    const buf = await fsp.readFile(storage.resolve(file.file_path));
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    // Not stored by the browser. The viewer re-fetches on each report view,
    // which is cheap for a COA and removes any chance of a stale entry — e.g.
    // a corrected report served from an old cache, or a format change poisoning
    // the URL. The lookup, not this fetch, is the thing worth caching.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(buf.toString('base64'));
  }

  analytics.recordDownload(req, { coaFileId: file.id, batchId: file.batch_id });

  res.setHeader('Content-Type', file.mime_type || 'application/pdf');
  res.setHeader('Content-Length', stat.size);
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${downloadName(file)}"`
  );
  // A report is immutable once published — a corrected result is a new file —
  // so it can be cached hard. `private` keeps it out of shared proxies.
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const stream = storage.createReadStream(file.file_path);
  stream.on('error', (err) => {
    log.error('report stream failed', { coaFileId: file.id, error: err.message });
    // Headers are already out, so there is no error page to send. Killing the
    // socket is the only honest signal left that the body is incomplete.
    if (!res.headersSent) return next(err);
    return res.destroy();
  });
  return stream.pipe(res);
}));

module.exports = router;
