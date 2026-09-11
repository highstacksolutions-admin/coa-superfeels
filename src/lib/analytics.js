'use strict';

const db = require('../config/db');
const log = require('./logger');

// What the operator actually wants to know about this site is not "how many
// visits" — it is which batch codes people are typing and which of those found
// nothing. A code that fails repeatedly means a label printed wrong, a batch
// nobody published, or a counterfeit. That is the report this module exists to
// make possible, so a failed lookup is recorded with as much care as a hit.

const UA_MAX = 255;
const REF_MAX = 255;

/**
 * A positive integer safe to write into SQL text.
 *
 * `LIMIT ?` and `INTERVAL ? DAY` are not portable as prepared-statement
 * placeholders — MySQL and MariaDB disagree about which of them can be bound,
 * and mysql2's `execute` path turns the disagreement into "Incorrect arguments
 * to EXECUTE" at runtime rather than at review time. These two positions take
 * a coerced integer instead. Nothing else in this file interpolates.
 */
function int(v, fallback, max = 100000) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * Record one batch lookup. `batchId` is null when nothing matched.
 *
 * Never throws and never blocks the response: a lookup that found the report
 * must not fail because the analytics insert did. Callers do not await it.
 */
function recordLookup(req, { query, batchId = null, source = 'form' }) {
  const params = [
    String(query || '').slice(0, 80),
    batchId,
    batchId ? 1 : 0,
    source,
    (req.ip || '').slice(0, 45) || null,
    (req.get('user-agent') || '').slice(0, UA_MAX) || null,
    (req.get('referer') || '').slice(0, REF_MAX) || null,
  ];

  db.query(
    `INSERT INTO lookups (query, batch_id, found, source, ip_address, user_agent, referrer)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params
  ).catch((err) => log.error('lookup not recorded', { query, error: err.message }));
}

/** Record one report download. Same fire-and-forget contract as above. */
function recordDownload(req, { coaFileId, batchId }) {
  db.query(
    `INSERT INTO coa_downloads (coa_file_id, batch_id, ip_address, user_agent, referrer)
     VALUES (?, ?, ?, ?, ?)`,
    [
      coaFileId,
      batchId,
      (req.ip || '').slice(0, 45) || null,
      (req.get('user-agent') || '').slice(0, UA_MAX) || null,
      (req.get('referer') || '').slice(0, REF_MAX) || null,
    ]
  ).catch((err) => log.error('download not recorded', { coaFileId, error: err.message }));
}

/**
 * Lookups per day for the last `days` days, with zero-filled gaps.
 *
 * The zero-filling is the point. A GROUP BY over the table returns only days
 * that had traffic, so a chart drawn straight from it silently closes the gaps
 * and turns a quiet week into a flat line at the wrong height — the bars stop
 * being comparable and a dead weekend looks like a busy one.
 */
async function lookupsByDay(days = 30) {
  const span = int(days, 30, 365);
  const rows = await db.query(
    `SELECT DATE(created_at) AS d,
            COUNT(*) AS total,
            SUM(found = 1) AS found,
            SUM(found = 0) AS missed
       FROM lookups
      WHERE created_at >= (CURDATE() - INTERVAL ${span - 1} DAY)
      GROUP BY DATE(created_at)`
  );

  const byDay = new Map(rows.map((r) => [new Date(r.d).toISOString().slice(0, 10), r]));
  const out = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const row = byDay.get(key);
    out.push({
      day: key,
      total: row ? Number(row.total) : 0,
      found: row ? Number(row.found) : 0,
      missed: row ? Number(row.missed) : 0,
    });
  }
  return out;
}

/** Headline counts for the dashboard tiles. */
function summary() {
  return db.one(
    `SELECT
       (SELECT COUNT(*) FROM lookups)                                              AS lookups_all,
       (SELECT COUNT(*) FROM lookups WHERE created_at >= (CURDATE() - INTERVAL 29 DAY)) AS lookups_30d,
       (SELECT COUNT(*) FROM lookups WHERE DATE(created_at) = CURDATE())           AS lookups_today,
       (SELECT COUNT(*) FROM lookups WHERE found = 0 AND created_at >= (CURDATE() - INTERVAL 29 DAY)) AS missed_30d,
       (SELECT COUNT(*) FROM coa_downloads WHERE created_at >= (CURDATE() - INTERVAL 29 DAY)) AS downloads_30d,
       (SELECT COUNT(*) FROM coa_downloads)                                        AS downloads_all,
       (SELECT COUNT(*) FROM batches)                                              AS batches,
       (SELECT COUNT(*) FROM batches WHERE is_published = 1)                       AS batches_live,
       (SELECT COUNT(*) FROM products)                                             AS products,
       (SELECT COUNT(*) FROM enquiries WHERE status = 'new')                        AS enquiries_new`
  );
}

/** The batches people are actually looking up. */
function topBatches(days = 30, limit = 10) {
  return db.query(
    `SELECT b.id, b.batch_code, p.name AS product_name, COUNT(l.id) AS n
       FROM lookups l
       JOIN batches b  ON b.id = l.batch_id
       LEFT JOIN products p ON p.id = b.product_id
      WHERE l.created_at >= (CURDATE() - INTERVAL ${int(days, 30, 365) - 1} DAY) AND l.found = 1
      GROUP BY b.id, b.batch_code, p.name
      ORDER BY n DESC
      LIMIT ${int(limit, 10, 200)}`
  );
}

/**
 * Codes that found nothing, most-attempted first. The most actionable list in
 * the admin: every row is either a label that does not match the database or a
 * batch that was never published.
 */
function missedQueries(days = 30, limit = 20) {
  return db.query(
    `SELECT query, COUNT(*) AS n, MAX(created_at) AS last_seen
       FROM lookups
      WHERE found = 0 AND created_at >= (CURDATE() - INTERVAL ${int(days, 30, 365) - 1} DAY) AND query <> ''
      GROUP BY query
      ORDER BY n DESC, last_seen DESC
      LIMIT ${int(limit, 20, 200)}`
  );
}

module.exports = {
  recordLookup,
  recordDownload,
  lookupsByDay,
  summary,
  topBatches,
  missedQueries,
};
