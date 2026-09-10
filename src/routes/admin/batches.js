'use strict';

const express = require('express');
const db = require('../../config/db');
const log = require('../../lib/logger');
const coa = require('../../lib/coa');
const storage = require('../../lib/storage');
const batchesLib = require('../../lib/batches');
const activity = require('../../lib/activity');
const { pdfFields } = require('../../middleware/upload');
const { asyncRoute } = require('../../middleware/errors');
const { trim, toId, toDate, toDecimal, batchKey } = require('../../lib/validate');

const router = express.Router();

const PAGE_SIZE = 30;

// ── List ────────────────────────────────────────────────────────────────────

router.get('/', asyncRoute(async (req, res) => {
  const q = trim(req.query.q).slice(0, 80);
  const status = coa.BATCH_STATUSES.includes(req.query.status) ? req.query.status : '';
  const pubFilter = req.query.published; // '', '1', '0'
  const productId = toId(req.query.product);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);

  const where = [];
  const params = [];
  if (q) {
    where.push('(b.batch_key LIKE ? OR p.name LIKE ?)');
    params.push(`%${batchKey(q)}%`, `%${q}%`);
  }
  if (status) { where.push('b.status = ?'); params.push(status); }
  if (pubFilter === '1' || pubFilter === '0') { where.push('b.is_published = ?'); params.push(Number(pubFilter)); }
  if (productId) { where.push('b.product_id = ?'); params.push(productId); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { total } = await db.one(
    `SELECT COUNT(*) AS total FROM batches b JOIN products p ON p.id = b.product_id ${whereSql}`,
    params
  );
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);
  const offset = (current - 1) * PAGE_SIZE;

  const batches = await db.query(
    `SELECT b.id, b.batch_code, b.status, b.is_published, b.tested_on, b.total_thc, b.total_cbd,
            p.name AS product_name,
            (SELECT COUNT(*) FROM coa_files f WHERE f.batch_id = b.id) AS files,
            (SELECT COUNT(*) FROM result_panels rp WHERE rp.batch_id = b.id) AS panels
       FROM batches b
       JOIN products p ON p.id = b.product_id
       ${whereSql}
      ORDER BY b.updated_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params
  );

  const products = await db.query('SELECT id, name FROM products ORDER BY name');

  return res.render('admin/batches', {
    title: 'Batches — Super Feels COA',
    pageHeading: 'Batches',
    batches,
    products,
    q,
    status,
    pubFilter: pubFilter || '',
    productId: productId || '',
    page: current,
    pages,
    total,
  });
}));

// ── New ─────────────────────────────────────────────────────────────────────

router.get('/new', asyncRoute(async (req, res) => {
  const products = await db.query('SELECT id, name FROM products ORDER BY name');
  const labs = await db.query('SELECT id, name FROM labs WHERE is_active = 1 ORDER BY name');

  if (!products.length) {
    req.flash('error', 'Add a product before a batch — every batch belongs to one.');
    return res.redirect('/admin/products/new');
  }

  return res.render('admin/batch-form', {
    title: 'New batch — Super Feels COA',
    pageHeading: 'New batch',
    batch: { status: 'pending', is_published: 0, potency_unit: '%', product_id: toId(req.query.product) || products[0].id },
    values: {},
    errors: {},
    products,
    labs,
    isNew: true,
  });
}));

function validateBatch(body) {
  const values = {
    product_id: toId(body.product_id),
    lab_id: toId(body.lab_id),
    batch_code: trim(body.batch_code).slice(0, 80),
    status: coa.BATCH_STATUSES.includes(body.status) ? body.status : 'pending',
    lab_sample_id: trim(body.lab_sample_id).slice(0, 80),
    manufactured_on: toDate(body.manufactured_on),
    tested_on: toDate(body.tested_on),
    expires_on: toDate(body.expires_on),
    total_thc: toDecimal(body.total_thc),
    total_cbd: toDecimal(body.total_cbd),
    potency_unit: trim(body.potency_unit).slice(0, 12) || '%',
    notes: trim(body.notes),
    is_published: body.is_published ? 1 : 0,
  };
  const errors = {};
  if (!values.product_id) errors.product_id = 'Choose the product this batch is.';
  if (!values.batch_code) errors.batch_code = 'Enter the batch code from the label.';
  else if (!batchKey(values.batch_code)) errors.batch_code = 'That code has no letters or digits.';
  // A batch cannot go live with nothing to show.
  return { values, errors };
}

async function reRenderForm(req, res, { values, errors, isNew, batch }) {
  const products = await db.query('SELECT id, name FROM products ORDER BY name');
  const labs = await db.query('SELECT id, name FROM labs WHERE is_active = 1 ORDER BY name');
  return res.status(422).render('admin/batch-form', {
    title: isNew ? 'New batch — Super Feels COA' : 'Edit batch — Super Feels COA',
    pageHeading: isNew ? 'New batch' : 'Edit batch',
    batch: { ...batch, ...values },
    values,
    errors,
    products,
    labs,
    isNew,
  });
}

router.post('/new', asyncRoute(async (req, res) => {
  const { values, errors } = validateBatch(req.body);
  const key = batchKey(values.batch_code);

  if (!Object.keys(errors).length && key) {
    const clash = await db.one('SELECT id, batch_code FROM batches WHERE batch_key = ?', [key]);
    if (clash) {
      // The key, not the display code, is what collides — so tell the operator
      // which existing code it collides with, since it may look different.
      errors.batch_code = `That resolves to the same code as an existing batch (${clash.batch_code}).`;
    }
  }
  // Publishing needs something to publish. Enforced here rather than in the
  // schema because a draft with neither is a perfectly valid work-in-progress.
  if (values.is_published) {
    errors.is_published = 'A batch cannot be published before it has a report or results. Save it as a draft, add those, then publish.';
  }

  if (Object.keys(errors).length) {
    return reRenderForm(req, res, { values, errors, isNew: true, batch: { potency_unit: '%' } });
  }

  const result = await db.query(
    `INSERT INTO batches (product_id, lab_id, batch_code, batch_key, status, lab_sample_id,
            manufactured_on, tested_on, expires_on, total_thc, total_cbd, potency_unit, notes, is_published)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      values.product_id, values.lab_id, values.batch_code, key, values.status,
      values.lab_sample_id || null, values.manufactured_on, values.tested_on, values.expires_on,
      values.total_thc, values.total_cbd, values.potency_unit, values.notes || null,
    ]
  );

  await activity.record(req, { action: 'batch.create', entity: 'batch', entityId: result.insertId, detail: values.batch_code });
  req.flash('ok', `Batch ${values.batch_code} created. Add its report and results below.`);
  return res.redirect(`/admin/batches/${result.insertId}`);
}));

// ── Edit ────────────────────────────────────────────────────────────────────

router.get('/:id', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const batch = id ? await batchesLib.findById(id) : null;
  if (!batch) return next();

  const [products, labs, files, panels] = await Promise.all([
    db.query('SELECT id, name FROM products ORDER BY name'),
    db.query('SELECT id, name FROM labs WHERE is_active = 1 ORDER BY name'),
    batchesLib.loadFiles(id),
    batchesLib.loadPanels(id),
  ]);

  return res.render('admin/batch-form', {
    title: `Batch ${batch.batch_code} — Super Feels COA`,
    pageHeading: `Batch ${batch.batch_code}`,
    pageScript: '/js/results-editor.js',
    batch,
    values: batch,
    errors: {},
    products,
    labs,
    files,
    panels,
    allPanels: coa.PANELS,
    verdict: coa.deriveStatus(batch.status, panels),
    isNew: false,
  });
}));

router.post('/:id', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const batch = id ? await db.one('SELECT * FROM batches WHERE id = ?', [id]) : null;
  if (!batch) return next();

  const { values, errors } = validateBatch(req.body);
  const key = batchKey(values.batch_code);

  if (!Object.keys(errors).length && key) {
    const clash = await db.one('SELECT id, batch_code FROM batches WHERE batch_key = ? AND id <> ?', [key, id]);
    if (clash) errors.batch_code = `That resolves to the same code as another batch (${clash.batch_code}).`;
  }

  // Publishing needs a report or results attached. Checked against what is
  // already stored, since those are edited on the same page but saved
  // separately.
  if (values.is_published) {
    const { files } = await db.one('SELECT COUNT(*) AS files FROM coa_files WHERE batch_id = ?', [id]);
    const { panels } = await db.one('SELECT COUNT(*) AS panels FROM result_panels WHERE batch_id = ?', [id]);
    if (Number(files) === 0 && Number(panels) === 0) {
      errors.is_published = 'This batch has no report and no results yet, so there is nothing to publish. Add one first.';
    }
  }

  if (Object.keys(errors).length) {
    const [products, labs, files, panels] = await Promise.all([
      db.query('SELECT id, name FROM products ORDER BY name'),
      db.query('SELECT id, name FROM labs WHERE is_active = 1 ORDER BY name'),
      batchesLib.loadFiles(id),
      batchesLib.loadPanels(id),
    ]);
    return res.status(422).render('admin/batch-form', {
      title: `Batch ${batch.batch_code} — Super Feels COA`,
      pageHeading: `Batch ${batch.batch_code}`,
      pageScript: '/js/results-editor.js',
      batch: { ...batch, ...values },
      values,
      errors,
      products, labs, files, panels,
      allPanels: coa.PANELS,
      verdict: coa.deriveStatus(values.status, panels),
      isNew: false,
    });
  }

  const wasPublished = batch.is_published;

  await db.query(
    `UPDATE batches SET product_id = ?, lab_id = ?, batch_code = ?, batch_key = ?, status = ?,
            lab_sample_id = ?, manufactured_on = ?, tested_on = ?, expires_on = ?,
            total_thc = ?, total_cbd = ?, potency_unit = ?, notes = ?, is_published = ?
      WHERE id = ?`,
    [
      values.product_id, values.lab_id, values.batch_code, key, values.status,
      values.lab_sample_id || null, values.manufactured_on, values.tested_on, values.expires_on,
      values.total_thc, values.total_cbd, values.potency_unit, values.notes || null,
      values.is_published, id,
    ]
  );

  // Publishing is the state change worth its own audit line — it is the moment
  // a result becomes something the public can read.
  if (!wasPublished && values.is_published) {
    await activity.record(req, { action: 'batch.publish', entity: 'batch', entityId: id, detail: values.batch_code });
  } else if (wasPublished && !values.is_published) {
    await activity.record(req, { action: 'batch.unpublish', entity: 'batch', entityId: id, detail: values.batch_code });
  } else {
    await activity.record(req, { action: 'batch.update', entity: 'batch', entityId: id, detail: values.batch_code });
  }

  req.flash('ok', `Batch ${values.batch_code} saved.`);
  return res.redirect(`/admin/batches/${id}`);
}));

// ── Report PDF upload ───────────────────────────────────────────────────────

router.post('/:id/files', pdfFields([{ name: 'reports', maxCount: 6 }]), asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const batch = id ? await db.one('SELECT id, batch_code FROM batches WHERE id = ?', [id]) : null;
  if (!batch) return next();

  const uploaded = (req.files && req.files.reports) || [];
  if (!uploaded.length) {
    req.flash('error', 'No PDF was chosen.');
    return res.redirect(`/admin/batches/${id}#reports`);
  }

  const existing = await db.one('SELECT COUNT(*) AS n FROM coa_files WHERE batch_id = ?', [id]);
  let isFirst = Number(existing.n) === 0;
  const label = trim(req.body.label).slice(0, 120);

  const shard = storage.shardDir();
  await storage.ensureDir(shard);

  for (const file of uploaded) {
    const stored = storage.storedName(file.originalname);
    const relPath = `${shard}/${stored}`.replace(/\\/g, '/');
    const abs = storage.resolve(relPath);
    // Written only now, after validation and after the batch is confirmed to
    // exist. multer held it in memory precisely so a rejected upload leaves
    // nothing on disk.
    await require('fs/promises').writeFile(abs, file.buffer);

    await db.query(
      `INSERT INTO coa_files (batch_id, original_filename, stored_filename, file_path, mime_type, file_size, label, is_primary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, file.originalname.slice(0, 255), stored, relPath, file.mimetype,
        file.size, label || null, isFirst ? 1 : 0,
      ]
    );
    isFirst = false; // only the first of a first upload is primary
  }

  await activity.record(req, {
    action: 'batch.upload', entity: 'batch', entityId: id,
    detail: `${uploaded.length} report file(s) for ${batch.batch_code}`,
  });
  log.info('report files uploaded', { batchId: id, count: uploaded.length });
  req.flash('ok', `${uploaded.length} report${uploaded.length === 1 ? '' : 's'} uploaded.`);
  return res.redirect(`/admin/batches/${id}#reports`);
}));

router.post('/:id/files/:fileId/primary', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const fileId = toId(req.params.fileId);
  if (!id || !fileId) return next();

  await db.transaction(async (conn) => {
    await conn.execute('UPDATE coa_files SET is_primary = 0 WHERE batch_id = ?', [id]);
    await conn.execute('UPDATE coa_files SET is_primary = 1 WHERE id = ? AND batch_id = ?', [fileId, id]);
  });
  req.flash('ok', 'Primary report updated.');
  return res.redirect(`/admin/batches/${id}#reports`);
}));

router.post('/:id/files/:fileId/delete', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const fileId = toId(req.params.fileId);
  if (!id || !fileId) return next();

  const file = await db.one('SELECT * FROM coa_files WHERE id = ? AND batch_id = ?', [fileId, id]);
  if (!file) return next();

  await db.query('DELETE FROM coa_files WHERE id = ?', [fileId]);
  await storage.remove(file.file_path);

  // If the deleted file was the primary, promote the next one so the batch does
  // not silently end up with files but no primary.
  if (file.is_primary) {
    const nextFile = await db.one('SELECT id FROM coa_files WHERE batch_id = ? ORDER BY sort_order, id LIMIT 1', [id]);
    if (nextFile) await db.query('UPDATE coa_files SET is_primary = 1 WHERE id = ?', [nextFile.id]);
  }

  await activity.record(req, { action: 'batch.file_delete', entity: 'batch', entityId: id, detail: file.original_filename });
  req.flash('ok', 'Report file removed.');
  return res.redirect(`/admin/batches/${id}#reports`);
}));

// ── Delete batch ────────────────────────────────────────────────────────────

router.post('/:id/delete', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const batch = id ? await db.one('SELECT * FROM batches WHERE id = ?', [id]) : null;
  if (!batch) return next();

  // Collect file paths before the cascade removes their rows.
  const files = await db.query('SELECT file_path FROM coa_files WHERE batch_id = ?', [id]);
  await db.query('DELETE FROM batches WHERE id = ?', [id]);
  for (const f of files) await storage.remove(f.file_path);

  await activity.record(req, { action: 'batch.delete', entity: 'batch', entityId: id, detail: batch.batch_code });
  log.warn('batch deleted', { adminId: req.admin.id, batchId: id, code: batch.batch_code });
  req.flash('ok', `Batch ${batch.batch_code} deleted.`);
  return res.redirect('/admin/batches');
}));

// Results editing lives in its own file, mounted under the batch.
router.use('/:id/results', require('./results'));

module.exports = router;
