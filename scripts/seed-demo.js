#!/usr/bin/env node
'use strict';

// Demo data so the site shows something real to look at: a couple of labs, a
// few products, and batches that exercise every state — a clean pass, a fail,
// and one still pending. Idempotent: it clears the demo rows it owns first, so
// running it twice does not pile up duplicates.
//
//   npm run seed:demo

const db = require('../src/config/db');
const { batchKey } = require('../src/lib/validate');

async function main() {
  console.log('Seeding demo data…');

  // Wipe in FK order. Only touches content this script created.
  await db.query('DELETE FROM results');
  await db.query('DELETE FROM result_panels');
  await db.query('DELETE FROM coa_files');
  await db.query('DELETE FROM lookups');
  await db.query('DELETE FROM coa_downloads');
  await db.query('DELETE FROM batches');
  await db.query('DELETE FROM products');
  await db.query('DELETE FROM labs');

  const lab1 = (await db.query(
    `INSERT INTO labs (name, slug, license_no, accreditation, website, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    ['Anresco Laboratories', 'anresco', 'C8-0000123-LIC', 'ISO/IEC 17025:2017', 'https://www.anresco.com']
  )).insertId;
  const lab2 = (await db.query(
    `INSERT INTO labs (name, slug, license_no, accreditation, website, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    ['SC Labs', 'sc-labs', 'C8-0000456-LIC', 'ISO/IEC 17025:2017', 'https://www.sclabs.com']
  )).insertId;

  const products = [
    { name: 'Calm Gummies', category: 'Gummies', size: '20 ct', sku: 'SF-GUM-CALM' },
    { name: 'Full-Spectrum Oil', category: 'Tincture', size: '30 ml', sku: 'SF-OIL-FS30' },
    { name: 'Recovery Balm', category: 'Topical', size: '50 g', sku: 'SF-BALM-REC' },
    { name: 'Sleep Softgels', category: 'Capsules', size: '30 ct', sku: 'SF-CAP-SLEEP' },
  ];
  const productIds = {};
  let order = 0;
  for (const p of products) {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    productIds[p.name] = (await db.query(
      `INSERT INTO products (name, slug, sku, category, size_label, description, sort_order, is_published)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [p.name, slug, p.sku, p.category, p.size,
       `${p.name} — every production run independently tested and published here.`, order++]
    )).insertId;
  }

  // A batch, its panels and analytes. `pub` false makes a draft.
  async function makeBatch(opts) {
    const key = batchKey(opts.code);
    const id = (await db.query(
      `INSERT INTO batches (product_id, lab_id, batch_code, batch_key, status, lab_sample_id,
              manufactured_on, tested_on, expires_on, total_thc, total_cbd, potency_unit, is_published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '%', ?)`,
      [opts.productId, opts.labId, opts.code, key, opts.status, opts.sampleId,
       opts.made, opts.tested, opts.expires, opts.thc, opts.cbd, opts.pub ? 1 : 0]
    )).insertId;

    for (const panel of opts.panels) {
      const panelId = (await db.query(
        `INSERT INTO result_panels (batch_id, panel, status, method, summary) VALUES (?, ?, ?, ?, ?)`,
        [id, panel.key, panel.status, panel.method || null, panel.summary || null]
      )).insertId;
      let s = 0;
      for (const r of (panel.rows || [])) {
        const numeric = Number(String(r[1]).replace(/[^0-9.]/g, '')) || null;
        await db.query(
          `INSERT INTO results (panel_id, analyte, value_text, numeric_value, unit, lod, loq, limit_text, status, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [panelId, r[0], r[1], numeric, r[2] || null, r[3] || null, r[4] || null, r[5] || null, r[6] || 'na', s++]
        );
      }
    }
    return id;
  }

  const cannabinoids = (thc, cbd) => ({
    key: 'cannabinoids', status: 'pass', method: 'HPLC-DAD',
    rows: [
      ['Δ9-THC', thc, '%', '0.01', '0.03', '', 'na'],
      ['THCA', '0.12', '%', '0.01', '0.03', '', 'na'],
      ['CBD', cbd, '%', '0.01', '0.03', '', 'na'],
      ['CBDA', '0.04', '%', '0.01', '0.03', '', 'na'],
      ['CBG', '0.31', '%', '0.01', '0.03', '', 'na'],
      ['CBN', 'ND', '%', '0.01', '0.03', '', 'nd'],
    ],
  });
  const terpenes = {
    key: 'terpenes', status: 'pass', method: 'GC-MS',
    rows: [
      ['β-Myrcene', '0.42', '%', '0.01', '0.03', '', 'na'],
      ['Limonene', '0.28', '%', '0.01', '0.03', '', 'na'],
      ['β-Caryophyllene', '0.19', '%', '0.01', '0.03', '', 'na'],
      ['Linalool', '0.08', '%', '0.01', '0.03', '', 'na'],
    ],
  };
  const safePass = (unit, limit) => (key, method) => ({
    key, status: 'pass', method,
    rows: [['All analytes', 'ND', unit, '', '', limit, 'nd']],
    summary: 'All analytes below the action limit.',
  });
  const pesticidesPass = { key: 'pesticides', status: 'pass', method: 'LC-MS/MS', summary: 'Screened against CA action limits. All pass.', rows: [
    ['Abamectin', 'ND', 'ppb', '', '', '300', 'nd'],
    ['Bifenazate', 'ND', 'ppb', '', '', '5000', 'nd'],
    ['Myclobutanil', 'ND', 'ppb', '', '', '9000', 'nd'],
  ] };
  const metalsPass = { key: 'heavy_metals', status: 'pass', method: 'ICP-MS', rows: [
    ['Lead', 'ND', 'ppm', '', '', '0.5', 'nd'],
    ['Arsenic', 'ND', 'ppm', '', '', '1.5', 'nd'],
    ['Cadmium', 'ND', 'ppm', '', '', '0.5', 'nd'],
    ['Mercury', 'ND', 'ppm', '', '', '3.0', 'nd'],
  ] };
  const microPass = { key: 'microbials', status: 'pass', method: 'qPCR', rows: [
    ['Salmonella', 'Not detected', 'CFU/g', '', '', 'Absent', 'pass'],
    ['E. coli (STEC)', 'Not detected', 'CFU/g', '', '', 'Absent', 'pass'],
  ] };
  const solventsPass = { key: 'residual_solvents', status: 'pass', method: 'GC-FID', rows: [
    ['Ethanol', '210', 'ppm', '', '', '5000', 'pass'],
    ['Butane', 'ND', 'ppm', '', '', '5000', 'nd'],
  ] };

  // 1. Clean pass, popular.
  await makeBatch({
    productId: productIds['Calm Gummies'], labId: lab1, code: 'SF-2409-A12', status: 'pass', pub: true,
    sampleId: 'ANR-24-88213', made: '2024-08-15', tested: '2024-09-02', expires: '2026-09-01',
    thc: '0.18', cbd: '24.60',
    panels: [cannabinoids('0.18', '24.60'), terpenes, pesticidesPass, metalsPass, microPass, solventsPass,
      { key: 'mycotoxins', status: 'pass', method: 'LC-MS/MS', rows: [['Aflatoxin B1', 'ND', 'ppb', '', '', '20', 'nd']] }],
  });

  // 2. Full-spectrum oil, pass, different lab.
  await makeBatch({
    productId: productIds['Full-Spectrum Oil'], labId: lab2, code: 'SF-2410-B07', status: 'pass', pub: true,
    sampleId: 'SC-24-10442', made: '2024-09-20', tested: '2024-10-05', expires: '2026-10-01',
    thc: '2.40', cbd: '33.10',
    panels: [cannabinoids('2.40', '33.10'), terpenes, pesticidesPass, metalsPass, microPass, solventsPass],
  });

  // 3. A FAIL — heavy metals over the lead limit.
  await makeBatch({
    productId: productIds['Recovery Balm'], labId: lab1, code: 'SF-2408-C03', status: 'fail', pub: true,
    sampleId: 'ANR-24-77120', made: '2024-07-10', tested: '2024-08-01', expires: '2026-08-01',
    thc: '0.05', cbd: '12.00',
    panels: [
      cannabinoids('0.05', '12.00'),
      { key: 'heavy_metals', status: 'fail', method: 'ICP-MS', summary: 'Lead exceeded the action limit.', rows: [
        ['Lead', '0.82', 'ppm', '', '', '0.5', 'fail'],
        ['Arsenic', 'ND', 'ppm', '', '', '1.5', 'nd'],
        ['Cadmium', 'ND', 'ppm', '', '', '0.5', 'nd'],
        ['Mercury', 'ND', 'ppm', '', '', '3.0', 'nd'],
      ] },
      pesticidesPass, microPass,
    ],
  });

  // 4. Pending — sent to the lab, not all panels back.
  await makeBatch({
    productId: productIds['Sleep Softgels'], labId: lab2, code: 'SF-2411-D19', status: 'pending', pub: true,
    sampleId: 'SC-24-11890', made: '2024-10-25', tested: '2024-11-08', expires: '2026-11-01',
    thc: '0.10', cbd: '15.50',
    panels: [
      cannabinoids('0.10', '15.50'),
      { key: 'pesticides', status: 'not_tested', rows: [] },
    ],
  });

  // 5. A second Calm Gummies batch, so the report shows siblings.
  await makeBatch({
    productId: productIds['Calm Gummies'], labId: lab1, code: 'SF-2405-A04', status: 'pass', pub: true,
    sampleId: 'ANR-24-61002', made: '2024-04-12', tested: '2024-05-02', expires: '2026-05-01',
    thc: '0.20', cbd: '23.90',
    panels: [cannabinoids('0.20', '23.90'), terpenes, pesticidesPass, metalsPass],
  });

  // 6. A draft, so the admin "needs attention" list is not empty.
  await makeBatch({
    productId: productIds['Full-Spectrum Oil'], labId: lab2, code: 'SF-2412-B11', status: 'pending', pub: false,
    sampleId: null, made: '2024-11-30', tested: null, expires: null, thc: null, cbd: null,
    panels: [],
  });

  // A few lookups so the analytics chart is not blank.
  const found = await db.query("SELECT id FROM batches WHERE is_published = 1 LIMIT 3");
  for (let d = 0; d < 14; d++) {
    const when = `DATE_SUB(NOW(), INTERVAL ${d} DAY)`;
    const hits = Math.floor(Math.random() * 6) + 1;
    for (let i = 0; i < hits; i++) {
      const b = found[Math.floor(Math.random() * found.length)];
      await db.query(
        `INSERT INTO lookups (query, batch_id, found, source, created_at) VALUES ('SF-DEMO', ?, 1, 'qr', ${when})`,
        [b.id]
      );
    }
    if (Math.random() > 0.5) {
      await db.query(
        `INSERT INTO lookups (query, batch_id, found, source, created_at) VALUES ('SF-9999-XX', NULL, 0, 'form', ${when})`
      );
    }
  }

  console.log('Done. Demo batches: SF-2409-A12 (pass), SF-2408-C03 (fail), SF-2411-D19 (pending).');
  await db.pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await db.pool.end(); } catch {}
  process.exit(1);
});
