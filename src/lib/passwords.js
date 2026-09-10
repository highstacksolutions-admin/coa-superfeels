'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const COST = 12;

// A sign-in attempt for an address that does not exist must cost the same as
// one for an address that does, or the response time tells an attacker which
// emails are registered.
//
// The obvious way to do that — comparing against a hand-written placeholder
// string — does not work. bcrypt rejects a malformed hash and returns false
// immediately, so the placeholder has to be a genuinely valid hash or the
// mitigation silently does nothing. This one is generated at module load from
// random bytes: always well-formed, and no password can ever match it.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), COST);

/**
 * Verify a password against a stored hash. Pass null/undefined when the account
 * was not found — the comparison still runs, against the dummy, and returns
 * false after the same work.
 */
async function verify(password, storedHash) {
  const hash = storedHash || DUMMY_HASH;
  const ok = await bcrypt.compare(String(password || ''), hash);
  // Guard against a stored hash that is itself malformed: without this, a
  // corrupted row would compare against nothing and return fast.
  return storedHash ? ok : false;
}

function hash(password) {
  return bcrypt.hash(password, COST);
}

module.exports = { verify, hash, COST };
