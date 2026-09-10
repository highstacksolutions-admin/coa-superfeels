#!/usr/bin/env node
'use strict';

// Applies every .sql file in ./migrations in filename order, once each,
// recording what ran in a _migrations table.
//
// Two ways in:
//   npm run migrate            -- the CLI, for a terminal deploy
//   AUTO_MIGRATE=1 npm start   -- the app runs this itself before listening,
//                                 for a host where there is no terminal step

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../config/env');

const DIR = path.join(__dirname, 'migrations');

/**
 * Split a file into statements on semicolons that are not inside a string or a
 * comment. Statements run one at a time by design — multipleStatements stays
 * off so a migration file cannot smuggle one in.
 */
function splitStatements(sql) {
  const out = [];
  let buf = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      buf += c;
      if (c === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      buf += c;
      if (c === '*' && next === '/') { buf += next; i += 1; blockComment = false; }
      continue;
    }

    if (!quote) {
      if (c === '-' && next === '-') { lineComment = true; buf += c; continue; }
      if (c === '#') { lineComment = true; buf += c; continue; }
      if (c === '/' && next === '*') { blockComment = true; buf += c; continue; }
      if (c === "'" || c === '"' || c === '`') { quote = c; buf += c; continue; }
      if (c === ';') {
        if (buf.trim()) out.push(buf.trim());
        buf = '';
        continue;
      }
    } else {
      if (c === '\\') { buf += c + (next || ''); i += 1; continue; }
      if (c === quote) quote = null;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Apply pending migrations. Resolves to { applied: [...], skipped: [...] }.
 * Throws on the first failing statement, naming the file, and leaves the
 * _migrations row for that file unwritten so a fixed file re-runs cleanly.
 */
async function runMigrations({ report = () => {} } = {}) {
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    multipleStatements: false,
    charset: 'utf8mb4_unicode_ci',
  });

  const applied = [];
  const skipped = [];

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        filename VARCHAR(255) NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_migrations_filename (filename)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [rows] = await conn.query('SELECT filename FROM _migrations');
    const done = new Set(rows.map((r) => r.filename));

    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (done.has(file)) {
        skipped.push(file);
        report(`skip  ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      const statements = splitStatements(sql);
      report(`apply ${file} (${statements.length} statements)`);

      try {
        for (const stmt of statements) await conn.query(stmt);
        await conn.query('INSERT INTO _migrations (filename) VALUES (?)', [file]);
        applied.push(file);
      } catch (err) {
        const wrapped = new Error(`Migration ${file} failed: ${err.message}`);
        wrapped.file = file;
        wrapped.cause = err;
        throw wrapped;
      }
    }
  } finally {
    await conn.end();
  }

  return { applied, skipped };
}

module.exports = { runMigrations, splitStatements };

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  runMigrations({ report: (line) => console.log(`  ${line}`) })
    .then(({ applied }) => {
      console.log(applied.length ? `\n${applied.length} migration(s) applied.` : '\nAlready up to date.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`\n${err.message}\n`);
      process.exit(1);
    });
}
