'use strict';

const express = require('express');
const db = require('../../config/db');
const site = require('../../lib/site');
const activity = require('../../lib/activity');
const { asyncRoute } = require('../../middleware/errors');
const { trim, toId, slugify } = require('../../lib/validate');

const router = express.Router();

// Slugs the router table already claims. A content page on one of these would
// simply never be reached (see routes/pages.js, mounted last), so the save is
// refused rather than allowed to create an invisible page.
const RESERVED = new Set(['', 'admin', 'contact', 'coa', 'batch', 'download', 'lookup', 'healthz', 'img', 'css', 'js', 'fonts', 'uploads', 'thumbs']);

router.get('/', asyncRoute(async (req, res) => {
  const pages = await db.query(
    'SELECT id, slug, title, is_published, show_in_nav, sort_order, updated_at FROM content_pages ORDER BY sort_order, id'
  );
  const settings = await db.query('SELECT name, value FROM settings ORDER BY name');
  return res.render('admin/content', {
    title: 'Pages — Super Feels COA',
    pageHeading: 'Pages & copy',
    pages,
    settings,
  });
}));

router.get('/new', (req, res) => {
  return res.render('admin/content-form', {
    title: 'New page — Super Feels COA',
    pageHeading: 'New page',
    page: { is_published: 1, show_in_nav: 1, sort_order: 0 },
    values: {},
    errors: {},
    isNew: true,
  });
});

router.get('/page/:id', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const page = id ? await db.one('SELECT * FROM content_pages WHERE id = ?', [id]) : null;
  if (!page) return next();
  return res.render('admin/content-form', {
    title: `${page.title} — Super Feels COA`,
    pageHeading: 'Edit page',
    page,
    values: page,
    errors: {},
    isNew: false,
  });
}));

function validate(body) {
  const values = {
    title: trim(body.title).slice(0, 200),
    slug: slugify(body.slug || body.title),
    meta_description: trim(body.meta_description).slice(0, 255),
    body: typeof body.body === 'string' ? body.body : '',
    is_published: body.is_published ? 1 : 0,
    show_in_nav: body.show_in_nav ? 1 : 0,
    sort_order: Number.parseInt(body.sort_order, 10) || 0,
  };
  const errors = {};
  if (!values.title) errors.title = 'Give the page a title.';
  if (!values.slug) errors.slug = 'That title does not produce a usable slug — set one by hand.';
  else if (RESERVED.has(values.slug)) errors.slug = `"${values.slug}" is reserved by the site and cannot be a page slug.`;
  if (!values.body.trim()) errors.body = 'A page needs some content.';
  return { values, errors };
}

router.post('/new', asyncRoute(async (req, res) => {
  const { values, errors } = validate(req.body);
  if (!errors.slug) {
    const clash = await db.one('SELECT id FROM content_pages WHERE slug = ?', [values.slug]);
    if (clash) errors.slug = 'Another page already uses that slug.';
  }
  if (Object.keys(errors).length) {
    return res.status(422).render('admin/content-form', {
      title: 'New page — Super Feels COA', pageHeading: 'New page',
      page: values, values, errors, isNew: true,
    });
  }
  const result = await db.query(
    `INSERT INTO content_pages (slug, title, meta_description, body, is_published, show_in_nav, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [values.slug, values.title, values.meta_description || null, values.body,
     values.is_published, values.show_in_nav, values.sort_order]
  );
  site.invalidate();
  await activity.record(req, { action: 'page.create', entity: 'page', entityId: result.insertId, detail: values.title });
  req.flash('ok', `${values.title} created.`);
  return res.redirect('/admin/content');
}));

router.post('/page/:id', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const page = id ? await db.one('SELECT * FROM content_pages WHERE id = ?', [id]) : null;
  if (!page) return next();

  const { values, errors } = validate(req.body);
  if (!errors.slug) {
    const clash = await db.one('SELECT id FROM content_pages WHERE slug = ? AND id <> ?', [values.slug, id]);
    if (clash) errors.slug = 'Another page already uses that slug.';
  }
  if (Object.keys(errors).length) {
    return res.status(422).render('admin/content-form', {
      title: `${page.title} — Super Feels COA`, pageHeading: 'Edit page',
      page, values: { ...values, id }, errors, isNew: false,
    });
  }
  await db.query(
    `UPDATE content_pages SET slug = ?, title = ?, meta_description = ?, body = ?,
            is_published = ?, show_in_nav = ?, sort_order = ? WHERE id = ?`,
    [values.slug, values.title, values.meta_description || null, values.body,
     values.is_published, values.show_in_nav, values.sort_order, id]
  );
  site.invalidate();
  await activity.record(req, { action: 'page.update', entity: 'page', entityId: id, detail: values.title });
  req.flash('ok', `${values.title} saved.`);
  return res.redirect('/admin/content');
}));

router.post('/page/:id/delete', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const page = id ? await db.one('SELECT * FROM content_pages WHERE id = ?', [id]) : null;
  if (!page) return next();
  await db.query('DELETE FROM content_pages WHERE id = ?', [id]);
  site.invalidate();
  await activity.record(req, { action: 'page.delete', entity: 'page', entityId: id, detail: page.title });
  req.flash('ok', `${page.title} deleted.`);
  return res.redirect('/admin/content');
}));

// The editable copy on the public pages: tagline, lookup help, contact intro.
router.post('/settings', asyncRoute(async (req, res) => {
  const fields = ['site_tagline', 'lookup_help', 'contact_intro'];
  await db.transaction(async (conn) => {
    for (const name of fields) {
      if (typeof req.body[name] !== 'string') continue;
      const value = trim(req.body[name]).slice(0, 2000);
      await conn.execute(
        'INSERT INTO settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [name, value]
      );
    }
  });
  site.invalidate();
  await activity.record(req, { action: 'settings.update', entity: 'settings', detail: 'public copy' });
  req.flash('ok', 'Copy saved.');
  return res.redirect('/admin/content');
}));

module.exports = router;
