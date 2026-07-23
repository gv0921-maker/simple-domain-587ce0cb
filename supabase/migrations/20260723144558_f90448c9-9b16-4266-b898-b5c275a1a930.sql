
-- Fix stock_moves.operation_type mismatches in RPCs
CREATE OR REPLACE FUNCTION public.complete_ito_with_qc(_ito_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  SELECT * INTO v_ito FROM internal_transfer_orders WHERE id = _ito_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITO not found'; END IF;
  IF v_ito.status = 'completed' THEN RAISE EXCEPTION 'ITO already completed'; END IF;
  v_so_id := v_ito.sales_order_id;

  CREATE TEMP TABLE _grs ON COMMIT DROP AS
  SELECT s.* FROM goods_receipt_serials s WHERE s.reserved_for_so_id = v_so_id FOR UPDATE;

  CREATE TEMP TABLE _insp ON COMMIT DROP AS
  SELECT lower(i.serial_number) AS key, i.serial_number, i.qc_status, i.qc_notes, i.photo_urls,
         g.id AS grs_id, g.product_id, g.current_warehouse_id, g.current_location,
         g.stock_status, g.goods_receipt_id
  FROM qc_inspections i
  LEFT JOIN _grs g ON lower(g.serial_number) = lower(i.serial_number)
  WHERE i.document_type = 'ito' AND i.document_id = _ito_id
    AND i.qc_status IN ('pass','fail');

  FOR r IN SELECT * FROM _insp WHERE grs_id IS NULL LOOP
    RAISE EXCEPTION 'Serial % is not reserved for this order', r.serial_number;
  END LOOP;

  SELECT count(*) FILTER (WHERE qc_status='fail'),
         count(*) FILTER (WHERE qc_status='pass'),
         COALESCE(array_agg(serial_number) FILTER (WHERE qc_status='fail'), ARRAY[]::text[])
    INTO v_failed_count, v_passed_count, v_failed_serials
  FROM _insp;

  IF v_failed_count > 0 THEN
    SELECT id, name INTO v_correction_loc_id, v_correction_loc_name
    FROM warehouse_locations WHERE code = 'CRT111' LIMIT 1;
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
        'ITO-QC-FAIL/' || v_ito.ito_number, 'internal',
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

    UPDATE goods_receipt_serials
       SET stock_status = 'under_correction', qc_status = 'failed',
           current_location = v_correction_loc_id::text,
           qc_checked_by = v_uid, qc_checked_at = now()
     WHERE id IN (SELECT grs_id FROM _insp WHERE qc_status='fail');

    PERFORM public.log_activity(
      'ito', _ito_id, 'status_change',
      'QC failed for ' || v_failed_count || ' serial(s) — Correction Order ' || v_co_number || ' created'
    );

    RETURN jsonb_build_object(
      'status', 'blocked_by_failures',
      'failed', v_failed_count,
      'failed_serials', v_failed_serials,
      'correction_order_id', v_co_id,
      'ito_number', v_ito.ito_number
    );
  END IF;

  IF v_passed_count = 0 THEN RAISE EXCEPTION 'No passed units to move'; END IF;

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

  FOR r IN
    SELECT p.name AS product_name, COALESCE(p.sku,'') AS product_sku,
           array_agg(i.serial_number) AS serials, array_agg(i.grs_id) AS grs_ids,
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
      'ITO/' || v_ito.ito_number, 'internal',
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

  UPDATE goods_receipt_serials
     SET current_location = v_transit_loc.id::text,
         stock_status = 'reserved', qc_status = 'passed',
         qc_checked_by = v_uid, qc_checked_at = now()
   WHERE id IN (SELECT grs_id FROM _insp WHERE qc_status='pass');

  UPDATE internal_transfer_orders SET status = 'completed' WHERE id = _ito_id;
  UPDATE internal_transfer_order_lines SET line_status = 'completed'
   WHERE internal_transfer_order_id = _ito_id;

  PERFORM public.log_activity(
    'ito', _ito_id, 'status_change',
    'ITO completed — ' || v_passed_count || ' serial(s) moved to ' || v_transit_loc.name
  );

  RETURN jsonb_build_object(
    'status', 'completed',
    'moved', v_passed_count,
    'transit_location_id', v_transit_loc.id,
    'transit_location_name', v_transit_loc.name,
    'ito_number', v_ito.ito_number
  );
END $function$;

-- approve_write_off: 'write_off' is not a valid operation_type; use 'adjustment'
CREATE OR REPLACE FUNCTION public.approve_write_off(p_wf_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec public.write_off_records%ROWTYPE;
  v_item_count int;
  v_total numeric := 0;
  v_dest_code text;
  v_dest_id uuid;
  v_dest_name text;
  v_item record;
  v_ref text;
  v_move_id uuid;
  v_src_id uuid;
  v_src_name text;
  v_product_name text;
  v_product_sku text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admins can approve write-offs';
  END IF;

  SELECT * INTO v_rec FROM public.write_off_records WHERE id = p_wf_id FOR UPDATE;
  IF v_rec.id IS NULL THEN RAISE EXCEPTION 'Write-off % not found', p_wf_id; END IF;
  IF v_rec.status <> 'draft' THEN RAISE EXCEPTION 'Write-off is in status %', v_rec.status; END IF;
  IF length(trim(coalesce(v_rec.reason,''))) = 0 THEN RAISE EXCEPTION 'Reason is required'; END IF;
  IF jsonb_array_length(coalesce(v_rec.evidence_photos,'[]'::jsonb)) < 1 THEN
    RAISE EXCEPTION 'At least one evidence photo is required';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(unit_cost_value),0) INTO v_item_count, v_total
    FROM public.write_off_items WHERE write_off_record_id = p_wf_id;
  IF v_item_count = 0 THEN RAISE EXCEPTION 'At least one item is required'; END IF;

  v_dest_code := CASE v_rec.write_off_type
    WHEN 'damage' THEN 'SCRP113'
    WHEN 'scrap' THEN 'SCRP113'
    WHEN 'obsolete' THEN 'SCRP113'
    WHEN 'qc_unsalvageable' THEN 'SCRP113'
    ELSE 'LOSS112'
  END;
  SELECT id, name INTO v_dest_id, v_dest_name FROM public.warehouse_locations WHERE code = v_dest_code LIMIT 1;

  FOR v_item IN
    SELECT wi.goods_receipt_serial_id AS ser_id, s.product_id, s.serial_number,
           s.current_warehouse_id, s.current_location AS current_loc_txt
      FROM public.write_off_items wi
      JOIN public.goods_receipt_serials s ON s.id = wi.goods_receipt_serial_id
     WHERE wi.write_off_record_id = p_wf_id
     FOR UPDATE OF s
  LOOP
    v_src_id := NULL;
    v_src_name := 'Stock';
    IF v_item.current_warehouse_id IS NOT NULL THEN
      SELECT id, name INTO v_src_id, v_src_name
        FROM public.warehouse_locations
       WHERE warehouse_id = v_item.current_warehouse_id AND type = 'internal'
       ORDER BY is_default DESC NULLS LAST LIMIT 1;
    END IF;

    IF v_dest_id IS NOT NULL AND v_src_id IS NOT NULL THEN
      SELECT name, sku INTO v_product_name, v_product_sku FROM public.products WHERE id = v_item.product_id;
      v_ref := 'WF/' || v_rec.wf_number || '/' || substr(v_item.ser_id::text, 1, 6);
      INSERT INTO public.stock_moves (
        reference, operation_type, source_location_id, source_location_name,
        destination_location_id, destination_location_name, scheduled_date, state,
        source_document, reference_document_type, reference_document_id, created_by
      ) VALUES (
        v_ref, 'adjustment', v_src_id, v_src_name, v_dest_id, v_dest_name,
        now(), 'done', v_rec.wf_number, 'write_off', v_rec.id, auth.uid()
      ) RETURNING id INTO v_move_id;

      INSERT INTO public.stock_move_lines (
        stock_move_id, product_id, product_name, product_sku,
        demand_qty, reserved_qty, done_qty, unit_of_measure,
        source_location_id, destination_location_id, serial_numbers
      ) VALUES (
        v_move_id, v_item.product_id, v_product_name, v_product_sku,
        1, 1, 1, 'Unit', v_src_id, v_dest_id, ARRAY[v_item.serial_number]::text[]
      );
    END IF;
  END LOOP;

  UPDATE public.goods_receipt_serials
     SET stock_status = 'written_off',
         current_location = v_dest_name,
         reserved_for_so_id = NULL,
         updated_at = now()
   WHERE id IN (SELECT goods_receipt_serial_id FROM public.write_off_items WHERE write_off_record_id = p_wf_id);

  DELETE FROM public.stock_reservations
   WHERE serial_number_id IN (SELECT goods_receipt_serial_id FROM public.write_off_items WHERE write_off_record_id = p_wf_id);

  UPDATE public.write_off_records
     SET status = 'approved', approved_by = auth.uid(), approved_at = now(),
         total_value = v_total, updated_at = now()
   WHERE id = p_wf_id;

  RETURN jsonb_build_object('success', true, 'total_value', v_total, 'item_count', v_item_count);
END $function$;
