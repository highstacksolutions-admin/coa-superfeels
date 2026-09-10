'use strict';

/** 1536 -> "1.5 KB". Shown next to every report download. */
function bytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let out = v;
  while (out >= 1024 && i < units.length - 1) { out /= 1024; i += 1; }
  const dp = out >= 100 || i === 0 ? 0 : 1;
  return `${out.toFixed(dp)} ${units[i]}`;
}

function date(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function dateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** 'YYYY-MM-DD' for a date input's value attribute. */
function dateInput(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

/**
 * A potency number as the label would print it. Trailing zeros are kept to two
 * decimals on purpose: "23.40 %" and "23.4 %" read as different precisions to
 * anyone comparing a report against a package, and the package says 23.40.
 */
function potency(v, unit = '%') {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return `${n.toFixed(2)} ${unit}`.trim();
}

/** Whole numbers with thousands separators, for the analytics tiles. */
function count(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return v.toLocaleString('en-US');
}

/** A share of a total, guarding the division by zero that reads as "NaN%". */
function percent(part, total, dp = 1) {
  const p = Number(part);
  const t = Number(total);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return '0%';
  return `${((p / t) * 100).toFixed(dp)}%`;
}

/** "3 days ago" for the activity and enquiry lists. */
function ago(d) {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  if (!Number.isFinite(ms)) return '—';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`;
  return date(d);
}

module.exports = { bytes, date, dateTime, dateInput, potency, count, percent, ago };
