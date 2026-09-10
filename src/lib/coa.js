'use strict';

// The vocabulary of a certificate of analysis, in one place. Routes, views and
// the admin form all read the panel list from here, so adding a panel is one
// entry rather than a hunt through templates.

/**
 * Test panels, in the order a lab prints them and the order the report shows
 * them. `key` is what the ENUM in the schema stores.
 *
 * Cannabinoids and terpenes are potency panels: the numbers are the point, and
 * they are shown as a full table. The rest are safety panels, where the only
 * thing most readers want is pass or fail, so they collapse to a status row
 * that opens on demand.
 */
const PANELS = [
  { key: 'cannabinoids', label: 'Cannabinoids', kind: 'potency', unit: '%', blurb: 'Potency: how much of each cannabinoid the batch contains.' },
  { key: 'terpenes', label: 'Terpenes', kind: 'potency', unit: '%', blurb: 'The aromatic compounds that give the batch its smell and taste.' },
  { key: 'pesticides', label: 'Pesticides', kind: 'safety', unit: 'ppb', blurb: 'Screened against the state action limits for pesticide residue.' },
  { key: 'heavy_metals', label: 'Heavy metals', kind: 'safety', unit: 'ppm', blurb: 'Lead, arsenic, cadmium and mercury.' },
  { key: 'microbials', label: 'Microbials', kind: 'safety', unit: 'CFU/g', blurb: 'Salmonella, E. coli and total viable counts.' },
  { key: 'mycotoxins', label: 'Mycotoxins', kind: 'safety', unit: 'ppb', blurb: 'Aflatoxins and ochratoxin A.' },
  { key: 'residual_solvents', label: 'Residual solvents', kind: 'safety', unit: 'ppm', blurb: 'Solvent left behind by extraction.' },
  { key: 'water_activity', label: 'Water activity & moisture', kind: 'safety', unit: 'aw', blurb: 'How likely the batch is to grow mould in storage.' },
  { key: 'foreign_matter', label: 'Foreign matter', kind: 'safety', unit: '%', blurb: 'Physical contaminants: stems, hair, insect parts.' },
];

const PANEL_KEYS = PANELS.map((p) => p.key);
const PANEL_BY_KEY = new Map(PANELS.map((p) => [p.key, p]));

/** Overall batch verdict and per-panel status share this vocabulary. */
const BATCH_STATUSES = ['pass', 'fail', 'pending'];
const PANEL_STATUSES = ['pass', 'fail', 'not_tested'];
const RESULT_STATUSES = ['pass', 'fail', 'nd', 'na'];

const STATUS_LABEL = {
  pass: 'Pass',
  fail: 'Fail',
  pending: 'Testing',
  not_tested: 'Not tested',
  nd: 'ND',
  na: '—',
};

/**
 * Which token in the palette a status gets. Pass is the olive the main site
 * already uses for success; fail is the in-palette danger rather than an
 * imported red; everything unresolved is neutral, because a pending batch is
 * not a warning — it is simply not finished.
 */
const STATUS_TONE = {
  pass: 'ok',
  fail: 'bad',
  pending: 'wait',
  not_tested: 'none',
  nd: 'none',
  na: 'none',
};

function panel(key) {
  return PANEL_BY_KEY.get(key) || { key, label: key, kind: 'safety', unit: '', blurb: '' };
}

function statusLabel(s) {
  return STATUS_LABEL[s] || String(s || '—');
}

function statusTone(s) {
  return STATUS_TONE[s] || 'none';
}

/**
 * The verdict shown at the top of a report.
 *
 * A batch is only a pass when every panel that ran passed. One failing panel
 * fails the batch, whatever the stored overall status says — that stored value
 * is the operator's own summary and can lag behind a result they just edited.
 * Deriving it here means the badge and the panel rows can never disagree, which
 * is the one inconsistency on this page nobody would forgive.
 */
function deriveStatus(storedStatus, panels = []) {
  if (panels.some((p) => p.status === 'fail')) return 'fail';
  if (storedStatus === 'pending') return 'pending';
  const tested = panels.filter((p) => p.status !== 'not_tested');
  if (!tested.length) return 'pending';
  return tested.every((p) => p.status === 'pass') ? 'pass' : storedStatus;
}

module.exports = {
  PANELS,
  PANEL_KEYS,
  BATCH_STATUSES,
  PANEL_STATUSES,
  RESULT_STATUSES,
  panel,
  statusLabel,
  statusTone,
  deriveStatus,
};
