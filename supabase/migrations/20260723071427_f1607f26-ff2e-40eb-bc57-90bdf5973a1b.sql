
CREATE OR REPLACE FUNCTION public.complete_delivery_with_qc(
  _dn_id uuid,
  _signature_received boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_dn record;
  v_so_id uuid;
  v_paid numeric;
  v_total numeric;
  v_cust_loc record;
  v_delivered_count int := 0;
  v_failed_count int := 0;
  v_failed_serials text[] := ARRAY[]::text[];
  v_all_delivered boolean;
  v_so_closed boolean := false;
  v_move_id uuid;
  r record;
BEGIN
  -- 1. Lock DN
  SELECT * INTO v_dn FROM delivery_notes WHERE id = _dn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery note not found'; END IF;
  IF v_dn.status = 'delivered' THEN RAISE EXCEPTION 'Delivery note already delivered'; END IF;
  v_so_id := v_dn.sales_order_id;
  IF v_so_id IS NULL THEN RAISE EXCEPTION 'Delivery note has no linked sales order'; END IF;

  -- 2. Payment gate (defence-in-depth)
  SELECT COALESCE(paid_amount,0), COALESCE(grand_total, total, 0)
    INTO v_paid, v_total
  FROM sales_orders WHERE id = v_so_id FOR UPDATE;
  IF v_total <= 0 OR v_paid + 0.005 < v_total THEN
    RAISE EXCEPTION 'Delivery available after full payment. Current: ₹% paid of ₹%', v_paid, v_total;
  END IF;

  -- 3. Resolve destination CUSTOMERS location
  SELECT id, name INTO v_cust_loc
  FROM warehouse_locations
  WHERE code = 'CTMR107' OR (type = 'customer' AND is_active = true)
  ORDER BY (code = 'CTMR107') DESC
  LIMIT 1;
  IF v_cust_loc.id IS NULL THEN
    RAISE EXCEPTION 'CUSTOMERS location not configured';
  END IF;

  -- 4. Load QC inspections for this DN, join with locked serials
  CREATE TEMP TABLE _dn_insp ON COMMIT DROP AS
  SELECT
    i.serial_number,
    i.qc_status,
    i.qc_notes,
    i.photo_urls,
    g.id AS grs_id,
    g.product_id,
    g.current_location,
    g.current_warehouse_id,
    g.stock_status
  FROM qc_inspections i
  LEFT JOIN goods_receipt_serials g
    ON lower(g.serial_number) = lower(i.serial_number)
   AND g.reserved_for_so_id = v_so_id
  WHERE i.document_type = 'delivery_note'
    AND i.document_id = _dn_id
    AND i.qc_status IN ('pass','fail');

  -- Lock the matching serial rows
  PERFORM 1 FROM goods_receipt_serials
   WHERE id IN (SELECT grs_id FROM _dn_insp WHERE grs_id IS NOT NULL)
   FOR UPDATE;

  -- Verify every scanned serial belongs to the SO's reserved pool
  FOR r IN SELECT * FROM _dn_insp WHERE grs_id IS NULL LOOP
    RAISE EXCEPTION 'Serial % is not reserved for this order', r.serial_number;
  END LOOP;

  SELECT
    count(*) FILTER (WHERE qc_status='fail'),
    count(*) FILTER (WHERE qc_status='pass'),
    COALESCE(array_agg(serial_number) FILTER (WHERE qc_status='fail'), ARRAY[]::text[])
  INTO v_failed_count, v_delivered_count, v_failed_serials
  FROM _dn_insp;

  IF v_failed_count > 0 THEN
    RAISE EXCEPTION 'Cannot deliver: % unit(s) failed QC at handoff (%). Resolve before completing.',
      v_failed_count, array_to_string(v_failed_serials, ', ');
  END IF;
  IF v_delivered_count = 0 THEN
    RAISE EXCEPTION 'No passed units to deliver';
  END IF;

  -- 5. Insert stock_moves + lines (source: current location → CUSTOMERS)
  FOR r IN
    SELECT p.name AS product_name, COALESCE(p.sku,'') AS product_sku,
           array_agg(i.serial_number) AS serials,
           i.current_location, i.product_id
    FROM _dn_insp i JOIN products p ON p.id = i.product_id
    WHERE i.qc_status = 'pass'
    GROUP BY p.name, p.sku, i.current_location, i.product_id
  LOOP
    INSERT INTO stock_moves (
      reference, operation_type, source_location_id, source_location_name,
      destination_location_id, destination_location_name, state,
      source_document, effective_date, created_by,
      reference_document_type, reference_document_id
    ) VALUES (
      'DEL/' || v_dn.reference, 'delivery',
      NULLIF(r.current_location,'')::uuid, NULL,
      v_cust_loc.id, v_cust_loc.name, 'done',
      v_dn.reference, now(), v_uid::text,
      'delivery', _dn_id
    ) RETURNING id INTO v_move_id;

    INSERT INTO stock_move_lines (
      stock_move_id, product_id, product_name, product_sku,
      demand_qty, reserved_qty, done_qty, unit_of_measure, serial_numbers,
      source_location_id, destination_location_id
    ) VALUES (
      v_move_id, r.product_id, r.product_name, r.product_sku,
      array_length(r.serials,1), array_length(r.serials,1), array_length(r.serials,1),
      'Unit', r.serials,
      NULLIF(r.current_location,'')::uuid, v_cust_loc.id
    );
  END LOOP;

  -- 6. Update serials → sold and clear reservation link
  UPDATE goods_receipt_serials
     SET stock_status = 'sold',
         current_location = v_cust_loc.id::text,
         qc_status = 'passed',
         qc_checked_by = v_uid,
         qc_checked_at = now(),
         reserved_for_so_id = NULL
   WHERE id IN (SELECT grs_id FROM _dn_insp WHERE qc_status='pass');

  -- 7. Clear stock_reservations for these serials in this SO
  DELETE FROM stock_reservations
   WHERE sales_order_id = v_so_id
     AND (serial_number_id IN (
            SELECT sn.id FROM serial_numbers sn
             WHERE lower(sn.name) IN (SELECT lower(serial_number) FROM _dn_insp WHERE qc_status='pass')
          )
       OR status = 'reserved');

  -- 8. Update DN
  UPDATE delivery_notes
     SET status = 'delivered',
         delivered_at = now(),
         delivery_date = now(),
         signature_collected = COALESCE(_signature_received, false),
         customer_signature_received = COALESCE(_signature_received, false),
         customer_signature_date = CASE WHEN _signature_received THEN now()::date ELSE NULL END,
         qc_by = v_uid
   WHERE id = _dn_id;

  -- 9. Close SO if all sibling DNs delivered
  SELECT bool_and(status = 'delivered') INTO v_all_delivered
  FROM delivery_notes WHERE sales_order_id = v_so_id;
  IF COALESCE(v_all_delivered, false) THEN
    UPDATE sales_orders SET status = 'delivered' WHERE id = v_so_id;
    v_so_closed := true;
  END IF;

  RETURN jsonb_build_object(
    'status', 'completed',
    'delivered', v_delivered_count,
    'so_closed', v_so_closed,
    'dn_reference', v_dn.reference
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.complete_delivery_with_qc(uuid, boolean) TO authenticated, service_role;
