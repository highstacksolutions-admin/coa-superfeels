'use strict';

const express = require('express');
const sharp = require('sharp');
const db = require('../../config/db');
const log = require('../../lib/logger');
const storage = require('../../lib/storage');
const activity = require('../../lib/activity');
const { singleImage } = require('../../middleware/upload');
const { asyncRoute } = require('../../middleware/errors');
const { trim, toId, slugify } = require('../../lib/validate');

const router = express.Router();

const IMAGE_MAX_WIDTH = 1200;

function validate(body) {
  const values = {
    name: trim(body.name).slice(0, 200),
    slug: slugify(body.slug || body.name),
    sku: trim(body.sku).slice(0, 80),
    category: trim(body.category).slice(0, 80),
    size_label: trim(body.size_label).slice(0, 80),
    description: trim(body.description),
    sort_order: Number.parseInt(body.sort_order, 10) || 0,
    is_published: body.is_published ? 1 : 0,
  };
  const errors = {};
  if (!values.name) errors.name = 'Give the product a name.';
  if (!values.slug) errors.slug = 'That name does not produce a usable slug — set one by hand.';
  return { values, errors };
}

/**
 * Product photography is resized on the way in rather than served at whatever
 * dimensions the operator happened to export.
 *
 * The lookup page shows twelve of these at roughly 200px wide, and a phone on a
 * shop's wifi is the common case — twelve untouched 4000px exports is tens of
 * megabytes for a strip of thumbnails. Re-encoding once at upload costs nothing
 * afterwards.
 */
async function processImage(file) {
  const output = await sharp(file.buffer)
    .rotate() // honour EXIF orientation, or phone photos arrive sideways
    .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  return storage.savePublicImage(output, `${slugify(file.originalname) || 'product'}.webp`);
}

// ── List ────────────────────────────────────────────────────────────────────

router.get('/', asyncRoute(async (req, res) => {
  const q = trim(req.query.q).slice(0, 80);
  const params = [];
  let where = '';
  if (q) {
    where = 'WHERE (p.name LIKE ? OR p.sku LIKE ? OR p.category LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const products = await db.query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM batches b WHERE b.product_id = p.id) AS batch_count,
            (SELECT COUNT(*) FROM batches b WHERE b.product_id = p.id AND b.is_published = 1) AS live_count
       FROM products p
       ${where}
      ORDER BY p.sort_order, p.name`,
    params
  );

  return res.render('admin/products', {
    title: 'Products — Super Feels COA',
    pageHeading: 'Products',
    products,
    q,
  });
}));

// ── New and edit ────────────────────────────────────────────────────────────

router.get('/new', (req, res) => {
  return res.render('admin/product-form', {
    title: 'New product — Super Feels COA',
    pageHeading: 'New product',
    product: { is_published: 1, sort_order: 0 },
    values: {},
    errors: {},
    isNew: true,
  });
});

router.get('/:id', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const product = id ? await db.one('SELECT * FROM products WHERE id = ?', [id]) : null;
  if (!product) return next();

  const batches = await db.query(
    `SELECT id, batch_code, is_published, created_at
       FROM batches WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT 20`,
    [id]
  );

  return res.render('admin/product-form', {
    title: `${product.name} — Super Feels COA`,
    pageHeading: 'Edit product',
    product,
    values: product,
    errors: {},
    batches,
    isNew: false,
  });
}));

router.post('/new', singleImage('image'), asyncRoute(async (req, res) => {
  const { values, errors } = validate(req.body);

  const clash = values.slug
    ? await db.one('SELECT id FROM products WHERE slug = ?', [values.slug])
    : null;
  if (clash) errors.slug = 'Another product already uses that slug.';

  if (Object.keys(errors).length) {
    return res.status(422).render('admin/product-form', {
      title: 'New product — Super Feels COA',
      pageHeading: 'New product',
      product: values,
      values,
      errors,
      isNew: true,
    });
  }

  const imagePath = req.file ? await processImage(req.file) : null;

  const result = await db.query(
    `INSERT INTO products (name, slug, sku, category, size_label, description, image_path, sort_order, is_published)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.name, values.slug, values.sku || null, values.category,
      values.size_label || null, values.description || null, imagePath,
      values.sort_order, values.is_published,
    ]
  );

  await activity.record(req, { action: 'product.create', entity: 'product', entityId: result.insertId, detail: values.name });
  req.flash('ok', `${values.name} created.`);
  return res.redirect(`/admin/products/${result.insertId}`);
}));

router.post('/:id', singleImage('image'), asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const product = id ? await db.one('SELECT * FROM products WHERE id = ?', [id]) : null;
  if (!product) return next();

  const { values, errors } = validate(req.body);

  const clash = values.slug
    ? await db.one('SELECT id FROM products WHERE slug = ? AND id <> ?', [values.slug, id])
    : null;
  if (clash) errors.slug = 'Another product already uses that slug.';

  if (Object.keys(errors).length) {
    return res.status(422).render('admin/product-form', {
      title: `${product.name} — Super Feels COA`,
      pageHeading: 'Edit product',
      product,
      values: { ...values, id },
      errors,
      batches: [],
      isNew: false,
    });
  }

  let imagePath = product.image_path;
  if (req.body.remove_image) {
    await storage.removePublicImage(product.image_path);
    imagePath = null;
  }
  if (req.file) {
    const next_ = await processImage(req.file);
    // Only after the replacement is safely written. Removing first would leave
    // the product with no image at all if the re-encode threw.
    if (product.image_path) await storage.removePublicImage(product.image_path);
    imagePath = next_;
  }

  await db.query(
    `UPDATE products SET name = ?, slug = ?, sku = ?, category = ?, size_label = ?,
            description = ?, image_path = ?, sort_order = ?, is_published = ?
      WHERE id = ?`,
    [
      values.name, values.slug, values.sku || null, values.category,
      values.size_label || null, values.description || null, imagePath,
      values.sort_order, values.is_published, id,
    ]
  );

  await activity.record(req, { action: 'product.update', entity: 'product', entityId: id, detail: values.name });
  req.flash('ok', `${values.name} saved.`);
  return res.redirect(`/admin/products/${id}`);
}));

// ── Delete ──────────────────────────────────────────────────────────────────

router.post('/:id/delete', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const product = id ? await db.one('SELECT * FROM products WHERE id = ?', [id]) : null;
  if (!product) return next();

  // The foreign key is ON DELETE RESTRICT, so this would fail at the database
  // anyway — but as a 500 rather than as an explanation. A product with
  // batches is almost always meant to be unpublished, not deleted, because
  // deleting it would orphan reports customers may still be scanning towards.
  const { n } = await db.one('SELECT COUNT(*) AS n FROM batches WHERE product_id = ?', [id]);
  if (Number(n) > 0) {
    req.flash('error', `${product.name} has ${n} batch${Number(n) === 1 ? '' : 'es'}. Unpublish it instead, or delete those batches first.`);
    return res.redirect(`/admin/products/${id}`);
  }

  await db.query('DELETE FROM products WHERE id = ?', [id]);
  if (product.image_path) await storage.removePublicImage(product.image_path);

  await activity.record(req, { action: 'product.delete', entity: 'product', entityId: id, detail: product.name });
  log.warn('product deleted', { adminId: req.admin.id, productId: id, name: product.name });
  req.flash('ok', `${product.name} deleted.`);
  return res.redirect('/admin/products');
}));

module.exports = router;
