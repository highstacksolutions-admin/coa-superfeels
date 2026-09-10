'use strict';

const express = require('express');
const analytics = require('../../lib/analytics');
const { asyncRoute } = require('../../middleware/errors');

const router = express.Router();

router.get('/', asyncRoute(async (req, res) => {
  // The range selector is three fixed windows rather than a date picker: the
  // only questions this data answers are "how are we doing lately" and "over
  // the quarter", and a free date range invites comparing a partial week to a
  // full one and reading noise as a trend.
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;

  const [summary, chart, topBatches, missed] = await Promise.all([
    analytics.summary(),
    analytics.lookupsByDay(days),
    analytics.topBatches(days, 15),
    analytics.missedQueries(days, 25),
  ]);

  return res.render('admin/analytics', {
    title: 'Analytics — Super Feels COA',
    pageHeading: 'Analytics',
    summary, chart, topBatches, missed, days,
  });
}));

module.exports = router;
