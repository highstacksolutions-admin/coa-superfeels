'use strict';

const express = require('express');
const db = require('../../config/db');
const log = require('../../lib/logger');
const passwords = require('../../lib/passwords');
const activity = require('../../lib/activity');
const { asyncRoute } = require('../../middleware/errors');
const { trim, toId, isEmail, normaliseEmail, validatePassword } = require('../../lib/validate');

const router = express.Router();

const ROLES = ['admin', 'editor'];

router.get('/', asyncRoute(async (req, res) => {
  const admins = await db.query(
    'SELECT id, name, email, role, is_active, created_at, last_login_at FROM admins ORDER BY created_at'
  );
  return res.render('admin/team', {
    title: 'Team — Super Feels COA',
    pageHeading: 'Team',
    admins,
    values: {},
    errors: {},
  });
}));

router.post('/', asyncRoute(async (req, res) => {
  const values = {
    name: trim(req.body.name).slice(0, 120),
    email: normaliseEmail(req.body.email).slice(0, 190),
    role: ROLES.includes(req.body.role) ? req.body.role : 'editor',
  };
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const errors = {};

  if (!values.name) errors.name = 'Enter a name.';
  if (!isEmail(values.email)) errors.email = 'Enter a valid email address.';
  const pwErr = validatePassword(password);
  if (pwErr) errors.password = pwErr;

  if (!errors.email) {
    const clash = await db.one('SELECT id FROM admins WHERE email = ?', [values.email]);
    if (clash) errors.email = 'A staff account already uses that email.';
  }

  if (Object.keys(errors).length) {
    const admins = await db.query(
      'SELECT id, name, email, role, is_active, created_at, last_login_at FROM admins ORDER BY created_at'
    );
    return res.status(422).render('admin/team', {
      title: 'Team — Super Feels COA', pageHeading: 'Team',
      admins, values, errors,
    });
  }

  const hash = await passwords.hash(password);
  const result = await db.query(
    'INSERT INTO admins (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [values.name, values.email, hash, values.role]
  );
  await activity.record(req, { action: 'team.create', entity: 'admin', entityId: result.insertId, detail: `${values.email} (${values.role})` });
  log.info('staff account created', { by: req.admin.id, newAdminId: result.insertId, role: values.role });
  req.flash('ok', `${values.name} added.`);
  return res.redirect('/admin/team');
}));

router.post('/:id/role', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  const role = ROLES.includes(req.body.role) ? req.body.role : null;
  if (!id || !role) return next();

  // You cannot demote yourself out of admin. Left possible, one admin could
  // remove their own access and leave a site with an editor who cannot reach
  // the team page to fix it.
  if (id === req.admin.id && role !== 'admin') {
    req.flash('error', 'You cannot remove your own admin access.');
    return res.redirect('/admin/team');
  }

  await db.query('UPDATE admins SET role = ? WHERE id = ?', [role, id]);
  await activity.record(req, { action: 'team.role', entity: 'admin', entityId: id, detail: role });
  req.flash('ok', 'Role updated.');
  return res.redirect('/admin/team');
}));

router.post('/:id/active', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  if (!id) return next();
  const active = req.body.is_active ? 1 : 0;

  if (id === req.admin.id && !active) {
    req.flash('error', 'You cannot deactivate your own account.');
    return res.redirect('/admin/team');
  }
  // Never leave the site with no active admin. The last one standing cannot be
  // switched off, or there is no way back in short of the CLI.
  if (!active) {
    const { n } = await db.one("SELECT COUNT(*) AS n FROM admins WHERE role = 'admin' AND is_active = 1 AND id <> ?", [id]);
    const target = await db.one('SELECT role FROM admins WHERE id = ?', [id]);
    if (target && target.role === 'admin' && Number(n) === 0) {
      req.flash('error', 'That is the last active admin. Promote someone else first.');
      return res.redirect('/admin/team');
    }
  }

  await db.query('UPDATE admins SET is_active = ? WHERE id = ?', [active, id]);
  await activity.record(req, { action: active ? 'team.activate' : 'team.deactivate', entity: 'admin', entityId: id });
  req.flash('ok', active ? 'Account activated.' : 'Account deactivated.');
  return res.redirect('/admin/team');
}));

router.post('/:id/password', asyncRoute(async (req, res, next) => {
  const id = toId(req.params.id);
  if (!id) return next();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const pwErr = validatePassword(password);
  if (pwErr) {
    req.flash('error', pwErr);
    return res.redirect('/admin/team');
  }
  const hash = await passwords.hash(password);
  await db.query('UPDATE admins SET password_hash = ? WHERE id = ?', [hash, id]);
  await activity.record(req, { action: 'team.password', entity: 'admin', entityId: id });
  req.flash('ok', 'Password reset.');
  return res.redirect('/admin/team');
}));

module.exports = router;
