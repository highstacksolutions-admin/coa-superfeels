'use strict';

const multer = require('multer');
const env = require('../config/env');
const { enforceMultipartCsrf } = require('./csrf');

// Uploads are held in memory rather than written to a temp file.
//
// These are single lab-report PDFs and product photographs, capped at
// MAX_UPLOAD_SIZE (32MB by default) on an admin-only route with no meaningful
// concurrency — so the memory cost is bounded and small. What it buys is that a
// rejected upload leaves nothing behind: no orphaned temp file to clean up when
// validation fails, when the batch turns out not to exist, or when the request
// is abandoned halfway. Nothing reaches disk until the route has decided it
// belongs there.

const PDF_MIMES = new Set(['application/pdf']);
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

function rejectType(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

const storage = multer.memoryStorage();

const pdfUpload = multer({
  storage,
  limits: { fileSize: env.maxUploadSize, files: 6 },
  fileFilter: (req, file, cb) => {
    if (PDF_MIMES.has(file.mimetype)) return cb(null, true);
    return cb(rejectType(
      `${file.originalname} is not a PDF. Lab reports are uploaded as the laboratory's own PDF.`
    ));
  },
});

const imageUpload = multer({
  storage,
  limits: { fileSize: Math.min(env.maxUploadSize, 12 * 1024 * 1024), files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_MIMES.has(file.mimetype)) return cb(null, true);
    return cb(rejectType(`${file.originalname} is not a JPEG, PNG, WebP or AVIF image.`));
  },
});

/**
 * Whether the bytes are actually a PDF. The MIME type checked above is only
 * what the browser guessed from the file extension, and the report page draws
 * the file with PDF.js, which cannot render a renamed Word document. The spec
 * allows the header anywhere in the first 1024 bytes.
 */
function isPdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 1024).includes('%PDF-');
}

/**
 * Translate multer's own errors into something a person can act on. Left alone,
 * a file over the limit produces "LIMIT_FILE_SIZE" on a 500 page.
 */
function translateUploadErrors(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    const mb = Math.round(env.maxUploadSize / (1024 * 1024));
    const messages = {
      LIMIT_FILE_SIZE: `That file is over the ${mb}MB limit.`,
      LIMIT_FILE_COUNT: 'Too many files at once.',
      LIMIT_UNEXPECTED_FILE: 'That form field does not accept a file.',
    };
    const wrapped = new Error(messages[err.code] || `Upload failed: ${err.code}`);
    wrapped.status = 413;
    return next(wrapped);
  }
  return next(err);
}

/**
 * A complete middleware chain for one multipart route: parse, then verify the
 * CSRF token that could not be read before the body existed, then translate
 * multer's errors.
 *
 * Exported as a chain rather than as the bare multer instance so that a route
 * cannot accept a multipart body without also getting the deferred CSRF check.
 * That check is easy to forget and its absence is invisible until it matters.
 */
function pdfFields(fields) {
  return [pdfUpload.fields(fields), translateUploadErrors, enforceMultipartCsrf];
}

function singleImage(field) {
  return [imageUpload.single(field), translateUploadErrors, enforceMultipartCsrf];
}

module.exports = { pdfFields, singleImage, isPdf, IMAGE_MIMES, PDF_MIMES };
