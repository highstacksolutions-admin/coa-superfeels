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
<p>A certificate of analysis is the report an independent laboratory produces after testing one specific lot of product. We do not write it and we cannot alter it. The lab receives sealed units from a production run, tests them against a fixed set of methods, and publishes what the instruments measured.</p>
<p>Our testing is carried out by <strong>Cora Science, LLC</strong> of Austin, Texas, a laboratory accredited to ISO/IEC 17025:2017 by PJLA under accreditation number 116374. The lab, its address and its accreditation are printed on every page of the report.</p>

<h2>Finding your lot number</h2>
<p>Every bottle carries a lot number printed on the label. It is short, a couple of letters followed by three digits, and looks like <strong>MR014</strong>. That number, and only that number, ties the bottle in your hand to its lab reports.</p>
<p>Type it into the lookup box on the home page. Capitals and spacing do not matter.</p>
<p>When the report opens, check it against the bottle. Near the top of the first page is a <strong>Sample Image</strong>, a photograph of the actual units the laboratory received, with the lot number visible on them. It should read the same as yours.</p>

<h2>One lot, more than one report</h2>
<p>Do not expect to find everything on a single document. A lot is sampled more than once, for different purposes, and each submission produces its own report with its own Job ID and its own dates. Between them they cover:</p>
<ul>
<li><strong>Potency</strong> &mdash; what active compounds are in the product and how much of each.</li>
<li><strong>Safety</strong> &mdash; microbial contamination and heavy metals.</li>
</ul>
<p>Lot MR014 is a good example. Its potency work was received on 12 May and issued on 19 May under Job ID ISO07077. Its safety work was received on 29 May and issued on 2 June under Job ID ISO07219. Both describe the same lot. If the lookup page lists more than one report, read both.</p>

<h2>Checking the header first</h2>
<p>Before reading a single result, confirm the report is about your product. The top of page one tells you:</p>
<ul>
<li><strong>Client</strong> &mdash; should read Super Feels. A report issued to anyone else is not ours.</li>
<li><strong>Name</strong> &mdash; the product the lab was given, such as Kratom Kava Shot.</li>
<li><strong>Lot Number</strong> &mdash; must match your bottle.</li>
<li><strong>Job ID and Sample ID</strong> &mdash; the laboratory tracking numbers for that submission.</li>
<li><strong>Received, Completed and Issued</strong> &mdash; when the lab took the sample in, finished the work, and released the report.</li>
<li><strong>Revision</strong> &mdash; shown in the page header. Revision 00 is the original release. A higher number means the lab reissued the report, and the Revision History section near the back says why.</li>
</ul>

<h2>The potency panels</h2>

<h3>Mitragyna alkaloids</h3>
<p>The alkaloids that occur naturally in kratom leaf. The panel reports each one separately and then totals them.</p>
<ul>
<li><strong>Mitragynine</strong> &mdash; the most abundant alkaloid in the leaf, and the figure most people are looking for. On lot MR014 it measured 1.28 mg/mL.</li>
<li><strong>7-Hydroxymitragynine</strong> &mdash; present naturally in very small amounts. On MR014 it measured 0.00493 mg/mL.</li>
<li><strong>Paynantheine, speciogynine and speciociliatine</strong> &mdash; the other alkaloids that come with whole leaf. Seeing them reported alongside mitragynine is what a leaf-derived product looks like.</li>
<li><strong>Total Mitragyna Alkaloids</strong> &mdash; the sum of the rows above. On MR014, 1.82 mg/mL.</li>
</ul>
<p>The relationship worth understanding is between the first two. On MR014, 7-hydroxymitragynine is under half a percent of the mitragynine figure, which is the range you expect from ordinary leaf material. A report where 7-hydroxymitragynine makes up a large share of the total alkaloids is describing a concentrated or enriched product rather than a leaf one. The ratio tells you more than either number on its own.</p>

<h3>Kavalactones</h3>
<p>The active compounds in kava root. Six are reported individually, along with three flavokawains:</p>
<ul>
<li><strong>Kavain, dihydrokavain, methysticin, dihydromethysticin, yangonin and desmethoxyyangonin</strong> &mdash; the six kavalactones that account for most of the activity. Their proportions vary between kava cultivars and growing regions, so two honest reports of the same product can look different here.</li>
<li><strong>Flavokawain A, B and C</strong> &mdash; minor compounds reported for completeness. On MR014, flavokawain C came back below the limit of quantitation.</li>
<li><strong>Total Kavalactones</strong> &mdash; the figure to read if you want a single number. On MR014, 6.57 mg/mL.</li>
</ul>

<h3>Unit weight analysis</h3>
<p>A density measurement, 1.017 g/mL on MR014. It looks like housekeeping, but the lab uses it to convert the potency results between units, which is the subject of the next section.</p>

<h2>Two units, one set of results</h2>
<p>This is the part that causes the most confusion. Each potency panel is printed <strong>twice</strong>, once in <strong>mg/mL</strong> and once in <strong>w/w%</strong>. These are not two separate tests and they do not add up. They are the same measurements expressed two ways, converted using the measured density, and the report says exactly that in its Additional Report Notes. Do not add them together.</p>
<ul>
<li><strong>mg/mL</strong> &mdash; milligrams per millilitre of liquid. Use this if you want to know how much is in the bottle.</li>
<li><strong>w/w%</strong> &mdash; percentage by weight. Use this to compare against a product sold by weight rather than by volume.</li>
</ul>
<p>To get the amount in a whole unit, multiply the mg/mL figure by the volume of the bottle in millilitres. At 1.28 mg/mL, a 60 mL shot contains roughly 77 mg of mitragynine. At 6.57 mg/mL, the same 60 mL contains roughly 394 mg of total kavalactones. Use the volume printed on your own label, since it is the only figure that applies to what you bought.</p>

<h2>The safety panels</h2>

<h3>Microbial examination</h3>
<p>Five tests for organisms that should not be in a drink: total aerobic plate count, total yeast and mould, total coliforms, <em>Escherichia coli</em> and <em>Salmonella</em>. The first three carry an upper limit in colony forming units. The last two must not be detected at all in a ten gram sample. Every row carries its own verdict in the Notes column.</p>

<h3>Elemental impurities</h3>
<p>Arsenic, cadmium, mercury and lead, measured by ICP-MS. Each has its own limit and each is judged against it individually. These are the four to check if you read nothing else on the safety report.</p>

<h2>How to tell a limit from a measurement</h2>
<p>The <strong>Specification</strong> column tells you how to read the row, and it says one of two things:</p>
<ul>
<li><strong>Report Results</strong> &mdash; there is no pass or fail here. The lab was asked to measure the value and state it, nothing more. Every potency row works this way, which is why a potency panel cannot be failed.</li>
<li><strong>A limit, written as NMT</strong> &mdash; not more than. The result is judged against it, and the <strong>Notes</strong> column on the right carries the verdict. Every safety row works this way.</li>
</ul>
<p>So a page full of <em>Report Results</em> is not a page with no standards applied. It is a page where the measurement itself is the answer. Look to the Notes column for a verdict, and where that column is populated, read it.</p>

<h2>Reading the values</h2>
<ul>
<li><strong>&lt;LOQ</strong> &mdash; below the limit of quantitation. Something may be present, in a trace too small to put a reliable number on. On a safety panel this is the result you want.</li>
<li><strong>Not Detected</strong> or <strong>ND</strong> &mdash; not found at any level the method can measure.</li>
<li><strong>LOQ</strong> &mdash; the smallest amount that method can put a number on. It describes the sensitivity of the test, not the contents of the bottle.</li>
<li><strong>NMT</strong> and <strong>NLT</strong> &mdash; not more than, and not less than. The boundaries a specification sets.</li>
<li><strong>CFU/g</strong> &mdash; colony forming units per gram, the unit for microbial counts.</li>
<li><strong>N/A</strong> &mdash; not applicable to that row.</li>
<li><strong>Method Code</strong> &mdash; the laboratory reference for the procedure used, such as T102 for the alkaloid panel. Beside it is the date and time the instrument ran.</li>
</ul>

<h2>Confirming a report is genuine</h2>
<p>Anyone can put a PDF on a website. These are the marks that make a real report checkable:</p>
<ul>
<li><strong>The Report ID</strong> in the Revision History section, a long unique identifier issued by the laboratory for that document.</li>
<li><strong>The Authorization page</strong> at the end, signed and dated by the laboratory director, naming the person who released it.</li>
<li><strong>The page footer</strong>, which repeats the work order, sample number and dates on every single page.</li>
<li><strong>The accreditation statement</strong>, which names ISO/IEC 17025:2017 and the accrediting body.</li>
</ul>
<p>That footer also states the report may not be reproduced except in its entirety. Treat that as your cue to be wary of a single page, a cropped screenshot, or a results table retyped onto a web page. Ask for the whole PDF, which is exactly what this site gives you.</p>

<h2>What a report cannot tell you</h2>
<p>A COA describes the sample the laboratory received, on the date it was tested. It does not speak for any other lot, and it says nothing about how a bottle was stored after it left us. Results relate only to the specific material analysed, which is the reason testing is done lot by lot rather than once per product.</p>

<h2>If something does not match</h2>
<p>If your lot number returns nothing, if the report describes a product other than the one you are holding, or if a figure does not look right to you, tell us. All three are things we want to know about immediately, and the form on the <a href="/contact">contact page</a> reaches us directly. Send the lot number with your message.</p>',
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
