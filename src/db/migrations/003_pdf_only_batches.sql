-- Batches become "a batch number and the laboratory's PDF".
--
-- Nothing from the report is transcribed any more: the PDF is the record, and
-- the public page shows it in full. The product is optional for the same
-- reason — the PDF names the product itself, and uploading a report should not
-- be blocked on setting up the catalogue first.
--
-- The results tables and the lab/date/potency columns on batches are left in
-- place, unused, so that this migration cannot destroy data. Drop them in a
-- later migration once nothing depends on what they hold.

ALTER TABLE batches MODIFY product_id INT UNSIGNED NULL;
