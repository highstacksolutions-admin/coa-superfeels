'use strict';

const path = require('path');
const ejs = require('ejs');
const nodemailer = require('nodemailer');
const env = require('../config/env');
const log = require('./logger');

// Every email in the application goes through this module. It sends over an
// authenticated mailbox rather than a transactional provider, which means there
// is no dashboard to check and no deliverability tooling — so this is built
// defensively: queued, throttled, retried, and logged either way.
//
// Swapping to a transactional provider later is a change to `createTransport`
// and the SMTP_* environment variables. Nothing else in the app touches SMTP.

const TEMPLATE_DIR = path.join(env.root, 'views', 'emails');
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2000, 15000, 60000];

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!env.smtp.host || !env.smtp.user) return null;
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: { user: env.smtp.user, pass: env.smtp.password },
    // One pooled connection is plenty for this volume and keeps the mailbox
    // host from treating us as a burst sender.
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
  return transporter;
}

// ── Queue ───────────────────────────────────────────────────────────────────
// A slow or dead SMTP connection must never block an HTTP response. On this
// site that matters more than usual: the one thing waiting on a send is a
// customer who already could not find their batch, submitting the contact form.
// Nothing is sent inline; messages go on this in-process queue and drain on a
// timer at the configured rate.

const queue = [];
let draining = false;

// ── Activity record ─────────────────────────────────────────────────────────
// There is no provider dashboard for this mailbox, so without an in-app record
// the only way to answer "did that go out?" is to read the process log, which
// on a panel-managed host is awkward at best. This keeps the last 100 events in
// memory for the admin's Email page.
//
// In memory on purpose: it is a diagnostic, not an audit trail, and it must not
// add a database write to every send. It resets on restart, and the process log
// remains the durable record. The enquiries themselves are in the database
// regardless of whether their notification email ever left the building.

const HISTORY_LIMIT = 100;
const history = [];

let lastVerify = { at: null, ok: null, error: null };

/**
 * Record one event. `status` is one of:
 *   queued | sent | retrying | failed | not-configured | test
 */
function record(status, entry) {
  history.unshift({ t: new Date().toISOString(), status, ...entry });
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
}

function intervalMs() {
  const perMin = Math.max(1, env.smtp.throttlePerMin);
  return Math.ceil(60000 / perMin);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliver(job) {
  const tx = getTransporter();

  if (!tx) {
    log.warn('email not sent (no SMTP configured)', {
      to: job.message.to, subject: job.message.subject,
    });
    record('not-configured', {
      to: job.message.to, subject: job.message.subject, template: job.template,
      detail: 'SMTP_HOST or SMTP_USER is empty, so nothing was sent.',
    });
    return;
  }

  const info = await tx.sendMail({
    from: env.smtp.from,
    replyTo: job.replyTo || env.smtp.replyTo || undefined,
    to: job.message.to,
    subject: job.message.subject,
    text: job.message.text,
    html: job.message.html,
  });

  log.info('email sent', {
    to: job.message.to,
    subject: job.message.subject,
    template: job.template,
    messageId: info.messageId,
    attempt: job.attempts + 1,
  });

  record('sent', {
    to: job.message.to,
    subject: job.message.subject,
    template: job.template,
    messageId: info.messageId,
    // The server accepted it. Whether it reaches an inbox is a DNS and
    // reputation question this cannot answer.
    accepted: (info.accepted || []).join(', '),
    rejected: (info.rejected || []).join(', '),
    attempt: job.attempts + 1,
    response: info.response,
  });
}

async function drain() {
  if (draining) return;
  draining = true;

  while (queue.length) {
    const job = queue.shift();
    try {
      await deliver(job);
    } catch (err) {
      job.attempts += 1;
      if (job.attempts < MAX_ATTEMPTS) {
        const wait = BACKOFF_MS[job.attempts - 1] || 60000;
        log.warn('email send failed, will retry', {
          to: job.message.to, template: job.template,
          attempt: job.attempts, retryInMs: wait, error: err.message,
        });
        record('retrying', {
          to: job.message.to, subject: job.message.subject, template: job.template,
          attempt: job.attempts, retryInMs: wait, detail: err.message,
        });
        setTimeout(() => { queue.push(job); drain(); }, wait);
      } else {
        // Terminal. This log line is the only record that a notification never
        // arrived — it carries enough to diagnose and resend by hand.
        log.error('email permanently failed', {
          to: job.message.to, subject: job.message.subject, template: job.template,
          attempts: job.attempts, error: err.message, code: err.code, response: err.response,
        });
        record('failed', {
          to: job.message.to, subject: job.message.subject, template: job.template,
          attempt: job.attempts, detail: err.message, code: err.code, response: err.response,
        });
      }
    }
    if (queue.length) await sleep(intervalMs());
  }

  draining = false;
}

// ── Templates ───────────────────────────────────────────────────────────────

async function render(template, data) {
  // No `async: true` here. It compiles the template body as an async function,
  // which makes every `include()` return a promise — and an unawaited promise
  // stringifies to "[object Promise]", silently replacing the header and footer
  // of every message. renderFile still returns a promise without it.
  return ejs.renderFile(path.join(TEMPLATE_DIR, `${template}.ejs`), {
    ...data,
    appUrl: env.appUrl,
    year: new Date().getFullYear(),
  });
}

/** Crude but adequate html -> text for the multipart alternative. */
function toText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trim()).join('\n')
    .trim();
}

/** Queue an email. Returns once rendered — callers never await delivery. */
async function send({ to, subject, template, data = {}, replyTo }) {
  try {
    const html = await render(template, data);
    queue.push({
      message: { to, subject, html, text: toText(html) },
      template,
      replyTo,
      attempts: 0,
      queuedAt: Date.now(),
    });
    log.info('email queued', { to, subject, template, queueDepth: queue.length });
    record('queued', { to, subject, template });
    setImmediate(drain);
  } catch (err) {
    log.error('email could not be rendered', { to, template, error: err.message });
    // Without this the Email page shows nothing at all for a template that
    // failed to render — the same blank history as a request that was never
    // made. A broken template is the one failure mode that never reaches the
    // SMTP layer, so it has to be recorded here or it is invisible.
    record('failed', {
      to, subject, template,
      detail: `The ${template} template could not be rendered: ${err.message}`,
    });
  }
}

// ── Typed senders ───────────────────────────────────────────────────────────
// Nothing outside this module builds a subject line or a URL.

/**
 * The enquiry notification. `replyTo` is the customer's own address, so hitting
 * reply in the mailbox answers them directly instead of answering the site.
 */
const sendEnquiry = (enquiry) => send({
  to: env.contactRecipient,
  subject: enquiry.batch_code
    ? `COA enquiry — batch ${enquiry.batch_code}`
    : 'COA enquiry — Super Feels',
  template: 'enquiry',
  data: { enquiry, url: `${env.appUrl}/admin/enquiries` },
  replyTo: enquiry.email,
});

/** The customer's own copy, so the form does not feel like a void. */
const sendEnquiryReceipt = (enquiry) => send({
  to: enquiry.email,
  subject: 'We have your message — Super Feels',
  template: 'enquiry-receipt',
  data: { enquiry },
});

/** Called at boot so a bad SMTP password shows up in the log, not in support. */
async function verifyConnection() {
  const tx = getTransporter();
  if (!tx) return false;
  try {
    await tx.verify();
    lastVerify = { at: new Date().toISOString(), ok: true, error: null };
    log.info('smtp connection verified', { host: env.smtp.host, user: env.smtp.user });
    return true;
  } catch (err) {
    lastVerify = { at: new Date().toISOString(), ok: false, error: err.message };
    log.error('smtp connection failed at boot', { host: env.smtp.host, error: err.message });
    // Also on the history, so the Email page leads with the reason nothing is
    // going out rather than showing an empty list under a green "configured".
    record('failed', {
      to: '—',
      subject: 'SMTP connection check',
      template: 'connection',
      detail: `Could not connect to ${env.smtp.host}:${env.smtp.port} as ${env.smtp.user}: ${err.message}`,
      code: err.code,
      response: err.response,
    });
    return false;
  }
}

/** Everything the admin Email page needs to explain the current state. */
function status() {
  return {
    configured: Boolean(env.smtp.host && env.smtp.user),
    host: env.smtp.host || null,
    port: env.smtp.port,
    secure: env.smtp.secure,
    user: env.smtp.user || null,
    from: env.smtp.from,
    replyTo: env.smtp.replyTo || null,
    recipient: env.contactRecipient,
    throttlePerMin: env.smtp.throttlePerMin,
    queueDepth: queue.length,
    lastVerify,
  };
}

/**
 * Send a message to a chosen address, to prove the path end to end. Unlike the
 * templated senders this has no preconditions, which is exactly what makes it
 * useful when an enquiry notification produced silence.
 */
async function sendTest(to, sentBy) {
  record('test', { to, subject: 'Test message', template: 'test', detail: `Requested by ${sentBy}` });
  await send({
    to,
    subject: 'Test — Super Feels COA',
    template: 'test',
    data: { to, sentBy, sentAt: new Date().toISOString() },
  });
}

module.exports = {
  send,
  sendTest,
  sendEnquiry,
  sendEnquiryReceipt,
  status,
  history: () => history.slice(),
  verifyConnection,
  queueDepth: () => queue.length,
};
