'use strict';

const env = require('./config/env');
const db = require('./config/db');
const log = require('./lib/logger');
const mailer = require('./lib/mailer');

async function start() {
  try {
    await db.ping();
    log.info('database connected', { host: env.db.host, database: env.db.database });
  } catch (err) {
    log.error('database unreachable at boot', { error: err.message });
    process.exit(1);
  }

  // Hosts with no terminal step cannot run `npm run migrate` or
  // `npm run seed:admin`. With AUTO_MIGRATE=1 the app applies pending
  // migrations itself before it starts listening, and creates the first admin
  // from BOOTSTRAP_ADMIN_* if there is none yet. Both are no-ops on every boot
  // after the first, so leaving them on costs nothing.
  if (/^(1|true|yes|on)$/i.test(process.env.AUTO_MIGRATE || '')) {
    try {
      const { runMigrations } = require('./db/migrate');
      const { applied } = await runMigrations({ report: (line) => log.info(`migrate: ${line}`) });
      log.info('migrations up to date', { applied: applied.length });
    } catch (err) {
      // A half-applied schema is worse than a stopped app. Refuse to serve.
      log.error('migration failed at boot; not starting', { error: err.message });
      process.exit(1);
    }
  }

  try {
    const { bootstrapAdmin } = require('./lib/bootstrap');
    await bootstrapAdmin();
  } catch (err) {
    log.error('first-admin bootstrap failed; not starting', { error: err.message });
    process.exit(1);
  }

  // Surfaces a wrong SMTP password in the log at boot rather than in a missed
  // customer enquiry a week later. Non-fatal: the site is useful without email,
  // and enquiries are stored either way.
  mailer.verifyConnection().catch(() => {});

  const app = require('./app');
  const server = app.listen(env.port, () => {
    log.info('coa portal listening', { port: env.port, url: env.appUrl, env: env.nodeEnv });
  });

  server.headersTimeout = 65000;
  server.keepAliveTimeout = 61000;

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal, mailQueueDepth: mailer.queueDepth() });

    server.close(async () => {
      try { await db.pool.end(); } catch (err) { log.error('pool close failed', err); }
      process.exit(0);
    });

    // In-flight downloads get a grace period, then the process goes anyway.
    setTimeout(() => {
      log.warn('forcing shutdown after grace period');
      process.exit(0);
    }, 15000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', reason instanceof Error ? reason : { reason: String(reason) });
  });
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', err);
    shutdown('uncaughtException');
  });
}

start();
