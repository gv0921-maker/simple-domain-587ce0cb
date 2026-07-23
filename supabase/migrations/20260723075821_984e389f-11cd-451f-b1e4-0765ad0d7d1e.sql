
-- 1. Allow NULL changed_by for system-authored entries
ALTER TABLE public.activity_log ALTER COLUMN changed_by DROP NOT NULL;

-- 2. Reader: label system entries as "System"
CREATE OR REPLACE FUNCTION public.get_activity_log_with_users(
  p_record_type text, p_record_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
) RETURNS TABLE(
  id uuid, record_type text, record_id uuid, action_type text,
  field_name text, old_value text, new_value text, note_text text,
  changed_by uuid, changed_by_name text, changed_by_email text,
  changed_at timestamptz, is_deleted boolean, deleted_by uuid,
  deleted_at timestamptz, attachments jsonb, total_count bigint
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT al.*
    FROM public.activity_log al
    WHERE al.record_type = p_record_type
      AND al.record_id = p_record_id
      AND al.is_deleted = false
  ),
  counted AS (SELECT count(*)::bigint AS c FROM base)
  SELECT
    al.id, al.record_type, al.record_id, al.action_type,
    al.field_name,
    CASE WHEN al.field_name = 'stage_id' THEN COALESCE(s_old.name, al.old_value) ELSE al.old_value END,
    CASE WHEN al.field_name = 'stage_id' THEN COALESCE(s_new.name, al.new_value) ELSE al.new_value END,
    al.note_text,
    al.changed_by,
    CASE
      WHEN al.changed_by IS NULL THEN 'System'
      ELSE COALESCE(NULLIF(TRIM(e.full_name), ''), SPLIT_PART(au.email, '@', 1), 'Unknown user')
    END,
    au.email,
    al.changed_at, al.is_deleted, al.deleted_by, al.deleted_at,
    COALESCE(al.attachments, '[]'::jsonb),
    (SELECT c FROM counted)
  FROM base al
  LEFT JOIN auth.users au ON au.id = al.changed_by
  LEFT JOIN public.employees e ON e.auth_user_id = al.changed_by
  LEFT JOIN public.crm_pipeline_stages s_old
    ON al.field_name = 'stage_id'
   AND al.old_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND s_old.id = al.old_value::uuid
  LEFT JOIN public.crm_pipeline_stages s_new
    ON al.field_name = 'stage_id'
   AND al.new_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND s_new.id = al.new_value::uuid
  ORDER BY al.changed_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

-- 3. Helper used by RPCs to log automatic entries in the same transaction.
CREATE OR REPLACE FUNCTION public.log_activity(
  _record_type text,
  _record_id uuid,
  _action_type text,
  _note_text text,
  _field_name text DEFAULT NULL,
  _old_value text DEFAULT NULL,
  _new_value text DEFAULT NULL
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.activity_log(
    record_type, record_id, action_type, note_text, field_name,
    old_value, new_value, changed_by, attachments
  ) VALUES (
    _record_type, _record_id, _action_type, _note_text, _field_name,
    _old_value, _new_value, auth.uid(), '[]'::jsonb
  );
$$;

GRANT EXECUTE ON FUNCTION public.log_activity(text, uuid, text, text, text, text, text) TO authenticated, service_role;

-- 4. record_gr_item_qc — log per-item QC into the goods_receipt feed
CREATE OR REPLACE FUNCTION public.record_gr_item_qc(
  _serial_id uuid, _passed boolean, _notes text DEFAULT NULL, _images jsonb DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ser public.goods_receipt_serials%ROWTYPE;
  v_gr public.goods_receipts%ROWTYPE;
  v_wh_id uuid;
  v_loc_id uuid;
  v_vendor_loc_id uuid;
  v_product_name text;
  v_product_sku text;
  v_move_id uuid;
  v_ref text;
BEGIN
  SELECT * INTO v_ser FROM public.goods_receipt_serials WHERE id = _serial_id FOR UPDATE;
  IF v_ser.id IS NULL THEN RAISE EXCEPTION 'Serial % not found', _serial_id; END IF;

  SELECT * INTO v_gr FROM public.goods_receipts WHERE id = v_ser.goods_receipt_id;
  v_wh_id := COALESCE(v_ser.current_warehouse_id, v_gr.warehouse_id);

  IF v_wh_id IS NOT NULL THEN
    SELECT default_receipt_location_id INTO v_loc_id FROM public.warehouses WHERE id = v_wh_id;
    IF v_loc_id IS NULL THEN
      SELECT id INTO v_loc_id
        FROM public.warehouse_locations
       WHERE warehouse_id = v_wh_id AND type = 'internal' AND COALESCE(is_active,true)
       ORDER BY created_at ASC LIMIT 1;
    END IF;
  END IF;

  SELECT id INTO v_vendor_loc_id FROM public.warehouse_locations WHERE code = 'VDR106' LIMIT 1;

  UPDATE public.goods_receipt_serials
     SET qc_status = CASE WHEN _passed THEN 'passed' ELSE 'failed' END,
         qc_notes = _notes,
         qc_images = _images,
         qc_checked_by = v_uid,
         qc_checked_at = now(),
         stock_status = CASE WHEN _passed THEN 'available' ELSE 'under_correction' END,
         current_warehouse_id = CASE WHEN _passed THEN COALESCE(v_wh_id, current_warehouse_id) ELSE current_warehouse_id END,
         updated_at = now()
   WHERE id = _serial_id;

  IF _passed AND v_vendor_loc_id IS NOT NULL AND v_loc_id IS NOT NULL THEN
    SELECT name, sku INTO v_product_name, v_product_sku FROM public.products WHERE id = v_ser.product_id;
    v_ref := 'GRQC/' || substr(_serial_id::text, 1, 8);
    INSERT INTO public.stock_moves (
      reference, operation_type, source_location_id, source_location_name,
      destination_location_id, destination_location_name, scheduled_date, state,
      source_document, reference_document_type, reference_document_id, created_by
    ) VALUES (
      v_ref, 'receipt', v_vendor_loc_id, 'VENDORS',
      v_loc_id, (SELECT name FROM public.warehouse_locations WHERE id = v_loc_id),
      now(), 'done', v_gr.gr_number, 'goods_receipt', v_gr.id, v_uid
    ) RETURNING id INTO v_move_id;

    INSERT INTO public.stock_move_lines (
      stock_move_id, product_id, product_name, product_sku,
      demand_qty, reserved_qty, done_qty, unit_of_measure,
      source_location_id, destination_location_id, serial_numbers
    ) VALUES (
      v_move_id, v_ser.product_id, v_product_name, v_product_sku,
      1, 1, 1, 'Unit',
      v_vendor_loc_id, v_loc_id, ARRAY[v_ser.serial_number]::text[]
    );
  END IF;

  -- Automatic feed entry
  PERFORM public.log_activity(
    'goods_receipt', v_gr.id, 'status_change',
    CASE
      WHEN _passed THEN 'QC passed for serial ' || v_ser.serial_number
      ELSE 'QC failed for serial ' || v_ser.serial_number
        || COALESCE(' — ' || NULLIF(TRIM(_notes),''), '')
    END
  );
END $$;

-- 5. complete_gr_line_qc — log per-line batch and completion
CREATE OR REPLACE FUNCTION public.complete_gr_line_qc(
  p_gr_line_id uuid, p_passed_serial_ids uuid[], p_failed_serial_ids uuid[], p_failed_notes text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_gr_id uuid;
  v_wh_id uuid;
  v_loc_id uuid;
  v_pass_cnt int := 0;
  v_fail_cnt int := 0;
  v_pending_lines int;
BEGIN
  SELECT gr.goods_receipt_id, grh.warehouse_id
    INTO v_gr_id, v_wh_id
    FROM public.goods_receipt_lines gr
    JOIN public.goods_receipts grh ON grh.id = gr.goods_receipt_id
   WHERE gr.id = p_gr_line_id;
  IF v_gr_id IS NULL THEN RAISE EXCEPTION 'GR line % not found', p_gr_line_id; END IF;

  IF v_wh_id IS NOT NULL THEN
    SELECT default_receipt_location_id INTO v_loc_id
      FROM public.warehouses WHERE id = v_wh_id;
    IF v_loc_id IS NULL THEN
      SELECT id INTO v_loc_id
        FROM public.warehouse_locations
       WHERE warehouse_id = v_wh_id
         AND type = 'internal'
         AND COALESCE(is_active, true) = true
       ORDER BY created_at ASC
       LIMIT 1;
    END IF;
  END IF;

  IF p_passed_serial_ids IS NOT NULL AND array_length(p_passed_serial_ids, 1) > 0 THEN
    UPDATE public.goods_receipt_serials
       SET qc_status = 'passed',
           stock_status = 'available',
           current_warehouse_id = COALESCE(v_wh_id, current_warehouse_id),
           current_location = COALESCE(v_loc_id::text, current_location),
           qc_checked_by = v_uid,
           qc_checked_at = now(),
           updated_at = now()
     WHERE id = ANY(p_passed_serial_ids) AND goods_receipt_line_id = p_gr_line_id;
    GET DIAGNOSTICS v_pass_cnt = ROW_COUNT;
  END IF;

  IF p_failed_serial_ids IS NOT NULL AND array_length(p_failed_serial_ids, 1) > 0 THEN
    UPDATE public.goods_receipt_serials
       SET qc_status = 'failed',
           stock_status = 'rejected',
           qc_notes = COALESCE(p_failed_notes, qc_notes),
           qc_checked_by = v_uid,
           qc_checked_at = now(),
           updated_at = now()
     WHERE id = ANY(p_failed_serial_ids) AND goods_receipt_line_id = p_gr_line_id;
    GET DIAGNOSTICS v_fail_cnt = ROW_COUNT;
  END IF;

  UPDATE public.goods_receipt_lines
     SET accepted_quantity = COALESCE(accepted_quantity,0) + v_pass_cnt,
         under_correction_quantity = COALESCE(under_correction_quantity,0) + v_fail_cnt,
         updated_at = now()
   WHERE id = p_gr_line_id;

  IF v_pass_cnt > 0 OR v_fail_cnt > 0 THEN
    PERFORM public.log_activity(
      'goods_receipt', v_gr_id, 'status_change',
      'QC batch — ' || v_pass_cnt || ' passed, ' || v_fail_cnt || ' failed'
    );
  END IF;

  SELECT COUNT(*) INTO v_pending_lines
    FROM public.goods_receipt_serials
   WHERE goods_receipt_id = v_gr_id AND qc_status = 'pending';

  IF v_pending_lines = 0 THEN
    UPDATE public.goods_receipts
       SET status = 'completed',
           received_at = COALESCE(received_at, now()),
           received_by = COALESCE(received_by, v_uid),
           updated_at = now()
     WHERE id = v_gr_id;

    PERFORM public.log_activity(
      'goods_receipt', v_gr_id, 'status_change',
      'Goods Receipt completed'
    );
  END IF;
END $$;

-- 6. complete_ito_with_qc — automatic entries on ITO feed
CREATE OR REPLACE FUNCTION public.complete_ito_with_qc(_ito_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;

-- 7. complete_delivery_with_qc — automatic entry on Delivery Note feed
CREATE OR REPLACE FUNCTION public.complete_delivery_with_qc(
  _dn_id uuid, _signature_received boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  SELECT * INTO v_dn FROM delivery_notes WHERE id = _dn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery note not found'; END IF;
  IF v_dn.status = 'delivered' THEN RAISE EXCEPTION 'Delivery note already delivered'; END IF;
  v_so_id := v_dn.sales_order_id;
  IF v_so_id IS NULL THEN RAISE EXCEPTION 'Delivery note has no linked sales order'; END IF;

  SELECT COALESCE(paid_amount,0), COALESCE(grand_total, total, 0)
    INTO v_paid, v_total
  FROM sales_orders WHERE id = v_so_id FOR UPDATE;
  IF v_total <= 0 OR v_paid + 0.005 < v_total THEN
    RAISE EXCEPTION 'Delivery available after full payment. Current: ₹% paid of ₹%', v_paid, v_total;
  END IF;

  SELECT id, name INTO v_cust_loc
  FROM warehouse_locations
  WHERE code = 'CTMR107' OR (type = 'customer' AND is_active = true)
  ORDER BY (code = 'CTMR107') DESC LIMIT 1;
  IF v_cust_loc.id IS NULL THEN RAISE EXCEPTION 'CUSTOMERS location not configured'; END IF;

  CREATE TEMP TABLE _dn_insp ON COMMIT DROP AS
  SELECT i.serial_number, i.qc_status, i.qc_notes, i.photo_urls,
         g.id AS grs_id, g.product_id, g.current_location,
         g.current_warehouse_id, g.stock_status
  FROM qc_inspections i
  LEFT JOIN goods_receipt_serials g
    ON lower(g.serial_number) = lower(i.serial_number)
   AND g.reserved_for_so_id = v_so_id
  WHERE i.document_type = 'delivery_note'
    AND i.document_id = _dn_id
    AND i.qc_status IN ('pass','fail');

  PERFORM 1 FROM goods_receipt_serials
   WHERE id IN (SELECT grs_id FROM _dn_insp WHERE grs_id IS NOT NULL)
   FOR UPDATE;

  FOR r IN SELECT * FROM _dn_insp WHERE grs_id IS NULL LOOP
    RAISE EXCEPTION 'Serial % is not reserved for this order', r.serial_number;
  END LOOP;

  SELECT count(*) FILTER (WHERE qc_status='fail'),
         count(*) FILTER (WHERE qc_status='pass'),
         COALESCE(array_agg(serial_number) FILTER (WHERE qc_status='fail'), ARRAY[]::text[])
  INTO v_failed_count, v_delivered_count, v_failed_serials
  FROM _dn_insp;

  IF v_failed_count > 0 THEN
    RAISE EXCEPTION 'Cannot deliver: % unit(s) failed QC at handoff (%). Resolve before completing.',
      v_failed_count, array_to_string(v_failed_serials, ', ');
  END IF;
  IF v_delivered_count = 0 THEN RAISE EXCEPTION 'No passed units to deliver'; END IF;

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

  UPDATE goods_receipt_serials
     SET stock_status = 'sold',
         current_location = v_cust_loc.id::text,
         qc_status = 'passed',
         qc_checked_by = v_uid,
         qc_checked_at = now(),
         reserved_for_so_id = NULL
   WHERE id IN (SELECT grs_id FROM _dn_insp WHERE qc_status='pass');

  DELETE FROM stock_reservations
   WHERE sales_order_id = v_so_id
     AND (serial_number_id IN (
            SELECT sn.id FROM serial_numbers sn
             WHERE lower(sn.name) IN (SELECT lower(serial_number) FROM _dn_insp WHERE qc_status='pass')
          )
       OR status = 'reserved');

  UPDATE delivery_notes
     SET status = 'delivered',
         delivered_at = now(),
         delivery_date = now(),
         signature_collected = COALESCE(_signature_received, false),
         customer_signature_received = COALESCE(_signature_received, false),
         customer_signature_date = CASE WHEN _signature_received THEN now()::date ELSE NULL END,
         qc_by = v_uid
   WHERE id = _dn_id;

  SELECT bool_and(status = 'delivered') INTO v_all_delivered
  FROM delivery_notes WHERE sales_order_id = v_so_id;
  IF COALESCE(v_all_delivered, false) THEN
    UPDATE sales_orders SET status = 'delivered' WHERE id = v_so_id;
    v_so_closed := true;
    PERFORM public.log_activity(
      'sales_order', v_so_id, 'status_change',
      'All deliveries completed — Sales Order closed'
    );
  END IF;

  PERFORM public.log_activity(
    'delivery_note', _dn_id, 'status_change',
    'Delivery completed — ' || v_delivered_count || ' serial(s) → CUSTOMERS'
      || CASE WHEN _signature_received THEN ' (signature received)' ELSE '' END
  );

  RETURN jsonb_build_object(
    'status', 'completed',
    'delivered', v_delivered_count,
    'so_closed', v_so_closed,
    'dn_reference', v_dn.reference
  );
END $$;

-- 8. reserve_serials — log on the sales order feed
CREATE OR REPLACE FUNCTION public.reserve_serials(
  _so_id uuid, _order_line_id uuid, _product_id uuid, _serial_ids uuid[], _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ser record;
  v_created int := 0;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_new_id uuid;
BEGIN
  IF _so_id IS NULL THEN RAISE EXCEPTION 'sales_order_id is required'; END IF;
  IF _serial_ids IS NULL OR array_length(_serial_ids,1) IS NULL THEN
    RETURN jsonb_build_object('created', 0, 'reservation_ids', '[]'::jsonb);
  END IF;

  FOR v_ser IN
    SELECT id, product_id, stock_status, reserved_for_so_id, serial_number
      FROM public.goods_receipt_serials
     WHERE id = ANY(_serial_ids) ORDER BY serial_number FOR UPDATE
  LOOP
    IF v_ser.product_id <> _product_id THEN
      RAISE EXCEPTION 'Serial % belongs to a different product', v_ser.serial_number;
    END IF;
    IF v_ser.stock_status <> 'available' THEN
      RAISE EXCEPTION 'Serial % is not available (status: %)', v_ser.serial_number, v_ser.stock_status;
    END IF;
    IF v_ser.reserved_for_so_id IS NOT NULL AND v_ser.reserved_for_so_id <> _so_id THEN
      RAISE EXCEPTION 'Serial % is already reserved for another sales order', v_ser.serial_number;
    END IF;

    INSERT INTO public.stock_reservations (
      sales_order_id, order_line_id, product_id, serial_number_id,
      quantity, status, reserved_by, notes
    ) VALUES (
      _so_id, _order_line_id, _product_id, v_ser.id, 1, 'reserved', v_uid, _notes
    ) RETURNING id INTO v_new_id;

    UPDATE public.goods_receipt_serials
       SET reserved_for_so_id = _so_id, stock_status = 'reserved', updated_at = now()
     WHERE id = v_ser.id;

    v_created := v_created + 1;
    v_ids := v_ids || v_new_id;
  END LOOP;

  IF v_created > 0 THEN
    PERFORM public.log_activity(
      'sales_order', _so_id, 'status_change',
      v_created || ' serial(s) reserved'
    );
  END IF;

  RETURN jsonb_build_object('created', v_created, 'reservation_ids', to_jsonb(v_ids));
END $$;

-- 9. release_reservations — log on the sales order feed
CREATE OR REPLACE FUNCTION public.release_reservations(_document_type text, _document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_res record;
  v_count int := 0;
  v_so_id uuid;
BEGIN
  IF _document_type = 'sales_order' THEN
    v_so_id := _document_id;
    FOR v_res IN
      SELECT id, serial_number_id FROM public.stock_reservations
       WHERE sales_order_id = _document_id AND status = 'reserved' FOR UPDATE
    LOOP
      IF v_res.serial_number_id IS NOT NULL THEN
        UPDATE public.goods_receipt_serials
           SET reserved_for_so_id = NULL,
               stock_status = CASE WHEN stock_status = 'reserved' THEN 'available' ELSE stock_status END,
               updated_at = now()
         WHERE id = v_res.serial_number_id
           AND reserved_for_so_id = _document_id;
      END IF;
      DELETE FROM public.stock_reservations WHERE id = v_res.id;
      v_count := v_count + 1;
    END LOOP;
  ELSIF _document_type = 'reservation' THEN
    SELECT id, serial_number_id, sales_order_id INTO v_res
      FROM public.stock_reservations WHERE id = _document_id FOR UPDATE;
    IF v_res.id IS NOT NULL THEN
      v_so_id := v_res.sales_order_id;
      IF v_res.serial_number_id IS NOT NULL THEN
        UPDATE public.goods_receipt_serials
           SET reserved_for_so_id = NULL,
               stock_status = CASE WHEN stock_status = 'reserved' THEN 'available' ELSE stock_status END,
               updated_at = now()
         WHERE id = v_res.serial_number_id;
      END IF;
      DELETE FROM public.stock_reservations WHERE id = v_res.id;
      v_count := 1;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown document_type: %', _document_type;
  END IF;

  IF v_count > 0 AND v_so_id IS NOT NULL THEN
    PERFORM public.log_activity(
      'sales_order', v_so_id, 'status_change',
      'Reservation released — ' || v_count || ' serial(s) returned to available'
    );
  END IF;

  RETURN jsonb_build_object('released', v_count);
END $$;
