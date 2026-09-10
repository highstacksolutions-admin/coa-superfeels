'use strict';

const express = require('express');
const db = require('../config/db');
const { asyncRoute } = require('../middleware/errors');
const { slugify } = require('../lib/validate');

const router = express.Router();

/**
 * The editable content pages, matched on their slug.
 *
 * This router claims any remaining single-segment path, so it is mounted last
 * in app.js — after the lookup, the contact form and the admin. A page whose
 * slug collides with one of those would simply never be reached, which is why
 * the admin refuses to save one (see routes/admin/content.js).
 */
router.get('/:slug', asyncRoute(async (req, res, next) => {
  const slug = slugify(req.params.slug);
  if (!slug) return next();

  const page = await db.one(
    'SELECT slug, title, meta_description, body, updated_at FROM content_pages WHERE slug = ? AND is_published = 1',
    [slug]
  );
  if (!page) return next();

  return res.render('pages/content', {
    title: `${page.title} — Super Feels`,
    description: page.meta_description || undefined,
    page,
  });
}));

module.exports = router;
