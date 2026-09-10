'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const log = require('./logger');

// Lab reports live outside the web root and are only ever reachable through the
// download route, which checks that the batch is published and counts the hit.
// Nothing in this module is mounted on a static handler, and `resolve` below is
// the single chokepoint that turns a database value into a path on disk.

const ROOT = env.storagePath;

/**
 * Turn a stored relative path into an absolute one, refusing anything that
 * escapes the storage root. Values come from our own database rather than from
 * a request, but a traversal bug is exactly the kind that survives a rewrite,
 * so it is checked at the boundary regardless.
 */
function resolve(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) {
    throw new Error('Empty storage path');
  }
  if (relativePath.includes('\0')) throw new Error('Illegal storage path');

  const abs = path.resolve(ROOT, relativePath);
  const rel = path.relative(ROOT, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Storage path escapes the storage root: ${relativePath}`);
  }
  return abs;
}

/**
 * A collision-proof on-disk name that keeps the original extension for
 * Content-Type sniffing and nothing else from the uploaded filename.
 */
function storedName(originalFilename) {
  const ext = path.extname(String(originalFilename || '')).toLowerCase().slice(0, 12);
  const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : '';
  return `${Date.now().toString(36)}-${crypto.randomBytes(12).toString('hex')}${safeExt}`;
}

/** Shard by year/month so no single directory grows unbounded. */
function shardDir(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return path.join(String(y), m);
}

async function ensureDir(relativeDir) {
  const abs = path.resolve(ROOT, relativeDir);
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Illegal storage directory');
  await fsp.mkdir(abs, { recursive: true });
  return abs;
}

async function stat(relativePath) {
  try {
    return await fsp.stat(resolve(relativePath));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function exists(relativePath) {
  try {
    return fs.existsSync(resolve(relativePath));
  } catch {
    return false;
  }
}

/** A read stream over a byte range, so a PDF is never read into memory whole. */
function createReadStream(relativePath, options = {}) {
  return fs.createReadStream(resolve(relativePath), options);
}

async function remove(relativePath) {
  if (!relativePath) return false;
  try {
    await fsp.unlink(resolve(relativePath));
    log.info('storage file removed', { path: relativePath });
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    log.error('storage file could not be removed', { path: relativePath, error: err.message });
    return false;
  }
}

// ── Public uploads ──────────────────────────────────────────────────────────
// Product photography is public by nature and is served straight out of
// ./public, so it has its own root and its own guard. Nothing sensitive is
// ever written here — that is the whole distinction from the storage root
// above, and it is why the two never share a helper.

async function savePublicImage(buffer, originalFilename) {
  const name = storedName(originalFilename);
  const abs = path.join(env.uploadsPath, name);
  await fsp.mkdir(env.uploadsPath, { recursive: true });
  await fsp.writeFile(abs, buffer);
  return `/uploads/${name}`;
}

/** Takes the `/uploads/x.jpg` URL that was stored on the row. */
async function removePublicImage(urlPath) {
  if (!urlPath || typeof urlPath !== 'string') return false;
  const name = path.basename(urlPath);
  const abs = path.resolve(env.uploadsPath, name);
  const rel = path.relative(env.uploadsPath, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  try {
    await fsp.unlink(abs);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  ROOT,
  resolve,
  storedName,
  shardDir,
  ensureDir,
  stat,
  exists,
  createReadStream,
  remove,
  savePublicImage,
  removePublicImage,
};
