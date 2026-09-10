'use strict';

const express = require('express');
const db = require('../../config/db');
const log = require('../../lib/logger');
const passwords = require('../../lib/passwords');
const analytics = require('../../lib/analytics');
const limits = require('../../middleware/rateLimit');
const { asyncRoute } = require('../../middleware/errors');
const { requireAdmin, requireRole, signInAdmin } = require('../../middleware/auth');
const { normaliseEmail, isEmail } = require('../../lib/validate');

const router = express.Router();

// Admin views get the extra stylesheet and never the public header.
router.use((req, res, next) => {
  res.locals.adminCss = true;
  res.locals.adminPath = req.path;
  res.locals.newEnquiries = 0;
  next();
});

// ── Login ───────────────────────────────────────────────────────────────────

function safeAdminNext(value) {
  if (typeof value !== 'string') return '/admin';
  if (!value.startsWith('/admin') || value.startsWith('//')) return '/admin';
  return value;
}

router.get('/login', (req, res) => {
  if (req.admin) return res.redirect('/admin');
  return res.render('admin/login', {
    title: 'Admin sign in — Super Feels COA',
    error: null,
    email: '',
    nextUrl: safeAdminNext(req.query.next),
  });
});

router.post('/login', limits.adminLogin, asyncRoute(async (req, res) => {
  const email = normaliseEmail(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const nextUrl = safeAdminNext(req.body.next);

  const fail = () => res.status(401).render('admin/login', {
    title: 'Admin sign in — Super Feels COA',
    error: 'That email and password do not match.',
    email,
    nextUrl,
  });

  if (!isEmail(email) || !password) return fail();

  const admin = await db.one(
    'SELECT id, name, email, password_hash, role, is_active FROM admins WHERE email = ?',
    [email]
  );

  // Runs whether or not the account exists, so the response time does not
  // reveal which addresses are registered. See lib/passwords.js.
  const ok = await passwords.verify(password, admin && admin.password_hash);

  if (!admin || !ok || !admin.is_active) {
    log.warn('failed admin sign in', { email, ip: req.ip });
    return fail();
  }

  await signInAdmin(req, admin);
  await db.query('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [admin.id]);
  log.info('admin signed in', { adminId: admin.id, email, role: admin.role });

  return res.redirect(nextUrl);
}));

router.post('/logout', (req, res) => {
  const adminId = req.admin ? req.admin.id : null;
  req.adminSession.destroy(() => {
    res.clearCookie('sf_coa_admin_sid', { path: '/admin' });
    log.info('admin signed out', { adminId });
    res.redirect('/admin/login');
  });
});

// Everything past this point needs a staff session.
router.use(requireAdmin);

// The unread enquiry count rides along on every admin page, so a new customer
// message is visible from wherever the operator happens to be rather than only
// on the dashboard they may not revisit for a week.
router.use(asyncRoute(async (req, res, next) => {
  const row = await db.one("SELECT COUNT(*) AS n FROM enquiries WHERE status = 'new'");
  res.locals.newEnquiries = Number(row.n);
  next();
}));

// ── Dashboard ───────────────────────────────────────────────────────────────

router.get('/', asyncRoute(async (req, res) => {
  const [summary, chart, topBatches, missed] = await Promise.all([
    analytics.summary(),
    analytics.lookupsByDay(30),
    analytics.topBatches(30, 8),
    analytics.missedQueries(30, 8),
  ]);

  // Two lists of things that need doing, rather than a general "recent
  // activity" feed nobody acts on. A published batch with no PDF and a batch
  // still marked pending are both states someone has to resolve.
  const needsAttention = await db.query(
    `SELECT b.id, b.batch_code, b.status, b.is_published, p.name AS product_name,
            (SELECT COUNT(*) FROM coa_files f WHERE f.batch_id = b.id) AS files,
            (SELECT COUNT(*) FROM result_panels rp WHERE rp.batch_id = b.id) AS panels
       FROM batches b
       JOIN products p ON p.id = b.product_id
      WHERE (b.is_published = 1 AND (SELECT COUNT(*) FROM coa_files f WHERE f.batch_id = b.id) = 0)
         OR (b.is_published = 0)
      ORDER BY b.is_published DESC, b.updated_at DESC
      LIMIT 8`
  );

  const recentEnquiries = req.admin.role === 'admin'
    ? await db.query(
        `SELECT id, name, email, batch_code, subject, status, created_at
           FROM enquiries ORDER BY created_at DESC LIMIT 6`
      )
    : [];

  return res.render('admin/dashboard', {
    title: 'Dashboard — Super Feels COA',
    pageHeading: 'Dashboard',
    summary,
    chart,
    topBatches,
    missed,
    needsAttention,
    recentEnquiries,
    isFullAdmin: req.admin.role === 'admin',
  });
}));

// ── Sub-sections ────────────────────────────────────────────────────────────
// Products, batches, results, reports and labs are the publishing job, and an
// editor does all of it. Customer data, staff accounts, the audit trail and the
// system pages are admin-only.

router.use('/products', require('./products'));
router.use('/batches', require('./batches'));
router.use('/labs', require('./labs'));
router.use('/content', require('./content'));
router.use('/analytics', requireRole('admin'), require('./analytics'));
// Enquiries carry customer names and email addresses.
router.use('/enquiries', requireRole('admin'), require('./enquiries'));
// Staff accounts are admin-only: an editor who could reach this could promote
// itself to full access.
router.use('/team', requireRole('admin'), require('./team'));
router.use('/activity', requireRole('admin'), require('./activity'));
router.use('/system', requireRole('admin'), require('./system'));

module.exports = router;
