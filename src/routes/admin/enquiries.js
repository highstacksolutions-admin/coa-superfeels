'use strict';

const express = require('express');
const db = require('../../config/db');
const activity = require('../../lib/activity');
const { asyncRoute } = require('../../middleware/errors');
const { trim, toId } = require('../../lib/validate');

const router = express.Router();

const PAGE_SIZE = 25;
const STATUSES = ['new', 'read', 'resolved'];

router.get('/', asyncRoute(async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : '';
  const q = trim(req.query.q).slice(0, 80);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);

  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (q) {
    where.push('(name LIKE ? OR email LIKE ? OR batch_code LIKE ? OR subject LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { total } = await db.one(`SELECT COUNT(*) AS total FROM enquiries ${whereSql}`, params);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);
  const offset = (current - 1) * PAGE_SIZE;

  const enquiries = await db.query(
    `SELECT id, name, email, batch_code, subject, LEFT(message, 160) AS preview, status, created_at
       FROM enquiries ${whereSql}
      ORDER BY (status = 'new') DESC, created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params
  );

  const counts = await db.one(
    `SELECT SUM(status='new') AS new_, SUM(status='read') AS read_, SUM(status='resolved') AS resolved_
       FROM enquiries`
  );

  return res.render('admin/enquiries', {
    title: 'Enquiries — Super Feels COA',
    pageHeading: 'Enquiries',
    enquiries, counts, status, q,
    page: current, pages, total,
  });
}));

router.get('/:id', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const enquiry = id ? await db.one('SELECT * FROM enquiries WHERE id = ?', [id]) : null;
  if (!enquiry) return next();

  // Opening a new enquiry marks it read. No audit line for that — it is not a
  // decision, just an acknowledgement, and logging every open would bury the
  // resolves that do matter.
  if (enquiry.status === 'new') {
    await db.query("UPDATE enquiries SET status = 'read' WHERE id = ?", [id]);
    enquiry.status = 'read';
  }

  // If the batch code they gave actually resolves to something, link straight
  // to it — the operator's first question is always "is this a real batch?".
  let matchedBatch = null;
  if (enquiry.batch_code) {
    const { batchKey } = require('../../lib/validate');
    matchedBatch = await db.one(
      'SELECT id, batch_code, is_published FROM batches WHERE batch_key = ?',
      [batchKey(enquiry.batch_code)]
    );
  }

  return res.render('admin/enquiry', {
    title: `Enquiry from ${enquiry.name} — Super Feels COA`,
    pageHeading: 'Enquiry',
    enquiry, matchedBatch,
  });
}));

router.post('/:id/status', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const status = STATUSES.includes(req.body.status) ? req.body.status : null;
  if (!id || !status) return next();

  const resolved = status === 'resolved';
  await db.query(
    `UPDATE enquiries SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?`,
    [status, resolved ? new Date() : null, resolved ? req.admin.id : null, id]
  );
  await activity.record(req, { action: `enquiry.${status}`, entity: 'enquiry', entityId: id });
  req.flash('ok', `Marked ${status}.`);
  return res.redirect(req.body.back === 'list' ? '/admin/enquiries' : `/admin/enquiries/${id}`);
}));

router.post('/:id/delete', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const enquiry = id ? await db.one('SELECT id, name FROM enquiries WHERE id = ?', [id]) : null;
  if (!enquiry) return next();
  await db.query('DELETE FROM enquiries WHERE id = ?', [id]);
  await activity.record(req, { action: 'enquiry.delete', entity: 'enquiry', entityId: id, detail: enquiry.name });
  req.flash('ok', 'Enquiry deleted.');
  return res.redirect('/admin/enquiries');
}));

module.exports = router;
