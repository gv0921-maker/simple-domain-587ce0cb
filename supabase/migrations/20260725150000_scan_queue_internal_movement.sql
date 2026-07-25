-- Batch 6: allow internal_movement in the scan queue.
--
-- createInternalMovement (and so pick-to-transit) calls
-- addToScanQueue('internal_movement', ...), but the scan_queue document_type
-- CHECK did not permit that value, so the insert failed and the best-effort
-- catch swallowed it — pick-to-transit movements never appeared in the barcode
-- queue. Adding the value lets them surface so the queue can deep-link to the
-- movement detail page for scan + QC.

ALTER TABLE public.scan_queue DROP CONSTRAINT IF EXISTS scan_queue_document_type_check;
ALTER TABLE public.scan_queue ADD CONSTRAINT scan_queue_document_type_check
  CHECK (document_type = ANY (ARRAY[
    'goods_receipt','internal_transfer','pre_delivery_qc','return_receipt',
    'stock_count','correction_order','write_off','delivery_note','internal_movement'
  ]::text[]));
