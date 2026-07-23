
-- 1) Backfill NULL locations/warehouses on legacy serials
UPDATE public.goods_receipt_serials s
   SET current_warehouse_id = COALESCE(gr.warehouse_id, '9e32410e-3701-4419-a5f7-f506404c6fe8'),
       current_location = CASE
         WHEN s.stock_status = 'under_correction'
           THEN '916d4a22-52c8-490b-a241-3e0252780999'
         ELSE 'a780428b-78e0-4884-8ba1-cb7d87b7faa9'
       END,
       updated_at = now()
  FROM public.goods_receipts gr
 WHERE gr.id = s.goods_receipt_id
   AND (s.current_warehouse_id IS NULL OR s.current_location IS NULL OR s.current_location = '');

-- Also patch any serials with no goods_receipt row (defensive)
UPDATE public.goods_receipt_serials s
   SET current_warehouse_id = '9e32410e-3701-4419-a5f7-f506404c6fe8',
       current_location = CASE
         WHEN s.stock_status = 'under_correction'
           THEN '916d4a22-52c8-490b-a241-3e0252780999'
         ELSE 'a780428b-78e0-4884-8ba1-cb7d87b7faa9'
       END,
       updated_at = now()
 WHERE s.current_warehouse_id IS NULL OR s.current_location IS NULL OR s.current_location = '';

-- 2) Rebuild serial_reconciliation view: compare IDs, show names
DROP VIEW IF EXISTS public.serial_reconciliation;
CREATE VIEW public.serial_reconciliation
WITH (security_invoker = on) AS
WITH latest AS (
  SELECT DISTINCT ON (s.id)
    s.id AS serial_id,
    s.serial_number,
    s.product_id,
    s.stock_status AS actual_status,
    NULLIF(s.current_location, '')::uuid AS actual_location_id,
    sml.destination_location_id AS expected_location_id,
    sm.effective_date AS last_move_at,
    sm.reference_document_type AS last_doc_type,
    sm.reference_document_id AS last_doc_id,
    sm.reference AS last_move_ref
  FROM public.goods_receipt_serials s
    JOIN public.stock_move_lines sml ON s.serial_number = ANY (sml.serial_numbers)
    JOIN public.stock_moves sm ON sm.id = sml.stock_move_id
  WHERE sm.state = 'done'
  ORDER BY s.id, sm.effective_date DESC NULLS LAST, sm.created_at DESC
)
SELECT
  l.serial_id,
  l.serial_number,
  l.product_id,
  l.actual_status,
  al.name AS actual_location,
  el.name AS expected_location,
  el.code AS expected_location_code,
  l.last_move_at,
  l.last_doc_type,
  l.last_doc_id,
  l.last_move_ref,
  'location_mismatch'::text AS issue
FROM latest l
  LEFT JOIN public.warehouse_locations al ON al.id = l.actual_location_id
  LEFT JOIN public.warehouse_locations el ON el.id = l.expected_location_id
WHERE l.actual_location_id IS DISTINCT FROM l.expected_location_id
  AND l.actual_status <> 'sold';

GRANT SELECT ON public.serial_reconciliation TO authenticated, service_role;

-- 3) Rebuild serials_without_history to show location name
DROP VIEW IF EXISTS public.serials_without_history;
CREATE VIEW public.serials_without_history
WITH (security_invoker = on) AS
SELECT
  s.id AS serial_id,
  s.serial_number,
  s.product_id,
  s.stock_status AS actual_status,
  wl.name AS actual_location,
  s.created_at
FROM public.goods_receipt_serials s
LEFT JOIN public.warehouse_locations wl
  ON wl.id = NULLIF(s.current_location, '')::uuid
WHERE NOT EXISTS (
  SELECT 1
  FROM public.stock_move_lines sml
    JOIN public.stock_moves sm ON sm.id = sml.stock_move_id
  WHERE sm.state = 'done'
    AND s.serial_number = ANY (sml.serial_numbers)
);

GRANT SELECT ON public.serials_without_history TO authenticated, service_role;
