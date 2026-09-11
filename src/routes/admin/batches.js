'use strict';

const fsp = require('fs/promises');
const express = require('express');
const db = require('../../config/db');
const log = require('../../lib/logger');
const storage = require('../../lib/storage');
const batchesLib = require('../../lib/batches');
const activity = require('../../lib/activity');
const { pdfFields, isPdf } = require('../../middleware/upload');
const { asyncRoute } = require('../../middleware/errors');
const { trim, toId, batchKey } = require('../../lib/validate');

const router = express.Router();

const PAGE_SIZE = 30;

// A batch is a batch number and the laboratory's PDF. Nothing on the report is
// transcribed into fields: the PDF is the record, and the public page shows it
// in full. The product is optional — the PDF names it anyway.

function loadProducts() {
  return db.query('SELECT id, name FROM products ORDER BY name');
}

/**
 * Write an uploaded PDF into the storage root and say where it went.
 *
 * Called only after validation and after the batch is confirmed to exist.
 * multer held the file in memory precisely so a rejected upload leaves nothing
 * on disk.
 */
async function saveReport(file) {
  const shard = storage.shardDir();
  await storage.ensureDir(shard);
  const stored = storage.storedName(file.originalname);
  const relPath = `${shard}/${stored}`.replace(/\\/g, '/');
  await fsp.writeFile(storage.resolve(relPath), file.buffer);
  return { stored, relPath };
}

// ── List ────────────────────────────────────────────────────────────────────

router.get('/', asyncRoute(async (req, res) => {
  const q = trim(req.query.q).slice(0, 80);
  const pubFilter = req.query.published; // '', '1', '0'
  const productId = toId(req.query.product);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);

  const where = [];
  const params = [];
  if (q) {
    where.push('(b.batch_key LIKE ? OR p.name LIKE ?)');
    params.push(`%${batchKey(q)}%`, `%${q}%`);
  }
  if (pubFilter === '1' || pubFilter === '0') { where.push('b.is_published = ?'); params.push(Number(pubFilter)); }
  if (productId) { where.push('b.product_id = ?'); params.push(productId); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { total } = await db.one(
    `SELECT COUNT(*) AS total FROM batches b LEFT JOIN products p ON p.id = b.product_id ${whereSql}`,
    params
  );
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);
  const offset = (current - 1) * PAGE_SIZE;

  const batches = await db.query(
    `SELECT b.id, b.batch_code, b.is_published, b.created_at,
            p.name AS product_name,
            (SELECT COUNT(*) FROM coa_files f WHERE f.batch_id = b.id) AS files
       FROM batches b
       LEFT JOIN products p ON p.id = b.product_id
       ${whereSql}
      ORDER BY b.updated_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params
  );

  return res.render('admin/batches', {
    title: 'Batches — Super Feels COA',
    pageHeading: 'Batches',
    batches,
    products: await loadProducts(),
    q,
    pubFilter: pubFilter || '',
    productId: productId || '',
    page: current,
    pages,
    total,
  });
}));

// ── New ─────────────────────────────────────────────────────────────────────

router.get('/new', asyncRoute(async (req, res) => {
  // Publish starts ticked: the PDF is the whole report, so a batch saved with
  // one is ready for customers the moment it exists.
  const values = { is_published: 1, product_id: toId(req.query.product) };
  return res.render('admin/batch-form', {
    title: 'New batch — Super Feels COA',
    pageHeading: 'New batch',
    batch: values,
    values,
    errors: {},
    products: await loadProducts(),
    isNew: true,
  });
}));

function validateBatch(body) {
  const values = {
    batch_code: trim(body.batch_code).slice(0, 80),
    product_id: toId(body.product_id),
    notes: trim(body.notes),
    is_published: body.is_published ? 1 : 0,
  };
  const errors = {};
  if (!values.batch_code) errors.batch_code = 'Enter the batch number this report belongs to.';
  else if (!batchKey(values.batch_code)) errors.batch_code = 'That code has no letters or digits.';
  return { values, errors };
}

/** The checks that need the database: a clashing code, a vanished product. */
async function checkBatch(values, errors, batchId = 0) {
  const key = batchKey(values.batch_code);
  if (!errors.batch_code && key) {
    // The key, not the display code, is what collides — so tell the operator
    // which existing code it collides with, since it may look different.
    const clash = await db.one('SELECT id, batch_code FROM batches WHERE batch_key = ? AND id <> ?', [key, batchId]);
    if (clash) errors.batch_code = `That resolves to the same code as an existing batch (${clash.batch_code}).`;
  }
  if (values.product_id) {
    const product = await db.one('SELECT id FROM products WHERE id = ?', [values.product_id]);
    if (!product) errors.product_id = 'That product no longer exists. Choose another, or none.';
  }
}

router.post('/new', pdfFields([{ name: 'report', maxCount: 1 }]), asyncRoute(async (req, res) => {
  const { values, errors } = validateBatch(req.body);
  await checkBatch(values, errors);

  const file = req.files && req.files.report ? req.files.report[0] : null;
  if (!file) {
    errors.report = 'Choose the lab report PDF for this batch.';
  } else if (!isPdf(file.buffer)) {
    errors.report = `${file.originalname} is not a readable PDF.`;
  } else if (Object.keys(errors).length) {
    // A browser never refills a file input, so say so rather than leave the
    // operator thinking the PDF is still attached.
    errors.report = 'Choose the PDF again — it is not kept while the form has errors.';
  }

  if (Object.keys(errors).length) {
    return res.status(422).render('admin/batch-form', {
      title: 'New batch — Super Feels COA',
      pageHeading: 'New batch',
      batch: values,
      values,
      errors,
      products: await loadProducts(),
      isNew: true,
    });
  }

  // The batch and its report are one save — both rows or neither — so there is
  // never a live batch with nothing to show.
  const saved = await saveReport(file);
  let id;
  try {
    id = await db.transaction(async (conn) => {
      const [batch] = await conn.execute(
        'INSERT INTO batches (product_id, batch_code, batch_key, is_published) VALUES (?, ?, ?, ?)',
        [values.product_id, values.batch_code, batchKey(values.batch_code), values.is_published]
      );
      await conn.execute(
        `INSERT INTO coa_files (batch_id, original_filename, stored_filename, file_path, mime_type, file_size, is_primary)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [batch.insertId, file.originalname.slice(0, 255), saved.stored, saved.relPath, file.mimetype, file.size]
      );
      return batch.insertId;
    });
  } catch (err) {
    // The rows did not commit, so nothing refers to the file.
    await storage.remove(saved.relPath);
    throw err;
  }

  await activity.record(req, {
    action: 'batch.create', entity: 'batch', entityId: id,
    detail: `${values.batch_code} (${file.originalname})`,
  });
  if (values.is_published) {
    await activity.record(req, { action: 'batch.publish', entity: 'batch', entityId: id, detail: values.batch_code });
  }
  log.info('batch created with report', { batchId: id, published: Boolean(values.is_published) });
  req.flash('ok', values.is_published
    ? `Batch ${values.batch_code} saved and live.`
    : `Batch ${values.batch_code} saved as a draft.`);
  return res.redirect(`/admin/batches/${id}`);
}));

// ── Edit ────────────────────────────────────────────────────────────────────

async function renderEdit(res, batch, { values, errors, status = 200 }) {
  const [products, files] = await Promise.all([loadProducts(), batchesLib.loadFiles(batch.id)]);
  return res.status(status).render('admin/batch-form', {
    title: `Batch ${batch.batch_code} — Super Feels COA`,
    pageHeading: `Batch ${batch.batch_code}`,
    batch,
    values,
    errors,
    products,
    files,
    isNew: false,
  });
}

router.get('/:id', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const batch = id ? await batchesLib.findById(id) : null;
  if (!batch) return next();
  return renderEdit(res, batch, { values: batch, errors: {} });
}));

router.post('/:id', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const batch = id ? await batchesLib.findById(id) : null;
  if (!batch) return next();

  const { values, errors } = validateBatch(req.body);
  await checkBatch(values, errors, id);

  // A live batch needs a report to show. The PDFs are managed further down the
  // same page but saved separately, so this checks what is already stored.
  if (values.is_published) {
    const { n } = await db.one('SELECT COUNT(*) AS n FROM coa_files WHERE batch_id = ?', [id]);
    if (Number(n) === 0) {
      errors.is_published = 'This batch has no lab report yet. Upload the PDF below, then publish.';
    }
  }

  if (Object.keys(errors).length) return renderEdit(res, batch, { values, errors, status: 422 });

  const wasPublished = batch.is_published;

  await db.query(
    'UPDATE batches SET product_id = ?, batch_code = ?, batch_key = ?, notes = ?, is_published = ? WHERE id = ?',
    [values.product_id, values.batch_code, batchKey(values.batch_code), values.notes || null, values.is_published, id]
  );

  // Publishing is the state change worth its own audit line — it is the moment
  // a report becomes something the public can read.
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

// ── Report PDFs ─────────────────────────────────────────────────────────────
// The first PDF arrives with the batch. These add a corrected report or a
// supporting document afterwards.

router.post('/:id/files', pdfFields([{ name: 'reports', maxCount: 6 }]), asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const batch = id ? await db.one('SELECT id, batch_code FROM batches WHERE id = ?', [id]) : null;
  if (!batch) return next();

  const uploaded = (req.files && req.files.reports) || [];
  if (!uploaded.length) {
    req.flash('error', 'No PDF was chosen.');
    return res.redirect(`/admin/batches/${id}#reports`);
  }
  const unreadable = uploaded.find((f) => !isPdf(f.buffer));
  if (unreadable) {
    req.flash('error', `${unreadable.originalname} is not a readable PDF. Nothing was uploaded.`);
    return res.redirect(`/admin/batches/${id}#reports`);
  }

  const existing = await db.one('SELECT COUNT(*) AS n FROM coa_files WHERE batch_id = ?', [id]);
  let isFirst = Number(existing.n) === 0;
  const label = trim(req.body.label).slice(0, 120);

  for (const file of uploaded) {
    const saved = await saveReport(file);
    await db.query(
      `INSERT INTO coa_files (batch_id, original_filename, stored_filename, file_path, mime_type, file_size, label, is_primary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, file.originalname.slice(0, 255), saved.stored, saved.relPath, file.mimetype,
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
  await activity.record(req, { action: 'batch.file_delete', entity: 'batch', entityId: id, detail: file.original_filename });

  const nextFile = await db.one('SELECT id FROM coa_files WHERE batch_id = ? ORDER BY sort_order, id LIMIT 1', [id]);

  // If the deleted file was the primary, promote the next one so the batch does
  // not silently end up with files but no primary.
  if (file.is_primary && nextFile) {
    await db.query('UPDATE coa_files SET is_primary = 1 WHERE id = ?', [nextFile.id]);
  }

  // A live batch with no report left would show customers an empty page, so
  // it comes down with its last PDF.
  if (!nextFile) {
    const batch = await db.one('SELECT batch_code, is_published FROM batches WHERE id = ?', [id]);
    if (batch && batch.is_published) {
      await db.query('UPDATE batches SET is_published = 0 WHERE id = ?', [id]);
      await activity.record(req, {
        action: 'batch.unpublish', entity: 'batch', entityId: id,
        detail: `${batch.batch_code} (last report removed)`,
      });
      req.flash('ok', 'Report removed. It was the only report for this batch, so the batch is now a draft.');
      return res.redirect(`/admin/batches/${id}#reports`);
    }
  }

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

module.exports = router;
