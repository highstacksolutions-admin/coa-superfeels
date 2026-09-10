'use strict';

// There is no provider dashboard for any of this, so the application log is the
// only record. Structured single-line output, safe to tail through PM2.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] || (process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug);

const REDACT = /^(password|password_hash|passwordConfirm|token|session_secret|smtp_password|api_key|authorization|cookie)$/i;

function scrub(value, depth = 0) {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack, code: value.code };
  }
  if (value === null || typeof value !== 'object' || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT.test(k) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

function emit(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const line = { t: new Date().toISOString(), level, msg: String(message) };
  if (meta !== undefined) line.meta = scrub(meta);
  // One stream, deliberately. Splitting warn/error onto stderr scatters the log
  // across two files under PM2 and two tabs in a hosting panel, and the half
  // people read is rarely the half carrying the failure.
  process.stdout.write(JSON.stringify(line) + '\n');
}

module.exports = {
  debug: (m, meta) => emit('debug', m, meta),
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
};
