'use strict';

const express = require('express');
const db = require('../../config/db');
const { asyncRoute } = require('../../middleware/errors');
const { trim } = require('../../lib/validate');

const router = express.Router();

const PAGE_SIZE = 50;

router.get('/', asyncRoute(async (req, res) => {
  const q = trim(req.query.q).slice(0, 80);
  const entity = trim(req.query.entity).slice(0, 60);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);

  const where = [];
  const params = [];
  if (entity) { where.push('a.entity = ?'); params.push(entity); }
  if (q) { where.push('(a.action LIKE ? OR a.detail LIKE ? OR ad.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { total } = await db.one(
    `SELECT COUNT(*) AS total FROM activity_log a LEFT JOIN admins ad ON ad.id = a.admin_id ${whereSql}`,
    params
  );
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);
  const offset = (current - 1) * PAGE_SIZE;

  const rows = await db.query(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.ip_address, a.created_at,
            ad.name AS admin_name
       FROM activity_log a
       LEFT JOIN admins ad ON ad.id = a.admin_id
       ${whereSql}
      ORDER BY a.created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params
  );

  const entities = await db.query('SELECT DISTINCT entity FROM activity_log ORDER BY entity');

  return res.render('admin/activity', {
    title: 'Activity — Super Feels COA',
    pageHeading: 'Activity log',
    rows, entities, q, entity,
    page: current, pages, total,
  });
}));

module.exports = router;
