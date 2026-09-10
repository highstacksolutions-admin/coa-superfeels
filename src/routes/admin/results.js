'use strict';

// mergeParams so the :id of the parent /batches/:id/results mount is visible.
const express = require('express');
const db = require('../../config/db');
const coa = require('../../lib/coa');
const activity = require('../../lib/activity');
const { asyncRoute } = require('../../middleware/errors');
const { trim, toId, toDecimal } = require('../../lib/validate');

const router = express.Router({ mergeParams: true });

/**
 * Save one panel's results in a single transaction.
 *
 * The whole panel is replaced rather than diffed: the operator is transcribing
 * from a PDF, and "delete the panel, insert what the form holds now" is both
 * simpler to reason about and impossible to leave in a half-updated state. A
 * diff would have to guess which existing row a form row corresponds to, and
 * get it wrong the moment two analytes are reordered.
 *
 * It is one transaction so that a batch's report can never be seen mid-save
 * with half its analytes.
 */
function parseRows(panelBody) {
  // The form posts rows as an object keyed by index (a plain form array would
  // renumber on client-side deletion). Order is taken from a hidden sort field,
  // not from key order, which qs does not guarantee.
  const raw = panelBody && typeof panelBody.rows === 'object' ? panelBody.rows : {};
  const rows = Object.values(raw)
    .map((r, i) => ({
      analyte: trim(r.analyte).slice(0, 120),
      value_text: trim(r.value_text).slice(0, 40),
      numeric_value: toDecimal(r.value_text),
      unit: trim(r.unit).slice(0, 20) || null,
      lod: trim(r.lod).slice(0, 20) || null,
      loq: trim(r.loq).slice(0, 20) || null,
      limit_text: trim(r.limit_text).slice(0, 40) || null,
      status: coa.RESULT_STATUSES.includes(r.status) ? r.status : 'na',
      sort_order: Number.parseInt(r.sort, 10) || i,
    }))
    // A blank analyte row is one the operator added and did not fill — drop it
    // rather than storing an empty result.
    .filter((r) => r.analyte);
  rows.sort((a, b) => a.sort_order - b.sort_order);
  return rows;
}

router.post('/:panel', asyncRoute(async (req, res, next) => {
  const batchId = toId(req.params.id);
  const panelKey = req.params.panel;
  if (!batchId || !coa.PANEL_KEYS.includes(panelKey)) return next();

  const batch = await db.one('SELECT id, batch_code FROM batches WHERE id = ?', [batchId]);
  if (!batch) return next();

  const body = req.body || {};
  const status = coa.PANEL_STATUSES.includes(body.status) ? body.status : 'not_tested';
  const method = trim(body.method).slice(0, 120) || null;
  const summary = trim(body.summary).slice(0, 255) || null;
  const rows = parseRows(body);

  await db.transaction(async (conn) => {
    // Upsert the panel row, then replace its results wholesale.
    await conn.execute(
      `INSERT INTO result_panels (batch_id, panel, status, method, summary)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), method = VALUES(method), summary = VALUES(summary)`,
      [batchId, panelKey, status, method, summary]
    );
    const panel = await conn.execute(
      'SELECT id FROM result_panels WHERE batch_id = ? AND panel = ?',
      [batchId, panelKey]
    );
    const panelId = panel[0][0].id;

    await conn.execute('DELETE FROM results WHERE panel_id = ?', [panelId]);
    for (const r of rows) {
      await conn.execute(
        `INSERT INTO results (panel_id, analyte, value_text, numeric_value, unit, lod, loq, limit_text, status, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [panelId, r.analyte, r.value_text, r.numeric_value, r.unit, r.lod, r.loq, r.limit_text, r.status, r.sort_order],
      );
    }
  });

  await activity.record(req, {
    action: 'batch.results', entity: 'batch', entityId: batchId,
    detail: `${coa.panel(panelKey).label} (${rows.length} rows) for ${batch.batch_code}`,
  });
  req.flash('ok', `${coa.panel(panelKey).label} results saved.`);
  return res.redirect(`/admin/batches/${batchId}#panel-${panelKey}`);
}));

router.post('/:panel/delete', asyncRoute(async (req, res, next) => {
  const batchId = toId(req.params.id);
  const panelKey = req.params.panel;
  if (!batchId || !coa.PANEL_KEYS.includes(panelKey)) return next();

  // Results cascade from the panel row.
  await db.query('DELETE FROM result_panels WHERE batch_id = ? AND panel = ?', [batchId, panelKey]);
  await activity.record(req, {
    action: 'batch.results_delete', entity: 'batch', entityId: batchId,
    detail: coa.panel(panelKey).label,
  });
  req.flash('ok', `${coa.panel(panelKey).label} panel removed.`);
  return res.redirect(`/admin/batches/${batchId}`);
}));

module.exports = router;
