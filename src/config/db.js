'use strict';

const mysql = require('mysql2/promise');
const env = require('./env');
const log = require('../lib/logger');

// One pool for the process. Never a connection per request.
const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: env.db.connectionLimit,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  // Driver-side: DATETIME strings are read and written as UTC.
  timezone: 'Z',
  dateStrings: false,
  namedPlaceholders: false,
});

// Server-side: pin every connection's session timezone to UTC so NOW() and
// CURRENT_TIMESTAMP agree with the line above.
//
// Without this the two halves disagree by whatever offset the host runs in.
// Here that would land on the analytics: a lookup made at 23:40 local would be
// bucketed into the wrong day, and "lookups today" on the dashboard would never
// match what the operator can count by hand. The host's timezone is not ours to
// assume, so it is set explicitly per connection.
const basePool = pool.pool || pool;
basePool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'", (err) => {
    if (err) log.error('could not set session time_zone to UTC', { error: err.message });
  });
});

/** Run a parameterised query. Never interpolate values into the SQL string. */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** First row or null. */
async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

/** Run fn inside a transaction, rolling back on any throw. */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (e) { log.error('rollback failed', e); }
    throw err;
  } finally {
    conn.release();
  }
}

async function ping() {
  const conn = await pool.getConnection();
  try { await conn.ping(); } finally { conn.release(); }
}

module.exports = { pool, query, one, transaction, ping };
