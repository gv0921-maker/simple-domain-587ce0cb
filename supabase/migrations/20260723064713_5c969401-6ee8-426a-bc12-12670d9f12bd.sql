
-- Atomic ITO completion RPC. Reads existing qc_inspections for the ITO,
-- locks the affected serials, and applies stock moves + status updates in
-- a single transaction. Preserves current user-visible behavior:
--   * If any inspection failed: create a Correction Order for the failed
--     units, move failed serials to the CORRECTION virtual location, keep
--     ITO not-completed, and return status='blocked_by_failures' so the
--     frontend throws the same error message as before.
--   * If all passed: move serials to the warehouse transit location and
--     mark the ITO completed.
CREATE OR REPLACE FUNCTION public.complete_ito_with_qc(_ito_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ito record;
  v_so_id uuid;
  v_warehouse_id uuid;
  v_transit_loc record;
  v_correction_loc_id uuid;
  v_correction_loc_name text;
  v_co_id uuid;
  v_co_number text;
  v_failed_count int := 0;
  v_passed_count int := 0;
  v_failed_serials text[] := ARRAY[]::text[];
  r record;
  v_move_id uuid;
BEGIN
  -- 1. Lock ITO
  SELECT * INTO v_ito
  FROM internal_transfer_orders
  WHERE id = _ito_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITO not found';
  END IF;
  IF v_ito.status = 'completed' THEN
    RAISE EXCEPTION 'ITO already completed';
  END IF;
  v_so_id := v_ito.sales_order_id;

  -- 2. Lock all reserved serials for this SO. This is the pool the ITO
  --    draws from and matches what qcEngine records inspections against.
  CREATE TEMP TABLE _grs ON COMMIT DROP AS
  SELECT s.*
  FROM goods_receipt_serials s
  WHERE s.reserved_for_so_id = v_so_id
  FOR UPDATE;

  -- 3. Join inspections with locked serials
  CREATE TEMP TABLE _insp ON COMMIT DROP AS
  SELECT
    lower(i.serial_number) AS key,
    i.serial_number,
    i.qc_status,
    i.qc_notes,
    i.photo_urls,
    g.id             AS grs_id,
    g.product_id,
    g.current_warehouse_id,
    g.current_location,
    g.stock_status,
    g.goods_receipt_id
  FROM qc_inspections i
  LEFT JOIN _grs g ON lower(g.serial_number) = lower(i.serial_number)
  WHERE i.document_type = 'ito' AND i.document_id = _ito_id
    AND i.qc_status IN ('pass','fail');

  -- Verify every scanned serial actually belongs to the reserved pool
  FOR r IN SELECT * FROM _insp WHERE grs_id IS NULL LOOP
    RAISE EXCEPTION 'Serial % is not reserved for this order', r.serial_number;
  END LOOP;

  SELECT count(*) FILTER (WHERE qc_status='fail'),
         count(*) FILTER (WHERE qc_status='pass'),
         COALESCE(array_agg(serial_number) FILTER (WHERE qc_status='fail'), ARRAY[]::text[])
    INTO v_failed_count, v_passed_count, v_failed_serials
  FROM _insp;

  -- 4. Failure path — create correction order + move failed serials to CORRECTION.
  --    Do NOT complete the ITO; return blocked status so the frontend
  --    surfaces the same error string as before.
  IF v_failed_count > 0 THEN
    SELECT id, name INTO v_correction_loc_id, v_correction_loc_name
    FROM warehouse_locations
    WHERE code = 'CRT111'
    LIMIT 1;
    IF v_correction_loc_id IS NULL THEN
      RAISE EXCEPTION 'CORRECTION virtual location not configured';
    END IF;

    v_co_number := 'CO-ITO-' || upper(to_hex((extract(epoch from now())*1000)::bigint));
    INSERT INTO correction_orders (
      co_number, source_type, source_document_id, source_document_reference,
      addressed_to_type, addressed_to_name, correction_type, status, created_by, notes
    ) VALUES (
      v_co_number, 'goods_receipt', _ito_id, v_ito.ito_number,
      'vendor', 'Vendor (to be assigned)', 'replace', 'draft', v_uid,
      'Auto-created from failed QC on ITO ' || v_ito.ito_number
    ) RETURNING id INTO v_co_id;

    INSERT INTO correction_order_items (
      correction_order_id, goods_receipt_serial_id, product_id, serial_number,
      original_qc_notes, original_qc_images, latest_qc_status, latest_qc_cycle,
      current_status, notes
    )
    SELECT v_co_id, grs_id, product_id, serial_number,
           qc_notes, COALESCE(to_jsonb(photo_urls), '[]'::jsonb), 'failed', 1,
           'awaiting_correction',
           'Failed QC during ITO ' || v_ito.ito_number
    FROM _insp WHERE qc_status='fail';

    -- Stock moves: failed serials → CORRECTION
    FOR r IN
      SELECT p.name AS product_name, COALESCE(p.sku,'') AS product_sku,
             array_agg(i.serial_number) AS serials,
             array_agg(i.grs_id) AS grs_ids,
             i.current_location, i.current_warehouse_id, i.product_id
      FROM _insp i JOIN products p ON p.id = i.product_id
      WHERE i.qc_status='fail'
      GROUP BY p.name, p.sku, i.current_location, i.current_warehouse_id, i.product_id
    LOOP
      INSERT INTO stock_moves (
        reference, operation_type, source_location_id, source_location_name,
        destination_location_id, destination_location_name, state,
        source_document, effective_date, created_by,
        reference_document_type, reference_document_id
      ) VALUES (
        'ITO-QC-FAIL/' || v_ito.ito_number, 'internal_transfer',
        NULLIF(r.current_location,'')::uuid, NULL,
        v_correction_loc_id, v_correction_loc_name, 'done',
        v_ito.ito_number, now(), v_uid::text,
        'ito', _ito_id
      ) RETURNING id INTO v_move_id;
      INSERT INTO stock_move_lines (
        stock_move_id, product_id, product_name, product_sku,
        demand_qty, reserved_qty, done_qty, unit_of_measure, serial_numbers,
        source_location_id, destination_location_id
      ) VALUES (
        v_move_id, r.product_id, r.product_name, r.product_sku,
        array_length(r.serials,1), array_length(r.serials,1), array_length(r.serials,1),
        'Unit', r.serials,
        NULLIF(r.current_location,'')::uuid, v_correction_loc_id
      );
    END LOOP;

    -- Update failed serials
    UPDATE goods_receipt_serials
       SET stock_status = 'under_correction',
           qc_status = 'failed',
           current_location = v_correction_loc_id::text,
           qc_checked_by = v_uid,
           qc_checked_at = now()
     WHERE id IN (SELECT grs_id FROM _insp WHERE qc_status='fail');

    RETURN jsonb_build_object(
      'status', 'blocked_by_failures',
      'failed', v_failed_count,
      'failed_serials', v_failed_serials,
      'correction_order_id', v_co_id,
      'ito_number', v_ito.ito_number
    );
  END IF;

  -- 5. Success path — need at least one passed unit
  IF v_passed_count = 0 THEN
    RAISE EXCEPTION 'No passed units to move';
  END IF;

  SELECT (SELECT current_warehouse_id FROM _insp WHERE qc_status='pass' AND current_warehouse_id IS NOT NULL LIMIT 1)
    INTO v_warehouse_id;
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Reserved serials are missing a warehouse — cannot resolve transit location.';
  END IF;

  SELECT id, name INTO v_transit_loc
  FROM warehouse_locations
  WHERE warehouse_id = v_warehouse_id AND type = 'transit' AND is_active = true
  LIMIT 1;
  IF v_transit_loc.id IS NULL THEN
    RAISE EXCEPTION 'No transit location configured for warehouse %', v_warehouse_id;
  END IF;

  -- Stock moves: passed serials → transit
  FOR r IN
    SELECT p.name AS product_name, COALESCE(p.sku,'') AS product_sku,
           array_agg(i.serial_number) AS serials,
           array_agg(i.grs_id) AS grs_ids,
           i.current_location, i.product_id
    FROM _insp i JOIN products p ON p.id = i.product_id
    WHERE i.qc_status='pass'
    GROUP BY p.name, p.sku, i.current_location, i.product_id
  LOOP
    INSERT INTO stock_moves (
      reference, operation_type, source_location_id, source_location_name,
      destination_location_id, destination_location_name, state,
      source_document, effective_date, created_by,
      reference_document_type, reference_document_id
    ) VALUES (
      'ITO/' || v_ito.ito_number, 'internal_transfer',
      NULLIF(r.current_location,'')::uuid, NULL,
      v_transit_loc.id, v_transit_loc.name, 'done',
      v_ito.ito_number, now(), v_uid::text,
      'ito', _ito_id
    ) RETURNING id INTO v_move_id;
    INSERT INTO stock_move_lines (
      stock_move_id, product_id, product_name, product_sku,
      demand_qty, reserved_qty, done_qty, unit_of_measure, serial_numbers,
      source_location_id, destination_location_id
    ) VALUES (
      v_move_id, r.product_id, r.product_name, r.product_sku,
      array_length(r.serials,1), array_length(r.serials,1), array_length(r.serials,1),
      'Unit', r.serials,
      NULLIF(r.current_location,'')::uuid, v_transit_loc.id
    );
  END LOOP;

  -- Update passed serials
  UPDATE goods_receipt_serials
     SET current_location = v_transit_loc.id::text,
         stock_status = 'reserved',
         qc_status = 'passed',
         qc_checked_by = v_uid,
         qc_checked_at = now()
   WHERE id IN (SELECT grs_id FROM _insp WHERE qc_status='pass');

  -- Complete ITO + lines
  UPDATE internal_transfer_orders
     SET status = 'completed'
   WHERE id = _ito_id;

  UPDATE internal_transfer_order_lines
     SET line_status = 'completed'
   WHERE internal_transfer_order_id = _ito_id;

  RETURN jsonb_build_object(
    'status', 'completed',
    'moved', v_passed_count,
    'transit_location_id', v_transit_loc.id,
    'transit_location_name', v_transit_loc.name,
    'ito_number', v_ito.ito_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_ito_with_qc(uuid) TO authenticated, service_role;
