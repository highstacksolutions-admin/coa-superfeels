'use strict';

const db = require('../config/db');

// Everything that reads a batch and its report files, in one place, so the
// public report and the admin preview cannot drift apart in what they show.
//
// Products are LEFT JOINed throughout: a batch may be saved with nothing but a
// code and the lab's PDF, and the PDF names the product itself.

const BATCH_COLUMNS = `
  b.id, b.batch_code, b.batch_key, b.product_id,
  b.notes, b.is_published, b.created_at, b.updated_at,
  p.name AS product_name, p.slug AS product_slug,
  p.category AS product_category, p.size_label AS product_size,
  p.description AS product_description, p.image_path AS product_image
`;

// A batch with no product is visible on its own publish flag alone. One with a
// product also needs the product to be published, so hiding a product hides
// every report filed under it.
const PUBLISHED = 'AND b.is_published = 1 AND (p.id IS NULL OR p.is_published = 1)';

/**
 * Find one batch by the normalised lookup key.
 *
 * `onlyPublished` is the caller's decision rather than a default, because the
 * two callers need opposite behaviour and getting it wrong is a disclosure bug
 * in one direction and a broken preview in the other: the public lookup must
 * never return a draft, and the admin preview exists precisely to see one.
 */
function findByKey(key, { onlyPublished = true } = {}) {
  return db.one(
    `SELECT ${BATCH_COLUMNS}
       FROM batches b
       LEFT JOIN products p ON p.id = b.product_id
      WHERE b.batch_key = ?
        ${onlyPublished ? PUBLISHED : ''}
      LIMIT 1`,
    [key]
  );
}

function findById(id, { onlyPublished = false } = {}) {
  return db.one(
    `SELECT ${BATCH_COLUMNS}
       FROM batches b
       LEFT JOIN products p ON p.id = b.product_id
      WHERE b.id = ?
        ${onlyPublished ? PUBLISHED : ''}
      LIMIT 1`,
    [id]
  );
}

/** The primary lab report PDF, plus any extras, for a batch. */
function loadFiles(batchId) {
  return db.query(
    `SELECT id, original_filename, file_path, mime_type, file_size, label, is_primary, sort_order, created_at
       FROM coa_files
      WHERE batch_id = ?
      ORDER BY is_primary DESC, sort_order, id`,
    [batchId]
  );
}

/** A batch and its report files — one report. */
async function loadReport(batch) {
  const files = await loadFiles(batch.id);
  return {
    batch,
    files,
    primaryFile: files.find((f) => f.is_primary) || files[0] || null,
  };
}

/** Other published batches of the same product, for the report's footer. */
function siblings(productId, excludeBatchId, limit = 6) {
  if (!productId) return Promise.resolve([]);
  const n = Math.min(Math.max(Math.trunc(Number(limit)) || 6, 1), 24);
  return db.query(
    `SELECT id, batch_code, created_at
       FROM batches
      WHERE product_id = ? AND id <> ? AND is_published = 1
      ORDER BY created_at DESC, id DESC
      LIMIT ${n}`,
    [productId, excludeBatchId]
  );
}

module.exports = { findByKey, findById, loadFiles, loadReport, siblings };
