'use strict';

const db = require('../config/db');
const coa = require('./coa');

// Everything that reads a batch and its results, in one place, so the public
// report and the admin preview cannot drift apart in what they show.

const BATCH_COLUMNS = `
  b.id, b.batch_code, b.batch_key, b.status, b.lab_sample_id,
  b.manufactured_on, b.tested_on, b.expires_on,
  b.total_thc, b.total_cbd, b.potency_unit,
  b.notes, b.is_published, b.created_at, b.updated_at,
  p.id AS product_id, p.name AS product_name, p.slug AS product_slug,
  p.category AS product_category, p.size_label AS product_size,
  p.description AS product_description, p.image_path AS product_image,
  l.id AS lab_id, l.name AS lab_name, l.license_no AS lab_license,
  l.accreditation AS lab_accreditation, l.website AS lab_website
`;

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
       JOIN products p ON p.id = b.product_id
       LEFT JOIN labs l ON l.id = b.lab_id
      WHERE b.batch_key = ?
        ${onlyPublished ? 'AND b.is_published = 1 AND p.is_published = 1' : ''}
      LIMIT 1`,
    [key]
  );
}

function findById(id, { onlyPublished = false } = {}) {
  return db.one(
    `SELECT ${BATCH_COLUMNS}
       FROM batches b
       JOIN products p ON p.id = b.product_id
       LEFT JOIN labs l ON l.id = b.lab_id
      WHERE b.id = ?
        ${onlyPublished ? 'AND b.is_published = 1 AND p.is_published = 1' : ''}
      LIMIT 1`,
    [id]
  );
}

/**
 * The panels for a batch, each with its result rows, ordered the way a lab
 * prints them rather than by insertion.
 *
 * Two queries, not one per panel. The obvious shape — fetch panels, then loop
 * and fetch each panel's results — is nine round trips on the one page that has
 * to be fast, and it is the page a customer loads over a shop's wifi.
 */
async function loadPanels(batchId) {
  const panels = await db.query(
    `SELECT id, panel, status, method, summary, sort_order
       FROM result_panels
      WHERE batch_id = ?`,
    [batchId]
  );
  if (!panels.length) return [];

  const ids = panels.map((p) => p.id);
  const rows = await db.query(
    `SELECT id, panel_id, analyte, value_text, numeric_value, unit, lod, loq, limit_text, status, sort_order
       FROM results
      WHERE panel_id IN (${ids.map(() => '?').join(',')})
      ORDER BY sort_order, id`,
    ids
  );

  const byPanel = new Map(ids.map((id) => [id, []]));
  for (const row of rows) byPanel.get(row.panel_id).push(row);

  const order = new Map(coa.PANELS.map((p, i) => [p.key, i]));
  return panels
    .map((p) => ({ ...p, meta: coa.panel(p.panel), results: byPanel.get(p.id) || [] }))
    .sort((a, b) => (order.get(a.panel) ?? 99) - (order.get(b.panel) ?? 99));
}

/** The primary lab report PDF, plus any extras, for a batch. */
function loadFiles(batchId) {
  return db.query(
    `SELECT id, original_filename, file_path, mime_type, file_size, label, is_primary, sort_order
       FROM coa_files
      WHERE batch_id = ?
      ORDER BY is_primary DESC, sort_order, id`,
    [batchId]
  );
}

/** A batch, its panels, its files and the derived verdict — one report. */
async function loadReport(batch) {
  const [panels, files] = await Promise.all([loadPanels(batch.id), loadFiles(batch.id)]);
  return {
    batch,
    panels,
    files,
    primaryFile: files.find((f) => f.is_primary) || files[0] || null,
    verdict: coa.deriveStatus(batch.status, panels),
  };
}

/** Other published batches of the same product, for the report's footer. */
function siblings(productId, excludeBatchId, limit = 6) {
  const n = Math.min(Math.max(Math.trunc(Number(limit)) || 6, 1), 24);
  return db.query(
    `SELECT id, batch_code, status, tested_on
       FROM batches
      WHERE product_id = ? AND id <> ? AND is_published = 1
      ORDER BY tested_on DESC, id DESC
      LIMIT ${n}`,
    [productId, excludeBatchId]
  );
}

module.exports = { findByKey, findById, loadPanels, loadFiles, loadReport, siblings };
