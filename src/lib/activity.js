'use strict';

const db = require('../config/db');
const log = require('./logger');

/**
 * The staff audit trail: who changed which batch, and when.
 *
 * This exists because a published lab result is a compliance artefact. If a
 * batch's THC number changes after it went live, "who edited it and when" is
 * the first question asked and the process log is not a usable answer six
 * months later.
 *
 * Never throws. A failed audit write must not roll back the change it was
 * describing, so the failure is logged and swallowed.
 */
async function record(req, { action, entity, entityId = null, detail = null }) {
  try {
    await db.query(
      `INSERT INTO activity_log (admin_id, action, entity, entity_id, detail, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.admin ? req.admin.id : null,
        String(action).slice(0, 80),
        String(entity).slice(0, 60),
        entityId,
        detail === null ? null : String(detail).slice(0, 500),
        (req.ip || '').slice(0, 45) || null,
      ]
    );
  } catch (err) {
    log.error('activity log write failed', { action, entity, entityId, error: err.message });
  }
}

module.exports = { record };
