-- Starting content for the two editable pages and the site's settings.
--
-- INSERT IGNORE, not INSERT: this migration must be a no-op on a database that
-- already has these rows, because the operator will have edited them in the
-- admin and a re-run must not overwrite their copy with this default.

INSERT IGNORE INTO content_pages (slug, title, meta_description, body, sort_order) VALUES
('how-to-read-a-coa',
 'How to read a COA',
 'What a certificate of analysis is, what each panel tests for, and how to check it against the product in your hand.',
 '<h2>What a COA is</h2>
<p>A certificate of analysis is the report an independent laboratory produces after testing a specific batch of product. It is not a marketing document and it is not written by us. The lab receives a sample, runs it against a fixed set of panels, and publishes what it measured.</p>
<p>Every Super Feels product carries a batch code. That code, and only that code, ties the item in your hand to one report. Two jars of the same product from different production runs have different batch codes and different reports.</p>

<h2>Finding your batch code</h2>
<p>The batch code is printed on the product itself — usually on the base of the container or along the bottom edge of the label, next to the best-before date. It looks something like <strong>SF-2409-A12</strong>.</p>
<p>Type it into the lookup box on the home page. Punctuation and capitals do not matter: <em>sf 2409 a12</em> and <em>SF2409A12</em> both find the same report.</p>

<h2>The panels</h2>
<h3>Cannabinoids</h3>
<p>Potency. This is where the total THC and total CBD figures come from, and it is the panel to check against the number printed on the label. Small differences are normal and expected — laboratories work to a stated tolerance, and a result within a few percent of the label is a match, not a discrepancy.</p>

<h3>Terpenes</h3>
<p>The aromatic compounds responsible for how a batch smells and tastes. Terpene content varies far more between batches than cannabinoid content does, and none of it is a safety measure.</p>

<h3>Pesticides, heavy metals, microbials, mycotoxins, residual solvents</h3>
<p>The safety panels. Each analyte is measured against an action limit, and the panel passes only if every analyte in it comes in under that limit. For these panels the numbers matter less than the verdict: a pass means nothing was found above the level regulators consider safe.</p>

<h3>Water activity, moisture and foreign matter</h3>
<p>Storage and handling measures. Water activity predicts whether a batch can grow mould in the container; foreign matter is a physical inspection.</p>

<h2>Reading the values</h2>
<ul>
<li><strong>ND</strong> — not detected. The analyte was not present at any level the instrument can measure.</li>
<li><strong>&lt;LOQ</strong> — detected, but below the limit of quantitation. Present in a trace amount too small to put a reliable number on.</li>
<li><strong>LOD / LOQ</strong> — the limits of detection and quantitation for that instrument and method. They describe the test''s sensitivity, not the batch.</li>
<li><strong>Limit</strong> — the action limit the result is judged against.</li>
</ul>

<h2>If something does not match</h2>
<p>If the batch code on your product returns nothing, or the report you get does not describe the product you are holding, tell us. Both are things we want to know about immediately, and there is a form on the <a href="/contact">contact page</a> that reaches us directly.</p>',
 1),

('faq',
 'Frequently asked questions',
 'Answers to the common questions about batch codes, lab reports and test results for Super Feels products.',
 '<h2>Lookups</h2>
<h3>My batch code returns nothing. What now?</h3>
<p>First, check the code against the product again — a 0 read as an O, or a 1 as an I, is the usual cause. You do not need to reproduce the dashes or the capitals; only the letters and digits matter.</p>
<p>If it still finds nothing, the batch may have been tested but not yet published, or the code may not be ours. Either way we want to hear about it. Send us the code through the <a href="/contact">contact form</a> and we will tell you exactly what it is.</p>

<h3>Where do I find the batch code?</h3>
<p>On the product, not on the box it shipped in. It is usually on the base of the container or along the bottom edge of the label, next to the best-before date.</p>

<h3>Can I see reports for other batches of the same product?</h3>
<p>Each report belongs to one batch. A report for a different batch of the same product tells you nothing reliable about the one you are holding, which is the entire reason batch-level testing exists.</p>

<h2>Results</h2>
<h3>The THC number does not match my label exactly.</h3>
<p>That is expected. Laboratory results carry a stated measurement tolerance, and label figures are set from the batch result within that tolerance. A result a few percent either side of the label is a match. A result well outside it is not, and we would like to know.</p>

<h3>What does ND mean?</h3>
<p>Not detected — the analyte was not found at any level the instrument can measure. It is the result you want to see on every safety panel.</p>

<h3>What makes a batch fail?</h3>
<p>Any single analyte over its action limit fails the panel it belongs to, and any failing panel fails the batch. A failed batch is not released for sale. If you are holding a product whose report shows a failure, stop using it and <a href="/contact">contact us</a>.</p>

<h3>Who does the testing?</h3>
<p>Independent, accredited laboratories — never us. The laboratory that tested your batch, its licence number and its accreditation are named at the bottom of every report.</p>

<h2>The reports themselves</h2>
<h3>Can I download the report?</h3>
<p>Yes. Every report page has a download button that gives you the laboratory''s own signed PDF, unaltered. That document, not this website, is the authoritative record.</p>

<h3>How long do reports stay up?</h3>
<p>Indefinitely. A batch report remains available long after that batch has sold through, because the product may still be in someone''s cupboard.</p>',
 2);

INSERT IGNORE INTO settings (name, value) VALUES
('site_tagline', 'Every batch, independently tested. Enter the code from your product to see its lab report.'),
('lookup_help', 'The batch code is printed on the base of the container or along the bottom edge of the label.'),
('contact_intro', 'Cannot find a batch, or something on a report does not look right? Tell us and we will look into it.');
