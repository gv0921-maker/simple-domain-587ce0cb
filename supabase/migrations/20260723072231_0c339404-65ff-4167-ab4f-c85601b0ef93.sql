
-- Latest completed ledger move per serial
CREATE OR REPLACE VIEW public.serial_reconciliation
WITH (security_invoker = true) AS
WITH latest AS (
  SELECT DISTINCT ON (s.id)
    s.id                        AS serial_id,
    s.serial_number,
    s.product_id,
    s.stock_status              AS actual_status,
    s.current_location          AS actual_location,
    dl.name                     AS expected_location,
    dl.code                     AS expected_location_code,
    sm.effective_date           AS last_move_at,
    sm.reference_document_type  AS last_doc_type,
    sm.reference_document_id    AS last_doc_id,
    sm.reference                AS last_move_ref
  FROM public.goods_receipt_serials s
  JOIN public.stock_move_lines sml
    ON s.serial_number = ANY (sml.serial_numbers)
  JOIN public.stock_moves sm
    ON sm.id = sml.stock_move_id
  LEFT JOIN public.warehouse_locations dl
    ON dl.id = sml.destination_location_id
  WHERE sm.state = 'done'
  ORDER BY s.id, sm.effective_date DESC NULLS LAST, sm.created_at DESC
)
SELECT
  serial_id,
  serial_number,
  product_id,
  actual_status,
  actual_location,
  expected_location,
  expected_location_code,
  last_move_at,
  last_doc_type,
  last_doc_id,
  last_move_ref,
  CASE
    WHEN actual_location IS DISTINCT FROM expected_location
     AND (actual_status = 'available' OR actual_status IS NULL)
      THEN 'location_mismatch_available'
    WHEN actual_location IS DISTINCT FROM expected_location
      THEN 'location_mismatch'
    ELSE 'ok'
  END AS issue
FROM latest
WHERE actual_location IS DISTINCT FROM expected_location;

-- Serials with no ledger history yet (pre-cutover)
CREATE OR REPLACE VIEW public.serials_without_history
WITH (security_invoker = true) AS
SELECT
  s.id                AS serial_id,
  s.serial_number,
  s.product_id,
  s.stock_status      AS actual_status,
  s.current_location  AS actual_location,
  s.created_at
FROM public.goods_receipt_serials s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.stock_move_lines sml
  JOIN public.stock_moves sm ON sm.id = sml.stock_move_id
  WHERE sm.state = 'done'
    AND s.serial_number = ANY (sml.serial_numbers)
);

-- Reservations that shouldn't be active
CREATE OR REPLACE VIEW public.reservation_health
WITH (security_invoker = true) AS
SELECT
  r.id                AS reservation_id,
  r.sales_order_id,
  r.order_line_id,
  r.product_id,
  r.serial_number_id,
  r.quantity,
  r.status            AS reservation_status,
  r.reserved_at,
  s.serial_number,
  s.stock_status      AS serial_stock_status,
  s.current_location  AS serial_location,
  so.reference        AS so_reference,
  so.status           AS so_status,
  CASE
    WHEN s.id IS NOT NULL AND s.stock_status NOT IN ('available','reserved')
      THEN 'serial_not_available'
    WHEN so.status IN ('done','cancelled','delivered','completed','closed')
      THEN 'order_closed'
    ELSE 'unknown'
  END AS issue
FROM public.stock_reservations r
LEFT JOIN public.goods_receipt_serials s ON s.id = r.serial_number_id
LEFT JOIN public.sales_orders so ON so.id = r.sales_order_id
WHERE r.status = 'active'
  AND (
    (s.id IS NOT NULL AND s.stock_status NOT IN ('available','reserved'))
    OR so.status IN ('done','cancelled','delivered','completed','closed')
  );

GRANT SELECT ON public.serial_reconciliation   TO authenticated;
GRANT SELECT ON public.serials_without_history TO authenticated;
GRANT SELECT ON public.reservation_health      TO authenticated;
