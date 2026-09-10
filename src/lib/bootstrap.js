'use strict';

const db = require('../config/db');
const log = require('./logger');
const passwords = require('./passwords');
const { isEmail, normaliseEmail } = require('./validate');

/**
 * Create the first admin from BOOTSTRAP_ADMIN_* environment variables, but only
 * while the admins table is empty. Once any admin exists this does nothing, so
 * the variables cannot be used to reset or add accounts later — that is what the
 * admin panel and `npm run seed:admin` are for.
 *
 * This exists for hosts with no terminal step, where `npm run seed:admin` is
 * not available and the alternative is a running site nobody can log into.
 */
async function bootstrapAdmin() {
  const email = normaliseEmail(process.env.BOOTSTRAP_ADMIN_EMAIL || '');
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  const name = (process.env.BOOTSTRAP_ADMIN_NAME || '').trim() || 'Admin';

  if (!email && !password) return false;

  const { n } = await db.one('SELECT COUNT(*) AS n FROM admins');
  if (Number(n) > 0) {
    // Nothing to do, but say so once, because the credential is still sitting
    // in the environment and can now be removed.
    log.info('bootstrap admin skipped: an admin already exists. BOOTSTRAP_ADMIN_* can be removed from the environment.');
    return false;
  }

  const problems = [];
  if (!isEmail(email)) problems.push('BOOTSTRAP_ADMIN_EMAIL is not a valid email address');
  if (password.length < 8) problems.push('BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters');
  if (problems.length) {
    // Refuse rather than boot with no way in and no admin.
    throw new Error(`Cannot create the first admin: ${problems.join('; ')}.`);
  }

  const hash = await passwords.hash(password);
  const res = await db.query(
    'INSERT INTO admins (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, hash, 'admin']
  );

  log.warn('first admin created from environment', {
    adminId: res.insertId,
    email,
    note: 'Remove BOOTSTRAP_ADMIN_PASSWORD from the environment now; it is no longer needed.',
  });
  return true;
}

module.exports = { bootstrapAdmin };
