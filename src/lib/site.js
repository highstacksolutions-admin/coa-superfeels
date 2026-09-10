'use strict';

const db = require('../config/db');
const log = require('./logger');

// Two things every public page needs and neither of which changes between
// requests: the operator-editable copy from `settings`, and the list of
// published content pages for the navigation.
//
// Queried once and held, rather than joined onto every request. A batch lookup
// is two queries; adding two more for the header would double the cost of the
// only page that matters. The cache is invalidated explicitly when the admin
// saves, so an edit is visible immediately rather than after a TTL — a
// "why has my change not appeared" that a timeout would have caused.

let cache = null;

async function load() {
  const [settingRows, pageRows] = await Promise.all([
    db.query('SELECT name, value FROM settings'),
    db.query(
      `SELECT slug, title FROM content_pages
        WHERE is_published = 1 AND show_in_nav = 1
        ORDER BY sort_order, id`
    ),
  ]);

  const settings = {};
  for (const row of settingRows) settings[row.name] = row.value;

  cache = { settings, navPages: pageRows };
  return cache;
}

/**
 * Never throws. A failed settings read must not take the lookup page down with
 * it, so the caller gets empty defaults and the page renders without the
 * operator's custom copy.
 */
async function get() {
  if (cache) return cache;
  try {
    return await load();
  } catch (err) {
    log.error('site settings could not be loaded', { error: err.message });
    return { settings: {}, navPages: [] };
  }
}

function invalidate() {
  cache = null;
}

module.exports = { get, invalidate };
