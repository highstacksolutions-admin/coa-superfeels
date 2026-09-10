#!/usr/bin/env node
'use strict';

// Create or reset a staff account from the command line.
//
//   npm run seed:admin -- "Name" name@example.com 'the-password' [admin|editor]
//
// Unlike the BOOTSTRAP_ADMIN_* path in src/lib/bootstrap.js, this works whether
// or not admins already exist, and updates the password if the email is taken.
// It is the way back in when someone is locked out.

const db = require('../config/db');
const passwords = require('../lib/passwords');
const { isEmail, normaliseEmail, validatePassword } = require('../lib/validate');

async function main() {
  const [name, emailRaw, password, roleRaw] = process.argv.slice(2);
  const email = normaliseEmail(emailRaw || '');
  const role = roleRaw === 'admin' || roleRaw === 'editor' ? roleRaw : 'admin';

  const problems = [];
  if (!name) problems.push('a name is required');
  if (!isEmail(email)) problems.push('a valid email address is required');
  const pwProblem = validatePassword(password);
  if (pwProblem) problems.push(pwProblem.toLowerCase().replace(/\.$/, ''));

  if (problems.length) {
    console.error(`\n  Cannot do that: ${problems.join('; ')}.`);
    console.error('\n  Usage: npm run seed:admin -- "Name" name@example.com \'the-password\' [admin|editor]\n');
    process.exit(1);
  }

  const hash = await passwords.hash(password);
  const existing = await db.one('SELECT id FROM admins WHERE email = ?', [email]);

  if (existing) {
    await db.query(
      'UPDATE admins SET name = ?, password_hash = ?, role = ?, is_active = 1 WHERE id = ?',
      [name, hash, role, existing.id]
    );
    console.log(`\n  Updated ${email} (${role}) and reset the password.\n`);
  } else {
    await db.query(
      'INSERT INTO admins (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, email, hash, role]
    );
    console.log(`\n  Created ${email} (${role}).\n`);
  }

  await db.pool.end();
}

main().catch(async (err) => {
  console.error(`\n  ${err.message}\n`);
  try { await db.pool.end(); } catch {}
  process.exit(1);
});
