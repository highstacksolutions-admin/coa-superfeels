'use strict';

const express = require('express');
const db = require('../../config/db');
const activity = require('../../lib/activity');
const { asyncRoute } = require('../../middleware/errors');
const { trim, toId, slugify, isEmail, normaliseEmail } = require('../../lib/validate');

const router = express.Router();

function validate(body) {
  const values = {
    name: trim(body.name).slice(0, 160),
    slug: slugify(body.slug || body.name),
    license_no: trim(body.license_no).slice(0, 80),
    accreditation: trim(body.accreditation).slice(0, 160),
    website: trim(body.website).slice(0, 255),
    contact_email: normaliseEmail(body.contact_email).slice(0, 190),
    phone: trim(body.phone).slice(0, 40),
    address: trim(body.address).slice(0, 255),
    notes: trim(body.notes),
    is_active: body.is_active ? 1 : 0,
  };
  const errors = {};
  if (!values.name) errors.name = 'Give the lab a name.';
  if (!values.slug) errors.slug = 'That name does not produce a usable slug.';
  if (values.contact_email && !isEmail(values.contact_email)) errors.contact_email = 'That is not a valid email address.';
  // A website typed without a scheme becomes a same-page relative link, which
  // is a confusing dead end on the report. Normalise rather than reject.
  if (values.website && !/^https?:\/\//i.test(values.website)) {
    values.website = `https://${values.website}`;
  }
  return { values, errors };
}

router.get('/', asyncRoute(async (req, res) => {
  const labs = await db.query(
    `SELECT l.*, (SELECT COUNT(*) FROM batches b WHERE b.lab_id = l.id) AS batch_count
       FROM labs l ORDER BY l.name`
  );
  return res.render('admin/labs', {
    title: 'Labs — Super Feels COA',
    pageHeading: 'Testing labs',
    labs,
  });
}));

router.get('/new', (req, res) => {
  return res.render('admin/lab-form', {
    title: 'New lab — Super Feels COA',
    pageHeading: 'New lab',
    lab: { is_active: 1 },
    values: {},
    errors: {},
    isNew: true,
  });
});

router.get('/:id', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const lab = id ? await db.one('SELECT * FROM labs WHERE id = ?', [id]) : null;
  if (!lab) return next();
  return res.render('admin/lab-form', {
    title: `${lab.name} — Super Feels COA`,
    pageHeading: 'Edit lab',
    lab,
    values: lab,
    errors: {},
    isNew: false,
  });
}));

router.post('/new', asyncRoute(async (req, res) => {
  const { values, errors } = validate(req.body);
  if (!errors.slug) {
    const clash = await db.one('SELECT id FROM labs WHERE slug = ?', [values.slug]);
    if (clash) errors.slug = 'Another lab already uses that slug.';
  }
  if (Object.keys(errors).length) {
    return res.status(422).render('admin/lab-form', {
      title: 'New lab — Super Feels COA', pageHeading: 'New lab',
      lab: values, values, errors, isNew: true,
    });
  }
  const result = await db.query(
    `INSERT INTO labs (name, slug, license_no, accreditation, website, contact_email, phone, address, notes, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [values.name, values.slug, values.license_no || null, values.accreditation || null,
     values.website || null, values.contact_email || null, values.phone || null,
     values.address || null, values.notes || null, values.is_active]
  );
  await activity.record(req, { action: 'lab.create', entity: 'lab', entityId: result.insertId, detail: values.name });
  req.flash('ok', `${values.name} added.`);
  return res.redirect('/admin/labs');
}));

router.post('/:id', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const lab = id ? await db.one('SELECT * FROM labs WHERE id = ?', [id]) : null;
  if (!lab) return next();

  const { values, errors } = validate(req.body);
  if (!errors.slug) {
    const clash = await db.one('SELECT id FROM labs WHERE slug = ? AND id <> ?', [values.slug, id]);
    if (clash) errors.slug = 'Another lab already uses that slug.';
  }
  if (Object.keys(errors).length) {
    return res.status(422).render('admin/lab-form', {
      title: `${lab.name} — Super Feels COA`, pageHeading: 'Edit lab',
      lab, values: { ...values, id }, errors, isNew: false,
    });
  }
  await db.query(
    `UPDATE labs SET name = ?, slug = ?, license_no = ?, accreditation = ?, website = ?,
            contact_email = ?, phone = ?, address = ?, notes = ?, is_active = ? WHERE id = ?`,
    [values.name, values.slug, values.license_no || null, values.accreditation || null,
     values.website || null, values.contact_email || null, values.phone || null,
     values.address || null, values.notes || null, values.is_active, id]
  );
  await activity.record(req, { action: 'lab.update', entity: 'lab', entityId: id, detail: values.name });
  req.flash('ok', `${values.name} saved.`);
  return res.redirect('/admin/labs');
}));

router.post('/:id/delete', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const lab = id ? await db.one('SELECT * FROM labs WHERE id = ?', [id]) : null;
  if (!lab) return next();

  // The FK is ON DELETE SET NULL, so batches survive — but they lose their lab
  // attribution silently, which on a compliance page is worth a word rather
  // than a surprise. Deactivating keeps the attribution and only hides the lab
  // from the new-batch dropdown.
  const { n } = await db.one('SELECT COUNT(*) AS n FROM batches WHERE lab_id = ?', [id]);
  if (Number(n) > 0) {
    req.flash('error', `${lab.name} is attached to ${n} batch${Number(n) === 1 ? '' : 'es'}. Deactivate it instead — deleting would strip the lab name from their reports.`);
    return res.redirect('/admin/labs');
  }

  await db.query('DELETE FROM labs WHERE id = ?', [id]);
  await activity.record(req, { action: 'lab.delete', entity: 'lab', entityId: id, detail: lab.name });
  req.flash('ok', `${lab.name} deleted.`);
  return res.redirect('/admin/labs');
}));

module.exports = router;
