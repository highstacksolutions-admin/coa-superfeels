'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const trim = (v) => (typeof v === 'string' ? v.trim() : '');

function normaliseEmail(v) {
  return trim(v).toLowerCase();
}

function isEmail(v) {
  return EMAIL_RE.test(normaliseEmail(v));
}

/**
 * The lookup key for a batch code.
 *
 * Someone reads a code off a printed label, in a shop, on a phone, and types
 * what they see. They will get the punctuation wrong: "SF-2409-A12" arrives as
 * "sf 2409 a12", "SF2409A12", "sf–2409–a12" with an en dash the label's font
 * made of a hyphen. Matching on the code as entered would fail every one of
 * those and send a paying customer to a "not found" page holding a product
 * whose report exists.
 *
 * So every code — the one the admin types in and the one the customer searches
 * for — collapses to the same key: uppercase, letters and digits only. The
 * display form is kept separately and is what gets shown back.
 *
 * The UNIQUE index in the schema is on this key, not on the display code, so
 * "SF-2409-A12" and "SF2409A12" cannot both be entered as separate batches and
 * then race each other in a lookup.
 */
function batchKey(v) {
  return trim(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Coerce to a positive integer, or null. Used for :id route params. */
function toId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Turn a display name into a url-safe slug. */
function slugify(v) {
  return trim(v)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** A DATE column wants 'YYYY-MM-DD' or NULL, never ''. */
function toDate(v) {
  const s = trim(v);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * A decimal for a results column, kept as a string so the value the lab printed
 * survives unchanged. Returns null for anything unparseable, including the
 * "ND" and "<LOQ" that belong in the text column instead.
 */
function toDecimal(v) {
  const s = trim(v).replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 200) return 'Use fewer than 200 characters.';
  return null;
}

/**
 * The public contact form. Deliberately forgiving: the person filling it in is
 * usually a customer who could not find their batch, and a validation wall is
 * the last thing that helps.
 */
function validateEnquiry(body) {
  const values = {
    name: trim(body.name).slice(0, 120),
    email: normaliseEmail(body.email),
    batch_code: trim(body.batch_code).slice(0, 80),
    subject: trim(body.subject).slice(0, 160),
    message: trim(body.message),
  };
  const errors = {};

  if (!values.name) errors.name = 'Enter your name.';
  if (!values.email) errors.email = 'Enter your email address so we can reply.';
  else if (!isEmail(values.email)) errors.email = 'That does not look like an email address.';
  else if (values.email.length > 190) errors.email = 'That email address is too long.';

  if (!values.message) errors.message = 'Tell us what you need.';
  else if (values.message.length > 4000) errors.message = 'Keep this under 4000 characters.';

  return { values, errors };
}

module.exports = {
  isEmail,
  normaliseEmail,
  batchKey,
  trim,
  toId,
  slugify,
  toDate,
  toDecimal,
  validatePassword,
  validateEnquiry,
};
