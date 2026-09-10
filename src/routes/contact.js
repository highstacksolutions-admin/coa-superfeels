'use strict';

const express = require('express');
const db = require('../config/db');
const log = require('../lib/logger');
const mailer = require('../lib/mailer');
const limits = require('../middleware/rateLimit');
const { asyncRoute } = require('../middleware/errors');
const { validateEnquiry, trim } = require('../lib/validate');

const router = express.Router();

function renderForm(req, res, { status = 200, values = {}, errors = {} } = {}) {
  return res.status(status).render('pages/contact', {
    title: 'Contact — Super Feels',
    description: 'Cannot find a batch, or something on a lab report does not look right? Tell us.',
    values,
    errors,
  });
}

router.get('/contact', (req, res) => {
  // Prefilled from the not-found page, so someone who arrived there because
  // their code returned nothing does not have to type it a second time.
  return renderForm(req, res, { values: { batch_code: trim(req.query.batch).slice(0, 80) } });
});

router.post('/contact', limits.enquiry, asyncRoute(async (req, res) => {
  const { values, errors } = validateEnquiry(req.body);

  if (Object.keys(errors).length) {
    return renderForm(req, res, { status: 422, values, errors });
  }

  const result = await db.query(
    `INSERT INTO enquiries (name, email, batch_code, subject, message, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      values.name,
      values.email,
      values.batch_code || null,
      values.subject || null,
      values.message,
      (req.ip || '').slice(0, 45) || null,
    ]
  );

  const enquiry = { id: result.insertId, ...values };
  log.info('enquiry received', { enquiryId: enquiry.id, batchCode: values.batch_code || null });

  // Queued, not awaited for delivery. The enquiry is already in the database,
  // so a dead mailbox loses the notification but never the message itself —
  // it is still in the admin under Enquiries either way.
  mailer.sendEnquiry(enquiry).catch((err) => {
    log.error('enquiry notification failed to queue', { enquiryId: enquiry.id, error: err.message });
  });
  mailer.sendEnquiryReceipt(enquiry).catch(() => {});

  return res.render('pages/message', {
    title: 'Message sent — Super Feels',
    heading: 'Thank you — we have it',
    body: values.batch_code
      ? `We have your message about batch ${values.batch_code} and a copy is on its way to ${values.email}. We will look into the code and come back to you.`
      : `We have your message and a copy is on its way to ${values.email}. We will come back to you shortly.`,
    action: { href: '/', label: 'Look up another batch' },
  });
}));

module.exports = router;
