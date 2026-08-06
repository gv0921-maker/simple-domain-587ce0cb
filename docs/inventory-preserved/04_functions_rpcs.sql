-- GLF inventory module - functions / RPCs referencing inventory tables
-- Captured from the live database before the inventory reset.
-- Tag: pre-inventory-reset (a0bdb09). Verbatim catalog output.

CREATE OR REPLACE FUNCTION public.adjust_factory_stock(_item_id uuid, _movement_type text, _quantity numeric, _notes text DEFAULT NULL::text, _related_work_order_id uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_new numeric;
BEGIN
  IF _movement_type NOT IN ('inbound','consumed','adjustment','damaged') THEN
    RAISE EXCEPTION 'Invalid movement_type: %', _movement_type;
  END IF;

  -- Atomic update using current row value with row lock; no lost updates.
  UPDATE public.factory_inventory_items
     SET current_stock = current_stock + _quantity,
         updated_at = now()
   WHERE id = _item_id
   RETURNING current_stock INTO v_new;

  IF v_new IS NULL THEN RAISE EXCEPTION 'Factory item % not found', _item_id; END IF;

  INSERT INTO public.factory_stock_movements (
    factory_inventory_item_id, movement_type, quantity,
    related_work_order_id, notes, recorded_by
  ) VALUES (
    _item_id, _movement_type, _quantity,
    _related_work_order_id, _notes, v_uid
  );

  RETURN v_new;
END $function$
;

CREATE OR REPLACE FUNCTION public.allocate_serial_numbers(p_prefix text, p_count integer)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start INT;
  v_end INT;
  v_out TEXT[] := ARRAY[]::TEXT[];
  i INT;
BEGIN
  IF p_prefix IS NULL OR length(p_prefix) = 0 THEN
    RAISE EXCEPTION 'prefix required';
  END IF;
  IF p_count IS NULL OR p_count < 1 THEN
    RAISE EXCEPTION 'count must be >= 1';
  END IF;

  INSERT INTO public.serial_counters (prefix, last_number)
  VALUES (p_prefix, p_count)
  ON CONFLICT (prefix) DO UPDATE
    SET last_number = public.serial_counters.last_number + p_count,
        updated_at = now()
  RETURNING last_number INTO v_end;

  v_start := v_end - p_count + 1;
  FOR i IN v_start..v_end LOOP
    v_out := array_append(v_out, p_prefix || lpad(i::text, 4, '0'));
  END LOOP;
  RETURN v_out;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_stock_action(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.return_request_items%ROWTYPE;
  v_rt public.return_requests%ROWTYPE;
  v_action text;
  v_co_id uuid;
  v_wf_id uuid;
BEGIN
  SELECT * INTO v_item FROM public.return_request_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'Return item % not found', p_item_id; END IF;
  IF v_item.condition_grade IS NULL THEN RAISE EXCEPTION 'QC not complete'; END IF;

  SELECT * INTO v_rt FROM public.return_requests WHERE id = v_item.return_request_id;

  IF v_item.condition_grade = 'like_new' THEN
    UPDATE public.goods_receipt_serials
       SET stock_status = 'available', updated_at = now()
     WHERE id = v_item.goods_receipt_serial_id;
    v_action := 'returned_to_available';

  ELSIF v_item.condition_grade = 'minor_damage' THEN
    UPDATE public.goods_receipt_serials
       SET stock_status = 'under_correction', updated_at = now()
     WHERE id = v_item.goods_receipt_serial_id;

    SELECT id INTO v_co_id
      FROM public.correction_orders
     WHERE source_type = 'return' AND source_document_id = v_rt.id AND status = 'draft'
     LIMIT 1;
    IF v_co_id IS NULL THEN
      INSERT INTO public.correction_orders (
        co_number, source_type, source_document_id, source_document_reference,
        addressed_to_type, addressed_to_name, correction_type, status, created_by
      ) VALUES (
        public.generate_document_number('correction_order'),
        'return', v_rt.id, v_rt.rt_number,
        'factory', NULL, 'repair', 'draft', auth.uid()
      ) RETURNING id INTO v_co_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.correction_order_items
                   WHERE goods_receipt_serial_id = v_item.goods_receipt_serial_id
                     AND correction_order_id = v_co_id) THEN
      INSERT INTO public.correction_order_items (
        correction_order_id, goods_receipt_serial_id, product_id, serial_number,
        original_qc_notes, original_qc_images, latest_qc_status, latest_qc_cycle, current_status
      ) VALUES (
        v_co_id, v_item.goods_receipt_serial_id, v_item.product_id, v_item.serial_number,
        v_item.qc_notes, COALESCE(v_item.qc_images, '[]'::jsonb), 'failed', 1, 'awaiting_correction'
      );
    END IF;
    v_action := 'sent_to_correction:' || v_co_id::text;

  ELSIF v_item.condition_grade = 'unsalvageable' THEN
    SELECT id INTO v_wf_id
      FROM public.write_off_records
     WHERE source_type = 'return' AND source_document_id = v_rt.id AND status = 'draft'
     LIMIT 1;
    IF v_wf_id IS NULL THEN
      INSERT INTO public.write_off_records (
        wf_number, write_off_type, source_type, source_document_id, source_document_reference,
        status, reason, evidence_photos, created_by
      ) VALUES (
        public.generate_document_number('write_off'),
        'qc_unsalvageable', 'return', v_rt.id, v_rt.rt_number,
        'draft', 'Return QC unsalvageable',
        COALESCE(v_item.qc_images, '[]'::jsonb),
        auth.uid()
      ) RETURNING id INTO v_wf_id;
    ELSE
      UPDATE public.write_off_records
         SET evidence_photos = evidence_photos || COALESCE(v_item.qc_images, '[]'::jsonb),
             updated_at = now()
       WHERE id = v_wf_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.write_off_items
                   WHERE goods_receipt_serial_id = v_item.goods_receipt_serial_id
                     AND write_off_record_id = v_wf_id) THEN
      INSERT INTO public.write_off_items (
        write_off_record_id, goods_receipt_serial_id, product_id, serial_number,
        unit_cost_value, item_specific_notes
      ) VALUES (
        v_wf_id, v_item.goods_receipt_serial_id, v_item.product_id, v_item.serial_number,
        v_item.original_unit_price, v_item.qc_notes
      );
    END IF;
    v_action := 'drafted_write_off:' || v_wf_id::text;
  END IF;

  UPDATE public.return_request_items
     SET resolution_status = 'completed', updated_at = now()
   WHERE id = p_item_id;

  RETURN jsonb_build_object('action', v_action, 'item_id', p_item_id);
END $function$
;

CREATE OR REPLACE FUNCTION public.approve_count_skip(p_year integer, p_month integer, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admins can approve count skips';
  END IF;
  INSERT INTO public.stock_counts (
    count_period_year, count_period_month, status, skip_reason, skip_approved_by, skip_approved_at, started_by
  ) VALUES (
    p_year, p_month, 'skipped', p_reason, auth.uid(), now(), auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.approve_return_request(p_rt_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_rt public.return_requests%ROWTYPE;
  v_item_count int;
BEGIN
  IF NOT public.has_role(v_uid, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super_admin can approve returns';
  END IF;

  SELECT * INTO v_rt FROM public.return_requests WHERE id = p_rt_id FOR UPDATE;
  IF v_rt.id IS NULL THEN
    RAISE EXCEPTION 'Return request not found';
  END IF;
  IF v_rt.request_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Return request is in % and cannot be approved', v_rt.request_status;
  END IF;

  UPDATE public.return_requests
     SET request_status = 'awaiting_receipt',
         approved_by = v_uid,
         approved_at = now()
   WHERE id = p_rt_id;

  SELECT COUNT(*) INTO v_item_count FROM public.return_request_items WHERE return_request_id = p_rt_id;

  -- Add to scan queue (return_receipt)
  INSERT INTO public.scan_queue (document_type, document_id, document_reference, expected_items_count)
  VALUES ('return_receipt', p_rt_id, v_rt.rt_number, v_item_count)
  ON CONFLICT DO NOTHING;
END $function$
;

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
  IF v_dest_id IS NULL THEN
    RAISE EXCEPTION 'No write-off destination location found for code "%". Create it in Setup -> Locations.', v_dest_code;
  END IF;

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
         current_location = v_dest_id::text,
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
END $function$
;

CREATE OR REPLACE FUNCTION public.auto_create_correction_order(p_gr_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gr_ref text;
  v_failed RECORD;
  v_co_id uuid;
  v_last_co_id uuid := NULL;
BEGIN
  SELECT gr_number INTO v_gr_ref FROM public.goods_receipts WHERE id = p_gr_id;
  IF v_gr_ref IS NULL THEN RETURN NULL; END IF;

  -- Each failed unit not yet attached to any CO item gets its own CO.
  -- The NOT EXISTS guard makes this safe to call repeatedly (the trigger may
  -- fire once per serial within a single multi-row UPDATE).
  FOR v_failed IN
    SELECT s.id, s.product_id, s.serial_number, s.qc_notes, s.qc_images
      FROM public.goods_receipt_serials s
     WHERE s.goods_receipt_id = p_gr_id
       AND s.qc_status = 'failed'
       AND s.stock_status IN ('rejected', 'under_correction')
       AND NOT EXISTS (
         SELECT 1 FROM public.correction_order_items i
          WHERE i.goods_receipt_serial_id = s.id
       )
  LOOP
    INSERT INTO public.correction_orders (
      co_number, source_type, source_document_id, source_document_reference,
      addressed_to_type, addressed_to_name, correction_type, status, created_by
    ) VALUES (
      public.generate_document_number('correction_order'),
      'goods_receipt', p_gr_id, v_gr_ref,
      'vendor', NULL, 'replace', 'draft', auth.uid()
    ) RETURNING id INTO v_co_id;

    INSERT INTO public.correction_order_items (
      correction_order_id, goods_receipt_serial_id, product_id, serial_number,
      original_qc_notes, original_qc_images, latest_qc_status, latest_qc_cycle, current_status
    ) VALUES (
      v_co_id, v_failed.id, v_failed.product_id, v_failed.serial_number,
      v_failed.qc_notes, COALESCE(v_failed.qc_images, '[]'::jsonb), 'failed', 1, 'awaiting_correction'
    );

    v_last_co_id := v_co_id;
  END LOOP;

  RETURN v_last_co_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.cancel_write_off(p_wf_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admins can cancel write-offs';
  END IF;
  SELECT status INTO v_status FROM public.write_off_records WHERE id = p_wf_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Write-off not found'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'Only draft write-offs can be cancelled'; END IF;

  UPDATE public.write_off_records
     SET status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
         cancellation_reason = p_reason, updated_at = now()
   WHERE id = p_wf_id;
  RETURN jsonb_build_object('success', true);
END $function$
;

CREATE OR REPLACE FUNCTION public.check_so_ready_to_invoice(p_so_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pct numeric;
  v_total numeric;
  v_paid numeric;
  v_pending_lines int;
BEGIN
  SELECT COALESCE(total,0) INTO v_total FROM public.sales_orders WHERE id = p_so_id;
  IF v_total IS NULL OR v_total = 0 THEN RETURN false; END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.sales_order_payments
    WHERE sales_order_id = p_so_id AND is_voided = false;
  v_pct := (v_paid / v_total) * 100;
  IF v_pct < 100 THEN RETURN false; END IF;

  SELECT COUNT(*) INTO v_pending_lines
  FROM public.internal_transfer_order_lines l
  JOIN public.internal_transfer_orders i ON i.id = l.internal_transfer_order_id
  WHERE i.sales_order_id = p_so_id
    AND i.status <> 'cancelled'
    AND l.line_status <> 'completed';
  IF v_pending_lines > 0 THEN RETURN false; END IF;

  RETURN EXISTS (SELECT 1 FROM public.internal_transfer_orders WHERE sales_order_id = p_so_id AND status <> 'cancelled');
END $function$
;

CREATE OR REPLACE FUNCTION public.close_correction_order(p_co_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pending int;
BEGIN
  IF NOT (public.is_admin() OR public.can_write_inventory()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- An item is "resolved" once it has passed re-QC, been refunded by the
  -- vendor, or been routed to a write-off (marked closed). Anything else still
  -- needs a decision, so the order cannot close yet.
  SELECT COUNT(*) INTO v_pending
    FROM public.correction_order_items
   WHERE correction_order_id = p_co_id
     AND current_status NOT IN ('qc_passed', 'refunded_by_vendor', 'closed');

  IF v_pending > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', v_pending || ' item(s) are not yet resolved'
    );
  END IF;

  UPDATE public.correction_orders
     SET status = 'closed', closed_at = now(), closed_by = auth.uid(), updated_at = now()
   WHERE id = p_co_id;

  RETURN jsonb_build_object('success', true);
END $function$
;

CREATE OR REPLACE FUNCTION public.complete_correction_qc_cycle(p_co_item_id uuid, p_passed boolean, p_notes text, p_images jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_next int;
  v_serial_id uuid;
  v_new_status text;
  v_item_status text;
BEGIN
  SELECT COALESCE(MAX(cycle_number),0)+1, MAX(goods_receipt_serial_id)
    INTO v_next, v_serial_id
    FROM public.correction_qc_cycles c
    RIGHT JOIN public.correction_order_items i ON i.id = c.correction_order_item_id
    WHERE i.id = p_co_item_id;

  IF v_next IS NULL THEN v_next := 1; END IF;

  INSERT INTO public.correction_qc_cycles (
    correction_order_item_id, cycle_number, qc_status, qc_notes, qc_images, qc_checked_by
  ) VALUES (
    p_co_item_id, v_next, CASE WHEN p_passed THEN 'passed' ELSE 'failed' END,
    p_notes, COALESCE(p_images, '[]'::jsonb), v_uid
  );

  v_new_status := CASE WHEN p_passed THEN 'passed' ELSE 'failed' END;
  v_item_status := CASE WHEN p_passed THEN 'qc_passed' ELSE 'qc_failed_again' END;

  UPDATE public.correction_order_items
     SET latest_qc_status = v_new_status,
         latest_qc_cycle = v_next,
         current_status = v_item_status,
         updated_at = now()
   WHERE id = p_co_item_id
   RETURNING goods_receipt_serial_id INTO v_serial_id;

  IF p_passed AND v_serial_id IS NOT NULL THEN
    UPDATE public.goods_receipt_serials
       SET qc_status = 'passed',
           stock_status = 'available',
           qc_checked_by = v_uid,
           qc_checked_at = now(),
           updated_at = now()
     WHERE id = v_serial_id;
  END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.complete_delivery_with_qc(_dn_id uuid, _signature_received boolean DEFAULT false)
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
  SELECT * INTO v_dn FROM delivery_notes WHERE id = _dn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery note not found'; END IF;
  IF v_dn.status = 'delivered' THEN RAISE EXCEPTION 'Delivery note already delivered'; END IF;
  v_so_id := v_dn.sales_order_id;

  -- Payment gate applies only to sales-order-linked deliveries. A standalone
  -- delivery (no SO) passes trivially — the full-payment predicate is injected
  -- by the sales wiring later (interface stub, plan §8).
  IF v_so_id IS NOT NULL THEN
    SELECT COALESCE(paid_amount,0), COALESCE(grand_total, total, 0)
      INTO v_paid, v_total
    FROM sales_orders WHERE id = v_so_id FOR UPDATE;
    IF v_total <= 0 OR v_paid + 0.005 < v_total THEN
      RAISE EXCEPTION 'Delivery available after full payment. Current: ₹% paid of ₹%', v_paid, v_total;
    END IF;
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
   AND (v_so_id IS NULL OR g.reserved_for_so_id = v_so_id)
  WHERE i.document_type = 'delivery_note'
    AND i.document_id = _dn_id
    AND i.qc_status IN ('pass','fail');

  PERFORM 1 FROM goods_receipt_serials
   WHERE id IN (SELECT grs_id FROM _dn_insp WHERE grs_id IS NOT NULL)
   FOR UPDATE;

  FOR r IN SELECT * FROM _dn_insp WHERE grs_id IS NULL LOOP
    IF v_so_id IS NULL THEN
      RAISE EXCEPTION 'Serial % is not a known stock unit', r.serial_number;
    ELSE
      RAISE EXCEPTION 'Serial % is not reserved for this order', r.serial_number;
    END IF;
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

  IF v_so_id IS NOT NULL THEN
  DELETE FROM stock_reservations
   WHERE sales_order_id = v_so_id
     AND (serial_number_id IN (
            SELECT sn.id FROM serial_numbers sn
             WHERE lower(sn.name) IN (SELECT lower(serial_number) FROM _dn_insp WHERE qc_status='pass')
          )
       OR status = 'reserved');
  END IF;

  UPDATE delivery_notes
     SET status = 'delivered',
         delivered_at = now(),
         delivery_date = now(),
         signature_collected = COALESCE(_signature_received, false),
         customer_signature_received = COALESCE(_signature_received, false),
         customer_signature_date = CASE WHEN _signature_received THEN now()::date ELSE NULL END,
         qc_by = v_uid
   WHERE id = _dn_id;

  IF v_so_id IS NOT NULL THEN
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
END $function$
;

CREATE OR REPLACE FUNCTION public.complete_gr_line_qc(p_gr_line_id uuid, p_passed_serial_ids uuid[], p_failed_serial_ids uuid[], p_failed_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_gr_id uuid;
  v_gr_number text;
  v_wh_id uuid;
  v_op_type_id uuid;
  v_doc_src uuid;
  v_doc_dst uuid;
  v_loc_id uuid;
  v_loc_name text;
  v_vendor_loc_id uuid;
  v_vendor_loc_name text;
  v_has_passed boolean;
  v_pass_cnt int := 0;
  v_fail_cnt int := 0;
  v_pending_lines int;
  v_ser record;
  v_move_id uuid;
BEGIN
  SELECT gr.goods_receipt_id, grh.warehouse_id, grh.gr_number,
         grh.operation_type_id, grh.source_location_id, grh.dest_location_id
    INTO v_gr_id, v_wh_id, v_gr_number,
         v_op_type_id, v_doc_src, v_doc_dst
    FROM public.goods_receipt_lines gr
    JOIN public.goods_receipts grh ON grh.id = gr.goods_receipt_id
   WHERE gr.id = p_gr_line_id;
  IF v_gr_id IS NULL THEN RAISE EXCEPTION 'GR line % not found', p_gr_line_id; END IF;

  -- ---- destination: document -> operation type -> warehouse default ----
  v_loc_id := v_doc_dst;

  IF v_loc_id IS NULL AND v_op_type_id IS NOT NULL THEN
    SELECT default_dest_location_id INTO v_loc_id
      FROM public.operation_types WHERE id = v_op_type_id;
  END IF;

  IF v_loc_id IS NULL AND v_wh_id IS NOT NULL THEN
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

  -- ---- source: document -> operation type -> VDR106 ----
  v_vendor_loc_id := v_doc_src;

  IF v_vendor_loc_id IS NULL AND v_op_type_id IS NOT NULL THEN
    SELECT default_source_location_id INTO v_vendor_loc_id
      FROM public.operation_types WHERE id = v_op_type_id;
  END IF;

  IF v_vendor_loc_id IS NULL THEN
    SELECT id INTO v_vendor_loc_id
      FROM public.warehouse_locations WHERE code = 'VDR106' LIMIT 1;
  END IF;

  SELECT name INTO v_loc_name        FROM public.warehouse_locations WHERE id = v_loc_id;
  SELECT name INTO v_vendor_loc_name FROM public.warehouse_locations WHERE id = v_vendor_loc_id;

  -- ---- Rule 5: fail loudly BEFORE writing anything ----
  v_has_passed := p_passed_serial_ids IS NOT NULL
                  AND array_length(p_passed_serial_ids, 1) > 0;

  IF v_has_passed AND v_loc_id IS NULL THEN
    RAISE EXCEPTION
      'Cannot complete QC for goods receipt %: no destination location could be resolved. Set a destination on the receipt, a default destination on its operation type, or a default receipt location on its warehouse.',
      COALESCE(v_gr_number, v_gr_id::text)
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_has_passed AND v_vendor_loc_id IS NULL THEN
    RAISE EXCEPTION
      'Cannot complete QC for goods receipt %: no source location could be resolved. Set a source on the receipt, a default source on its operation type, or create the VDR106 vendor location.',
      COALESCE(v_gr_number, v_gr_id::text)
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_has_passed THEN
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

    -- Ledger: one stock_moves row per passed serial. The NOT EXISTS guard keeps
    -- re-runs from writing duplicates.
    FOR v_ser IN
      SELECT s.id, s.serial_number, s.product_id,
             p.name  AS product_name,
             p.sku   AS product_sku
        FROM public.goods_receipt_serials s
        LEFT JOIN public.products p ON p.id = s.product_id
       WHERE s.id = ANY(p_passed_serial_ids)
         AND s.goods_receipt_line_id = p_gr_line_id
         AND NOT EXISTS (
           SELECT 1 FROM public.stock_move_lines sml
            WHERE s.serial_number = ANY(sml.serial_numbers)
         )
    LOOP
      INSERT INTO public.stock_moves (
        reference, operation_type, source_location_id, source_location_name,
        destination_location_id, destination_location_name, scheduled_date, state,
        source_document, reference_document_type, reference_document_id, created_by
      ) VALUES (
        'GRQC/' || substr(v_ser.id::text, 1, 8),
        'receipt', v_vendor_loc_id, v_vendor_loc_name,
        v_loc_id, v_loc_name,
        now(), 'done',
        v_gr_number, 'goods_receipt', v_gr_id, v_uid
      ) RETURNING id INTO v_move_id;

      INSERT INTO public.stock_move_lines (
        stock_move_id, product_id, product_name, product_sku,
        demand_qty, reserved_qty, done_qty, unit_of_measure,
        source_location_id, destination_location_id, serial_numbers
      ) VALUES (
        v_move_id, v_ser.product_id, v_ser.product_name, v_ser.product_sku,
        1, 1, 1, 'Unit',
        v_vendor_loc_id, v_loc_id, ARRAY[v_ser.serial_number]::text[]
      );
    END LOOP;
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
    -- Correction orders are raised by trg_gr_serial_after_under_correction,
    -- which fires on the 'rejected' transition above.
  END IF;

  -- Recompute the line's accounting from the serials rather than incrementing,
  -- so this whole function is idempotent and rejects are not mislabelled as
  -- under-correction.
  UPDATE public.goods_receipt_lines l
     SET accepted_quantity = (
           SELECT count(*) FROM public.goods_receipt_serials s
            WHERE s.goods_receipt_line_id = l.id AND s.stock_status = 'available'),
         rejected_quantity = (
           SELECT count(*) FROM public.goods_receipt_serials s
            WHERE s.goods_receipt_line_id = l.id AND s.stock_status = 'rejected'),
         under_correction_quantity = (
           SELECT count(*) FROM public.goods_receipt_serials s
            WHERE s.goods_receipt_line_id = l.id AND s.stock_status = 'under_correction'),
         updated_at = now()
   WHERE l.id = p_gr_line_id;

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
END $function$
;

CREATE OR REPLACE FUNCTION public.complete_internal_movement(p_movement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_movement public.internal_movements%ROWTYPE;
  v_item record;
  v_uid uuid := auth.uid();
  v_dest_name text;
  v_src_name text;
  v_move_id uuid;
  v_prod record;
BEGIN
  IF NOT (public.is_admin() OR public.can_write_inventory()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_movement FROM public.internal_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movement not found'; END IF;
  IF v_movement.status = 'completed' THEN RETURN; END IF;

  SELECT name INTO v_dest_name FROM public.warehouse_locations WHERE id = v_movement.to_location_id;
  SELECT name INTO v_src_name  FROM public.warehouse_locations WHERE id = v_movement.from_location_id;

  FOR v_item IN
    SELECT * FROM public.internal_movement_items WHERE internal_movement_id = p_movement_id
  LOOP
    IF v_item.goods_receipt_serial_id IS NOT NULL THEN
      UPDATE public.goods_receipt_serials
         SET stock_status = CASE v_movement.movement_type
              WHEN 'display_sold'      THEN 'sold'
              WHEN 'return_to_vendor'  THEN 'returned_to_vendor'
              WHEN 'damage_quarantine' THEN 'under_correction'
              ELSE stock_status  -- rearrangement / location_change / cycle_count_reconciliation
             END,
             -- Relocate when the movement names a concrete destination. Older
             -- movements only carried a category (to_location_type), so guard.
             current_location = COALESCE(v_movement.to_location_id::text, current_location),
             updated_at = now()
       WHERE id = v_item.goods_receipt_serial_id;

      IF v_movement.to_location_id IS NOT NULL THEN
        SELECT name, sku INTO v_prod FROM public.products WHERE id = v_item.product_id;
        INSERT INTO public.stock_moves (
          reference, operation_type, source_location_id, source_location_name,
          destination_location_id, destination_location_name, scheduled_date, state,
          source_document, reference_document_type, reference_document_id, created_by
        ) VALUES (
          'IM/' || v_movement.movement_number, 'internal',
          v_movement.from_location_id, v_src_name,
          v_movement.to_location_id, v_dest_name,
          now(), 'done', v_movement.movement_number,
          'internal_movement', p_movement_id, v_uid
        ) RETURNING id INTO v_move_id;

        INSERT INTO public.stock_move_lines (
          stock_move_id, product_id, product_name, product_sku,
          demand_qty, reserved_qty, done_qty, unit_of_measure, serial_numbers,
          source_location_id, destination_location_id
        ) VALUES (
          v_move_id, v_item.product_id, v_prod.name, v_prod.sku,
          1, 1, 1, 'Unit', ARRAY[v_item.serial_number]::text[],
          v_movement.from_location_id, v_movement.to_location_id
        );
      END IF;
    END IF;
  END LOOP;

  UPDATE public.internal_movements
     SET status = 'completed', completed_by = v_uid, completed_at = now(), updated_at = now()
   WHERE id = p_movement_id;
END;
$function$
;

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
           -- The unit is going to correction, so it is no longer reserved for
           -- the SO. Clearing this is also required: enforce_grs_reservation_status
           -- aborts the whole transaction if reserved_for_so_id is set while
           -- stock_status is anything other than 'reserved'.
           reserved_for_so_id = NULL,
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

  IF v_passed_count = 0 THEN
    IF EXISTS (SELECT 1 FROM qc_inspections WHERE document_type = 'ito' AND document_id = _ito_id) THEN
      RAISE EXCEPTION 'No units have completed QC yet. Mark each scanned unit pass or fail before completing.';
    ELSE
      RAISE EXCEPTION 'No units have been scanned for this transfer. Scan the reserved serials first.';
    END IF;
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
END $function$
;

CREATE OR REPLACE FUNCTION public.complete_pick_to_transit(p_movement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_mv public.internal_movements%ROWTYPE;
  v_dest_name text;
  v_src_name text;
  v_total int;
  v_inspected int;
  v_failed int;
  v_passed int;
  v_failed_serials text[] := ARRAY[]::text[];
  v_co_id uuid;
  v_last_co uuid := NULL;
  r record;
  v_move_id uuid;
  v_prod record;
BEGIN
  IF NOT (public.is_admin() OR public.can_write_inventory()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_mv FROM public.internal_movements WHERE id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movement not found'; END IF;
  IF v_mv.movement_type <> 'pick_to_transit' THEN
    RAISE EXCEPTION 'Not a pick-to-transit movement';
  END IF;
  IF v_mv.status = 'completed' THEN RAISE EXCEPTION 'Movement already completed'; END IF;
  IF v_mv.to_location_id IS NULL THEN
    RAISE EXCEPTION 'No transit destination set on this movement';
  END IF;

  SELECT name INTO v_dest_name FROM public.warehouse_locations WHERE id = v_mv.to_location_id;
  SELECT name INTO v_src_name  FROM public.warehouse_locations WHERE id = v_mv.from_location_id;

  -- The expected pool is the movement's items. Every one must carry a pass/fail
  -- QC result recorded through the shared engine.
  SELECT count(*) INTO v_total FROM public.internal_movement_items WHERE internal_movement_id = p_movement_id;
  IF v_total = 0 THEN RAISE EXCEPTION 'No units on this movement'; END IF;

  CREATE TEMP TABLE _pt ON COMMIT DROP AS
  SELECT it.goods_receipt_serial_id AS grs_id, it.product_id, it.serial_number,
         i.qc_status, i.qc_notes, i.photo_urls
    FROM public.internal_movement_items it
    LEFT JOIN public.qc_inspections i
      ON i.document_type = 'internal_transfer'
     AND i.document_id = p_movement_id
     AND lower(i.serial_number) = lower(it.serial_number)
     AND i.qc_status IN ('pass','fail')
   WHERE it.internal_movement_id = p_movement_id;

  SELECT count(*) FILTER (WHERE qc_status IN ('pass','fail')),
         count(*) FILTER (WHERE qc_status = 'fail'),
         count(*) FILTER (WHERE qc_status = 'pass'),
         COALESCE(array_agg(serial_number) FILTER (WHERE qc_status = 'fail'), ARRAY[]::text[])
    INTO v_inspected, v_failed, v_passed, v_failed_serials
  FROM _pt;

  IF v_inspected < v_total THEN
    RAISE EXCEPTION 'Not all units have completed QC (% of % inspected)', v_inspected, v_total;
  END IF;

  -- Failures: flag for correction and raise one correction order per unit, then
  -- block. The unit stays where it is physically; it just cannot go to transit.
  IF v_failed > 0 THEN
    FOR r IN SELECT * FROM _pt WHERE qc_status = 'fail' LOOP
      UPDATE public.goods_receipt_serials
         SET stock_status = 'under_correction',
             reserved_for_so_id = NULL,
             qc_checked_by = v_uid, qc_checked_at = now(), updated_at = now()
       WHERE id = r.grs_id;

      INSERT INTO public.correction_orders (
        co_number, source_type, source_document_id, source_document_reference,
        addressed_to_type, addressed_to_name, correction_type, status, created_by, notes
      ) VALUES (
        public.generate_document_number('correction_order'),
        'manual', p_movement_id, v_mv.movement_number,
        'vendor', NULL, 'replace', 'draft', v_uid,
        'Failed QC during pick-to-transit ' || v_mv.movement_number
      ) RETURNING id INTO v_co_id;

      INSERT INTO public.correction_order_items (
        correction_order_id, goods_receipt_serial_id, product_id, serial_number,
        original_qc_notes, original_qc_images, latest_qc_status, latest_qc_cycle, current_status
      ) VALUES (
        v_co_id, r.grs_id, r.product_id, r.serial_number,
        r.qc_notes, COALESCE(to_jsonb(r.photo_urls), '[]'::jsonb), 'failed', 1, 'awaiting_correction'
      );
      v_last_co := v_co_id;
    END LOOP;

    RETURN jsonb_build_object(
      'status', 'blocked_by_failures',
      'failed', v_failed,
      'failed_serials', v_failed_serials,
      'correction_order_id', v_last_co,
      'movement_number', v_mv.movement_number
    );
  END IF;

  -- All passed: move each serial to the transit location and write the ledger.
  FOR r IN SELECT * FROM _pt LOOP
    UPDATE public.goods_receipt_serials
       SET current_location = v_mv.to_location_id::text,
           qc_checked_by = v_uid, qc_checked_at = now(), updated_at = now()
     WHERE id = r.grs_id;

    SELECT name, sku INTO v_prod FROM public.products WHERE id = r.product_id;
    INSERT INTO public.stock_moves (
      reference, operation_type, source_location_id, source_location_name,
      destination_location_id, destination_location_name, scheduled_date, state,
      source_document, reference_document_type, reference_document_id, created_by
    ) VALUES (
      'PTT/' || v_mv.movement_number, 'internal',
      v_mv.from_location_id, v_src_name,
      v_mv.to_location_id, v_dest_name,
      now(), 'done', v_mv.movement_number,
      'internal_movement', p_movement_id, v_uid
    ) RETURNING id INTO v_move_id;

    INSERT INTO public.stock_move_lines (
      stock_move_id, product_id, product_name, product_sku,
      demand_qty, reserved_qty, done_qty, unit_of_measure, serial_numbers,
      source_location_id, destination_location_id
    ) VALUES (
      v_move_id, r.product_id, v_prod.name, v_prod.sku,
      1, 1, 1, 'Unit', ARRAY[r.serial_number]::text[],
      v_mv.from_location_id, v_mv.to_location_id
    );
  END LOOP;

  UPDATE public.internal_movements
     SET status = 'completed', completed_by = v_uid, completed_at = now(), updated_at = now()
   WHERE id = p_movement_id;

  RETURN jsonb_build_object(
    'status', 'completed',
    'moved', v_passed,
    'transit_location_id', v_mv.to_location_id,
    'transit_location_name', v_dest_name,
    'movement_number', v_mv.movement_number
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_scan_queue(p_queue_id uuid, p_force boolean DEFAULT false, p_reason text DEFAULT NULL::text)
 RETURNS scan_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_queue public.scan_queue;
BEGIN
  SELECT * INTO v_queue FROM public.scan_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scan_queue % not found', p_queue_id;
  END IF;
  IF v_queue.scan_status = 'completed' THEN
    RAISE EXCEPTION 'scan queue already completed';
  END IF;
  IF v_queue.scanned_items_count = 0 THEN
    RAISE EXCEPTION 'cannot complete a scan queue with zero scans';
  END IF;
  IF v_queue.scanned_items_count < v_queue.expected_items_count AND NOT p_force THEN
    RAISE EXCEPTION 'expected % but only % scanned; pass force=true with a reason to override', v_queue.expected_items_count, v_queue.scanned_items_count;
  END IF;
  IF p_force AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'reason required when forcing completion';
  END IF;

  UPDATE public.scan_queue
  SET scan_status = 'completed',
      notes = CASE WHEN p_force THEN coalesce(notes || E'\n', '') || 'FORCED: ' || p_reason ELSE notes END,
      updated_at = now()
  WHERE id = p_queue_id
  RETURNING * INTO v_queue;
  RETURN v_queue;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_stock_count(p_count_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_admin() OR public.can_write_inventory()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  UPDATE public.stock_count_items
     SET actual_status = 'missing', updated_at = now()
   WHERE stock_count_id = p_count_id AND actual_status IS NULL;
  UPDATE public.stock_counts SET status = 'completed', completed_at = now(), updated_at = now()
   WHERE id = p_count_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_delivery(p_dn_id uuid, p_signature_received boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dn RECORD;
  v_sn text;
  v_so_closed boolean := false;
  v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_dn FROM public.delivery_notes WHERE id = p_dn_id FOR UPDATE;
  IF v_dn.id IS NULL THEN RAISE EXCEPTION 'Delivery note not found'; END IF;

  UPDATE public.delivery_notes
     SET customer_signature_received = COALESCE(p_signature_received, false),
         customer_signature_date = CASE WHEN p_signature_received THEN CURRENT_DATE ELSE NULL END,
         delivered_at = now(),
         delivered_by_user_id = COALESCE(delivered_by_user_id, v_uid),
         status = 'delivered',
         signature_collected = COALESCE(p_signature_received, false)
   WHERE id = p_dn_id;

  -- Mark serials as sold
  FOR v_sn IN
    SELECT jsonb_array_elements_text(serial_numbers)
      FROM public.delivery_note_lines WHERE delivery_note_id = p_dn_id
  LOOP
    UPDATE public.goods_receipt_serials
       SET stock_status = 'sold', updated_at = now()
     WHERE serial_number = v_sn;
  END LOOP;

  -- SO closure cascade
  IF v_dn.sales_order_id IS NOT NULL THEN
    IF public.check_so_closure_ready(v_dn.sales_order_id) THEN
      UPDATE public.sales_orders SET status = 'closed' WHERE id = v_dn.sales_order_id;
      v_so_closed := true;
      BEGIN
        INSERT INTO public.activity_log (entity_type, entity_id, action, details, performed_by)
        VALUES ('sales_order', v_dn.sales_order_id, 'order_closed',
          jsonb_build_object('reason','all items delivered','triggered_by_dn', p_dn_id), v_uid);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    ELSE
      UPDATE public.sales_orders SET status = 'delivering'
       WHERE id = v_dn.sales_order_id AND status NOT IN ('cancelled','closed');
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.activity_log (entity_type, entity_id, action, details, performed_by)
    VALUES ('delivery_note', p_dn_id, 'delivery_confirmed',
      jsonb_build_object('signature_received', p_signature_received), v_uid);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('dn_id', p_dn_id, 'so_closed', v_so_closed);
END $function$
;

CREATE OR REPLACE FUNCTION public.create_ito_from_so(p_so_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ito_id uuid;
  v_number text;
  v_line record;
  v_qty int;
  v_reserved_count int;
  v_line_status text;
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.is_admin()
    OR public.has_any_role(
      v_user,
      ARRAY['admin','super_admin','sales_manager','sales_rep','warehouse_operator']::public.app_role[]
    )
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.sales_orders WHERE id = p_so_id) THEN
    RAISE EXCEPTION 'Sales order not found';
  END IF;

  SELECT id INTO v_ito_id
    FROM public.internal_transfer_orders
   WHERE sales_order_id = p_so_id
     AND status <> 'cancelled'
   LIMIT 1;
  IF v_ito_id IS NOT NULL THEN
    RETURN v_ito_id;
  END IF;

  v_number := public.generate_document_number('internal_transfer');

  INSERT INTO public.internal_transfer_orders(
    ito_number, sales_order_id, status, created_by, confirmed_by, confirmed_at
  ) VALUES (
    v_number, p_so_id, 'confirmed', v_user, v_user, now()
  )
  RETURNING id INTO v_ito_id;

  FOR v_line IN
    SELECT id, product_id, product_source, quantity
      FROM public.order_lines
     WHERE order_id = p_so_id
       AND COALESCE(product_source, 'warehouse') IN ('warehouse','display')
  LOOP
    v_qty := GREATEST(1, CEIL(COALESCE(v_line.quantity, 0))::integer);

    -- Reserve up to v_qty available serials FIFO for this product.
    -- We do NOT capture RETURNING into a variable — the previous
    -- version tried to write multiple uuid rows into a uuid[] scalar
    -- variable, which Postgres treats as a per-row cast and blows up
    -- with "malformed array literal".
    WITH picked AS (
      SELECT id
        FROM public.goods_receipt_serials
       WHERE product_id = v_line.product_id
         AND stock_status = 'available'
         AND reserved_for_so_id IS NULL
       ORDER BY created_at ASC
       LIMIT v_qty
       FOR UPDATE SKIP LOCKED
    )
    UPDATE public.goods_receipt_serials s
       SET stock_status = 'reserved',
           reserved_for_so_id = p_so_id,
           updated_at = now()
      FROM picked
     WHERE s.id = picked.id;

    SELECT COUNT(*) INTO v_reserved_count
      FROM public.goods_receipt_serials
     WHERE reserved_for_so_id = p_so_id
       AND product_id = v_line.product_id;

    IF v_reserved_count >= v_qty THEN
      v_line_status := 'pending';
    ELSE
      v_line_status := 'blocked';
    END IF;

    INSERT INTO public.internal_transfer_order_lines(
      internal_transfer_order_id,
      sales_order_line_id,
      product_id,
      product_source,
      quantity_expected,
      quantity_scanned,
      line_status
    ) VALUES (
      v_ito_id,
      v_line.id,
      v_line.product_id,
      COALESCE(v_line.product_source, 'warehouse'),
      v_qty,
      0,
      v_line_status
    );
  END LOOP;

  UPDATE public.sales_orders
     SET status = 'fulfilling', updated_at = now()
   WHERE id = p_so_id AND status <> 'fulfilling';

  RETURN v_ito_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_partial_delivery_note(p_invoice_id uuid, p_line_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice RECORD;
  v_so RECORD;
  v_reference text;
  v_dn_id uuid;
  v_seq int;
  v_item jsonb;
  v_line RECORD;
  v_qty numeric;
  v_serials jsonb;
  v_sn text;
  v_serial_row RECORD;
  v_products jsonb := '[]'::jsonb;
  v_total_items int := 0;
  v_is_partial boolean;
  v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF COALESCE(v_invoice.status,'') = 'cancelled' THEN
    RAISE EXCEPTION 'Invoice is cancelled and cannot be delivered';
  END IF;

  SELECT * INTO v_so FROM public.sales_orders WHERE id = v_invoice.sales_order_id;

  v_seq := (SELECT COUNT(*)+1 FROM public.delivery_notes WHERE invoice_id = p_invoice_id);
  v_reference := public.generate_document_number('delivery_note');

  INSERT INTO public.delivery_notes (
    reference, sales_order_id, invoice_id, customer_id,
    status, created_by, products_json,
    customer_delivery_name, customer_delivery_address, customer_delivery_phone,
    dn_sequence_in_invoice
  ) VALUES (
    v_reference, v_invoice.sales_order_id, p_invoice_id, v_invoice.customer_id,
    'draft', v_uid, '[]'::jsonb,
    COALESCE(v_so.delivery_name, v_so.billing_name, v_so.customer_name),
    CONCAT_WS(', ',
      COALESCE(v_so.delivery_address_line_1, v_so.billing_address_line_1),
      COALESCE(v_so.delivery_address_line_2, v_so.billing_address_line_2),
      COALESCE(v_so.delivery_city, v_so.billing_city),
      COALESCE(v_so.delivery_state, v_so.billing_state),
      COALESCE(v_so.delivery_zip, v_so.billing_zip)
    ),
    COALESCE(v_so.delivery_phone_1, v_so.billing_phone_1),
    v_seq
  ) RETURNING id INTO v_dn_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_line_items) LOOP
    v_qty := COALESCE((v_item->>'quantity_to_deliver')::numeric, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_line FROM public.invoice_lines
     WHERE id = (v_item->>'invoice_line_id')::uuid AND invoice_id = p_invoice_id FOR UPDATE;
    IF v_line.id IS NULL THEN RAISE EXCEPTION 'Invoice line % not found on invoice', v_item->>'invoice_line_id'; END IF;

    IF v_qty > (v_line.quantity - COALESCE(v_line.quantity_delivered,0)) THEN
      RAISE EXCEPTION 'Qty % exceeds remaining-to-deliver for line %', v_qty, v_line.id;
    END IF;

    v_serials := COALESCE(v_item->'serial_numbers', '[]'::jsonb);

    -- validate each serial reserved to SO and not already delivered
    FOR v_sn IN SELECT jsonb_array_elements_text(v_serials) LOOP
      SELECT * INTO v_serial_row FROM public.goods_receipt_serials
        WHERE serial_number = v_sn LIMIT 1;
      IF v_serial_row.id IS NULL THEN
        RAISE EXCEPTION 'Serial % not found', v_sn;
      END IF;
      IF v_serial_row.reserved_for_so_id IS DISTINCT FROM v_invoice.sales_order_id
         AND v_serial_row.stock_status <> 'sold' THEN
        RAISE EXCEPTION 'Serial % is not reserved to this sales order', v_sn;
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.delivery_note_lines dnl,
               LATERAL jsonb_array_elements_text(dnl.serial_numbers) s
         WHERE s = v_sn
      ) THEN
        RAISE EXCEPTION 'Serial % is already on another delivery note', v_sn;
      END IF;
    END LOOP;

    INSERT INTO public.delivery_note_lines (
      delivery_note_id, invoice_line_id, product_id, product_name,
      quantity_from_invoice_line, serial_numbers
    ) VALUES (
      v_dn_id, v_line.id, v_line.product_id, v_line.description,
      v_qty, v_serials
    );

    UPDATE public.invoice_lines
       SET quantity_delivered = COALESCE(quantity_delivered,0) + v_qty,
           updated_at = now()
     WHERE id = v_line.id;

    v_total_items := v_total_items + v_qty::int;
    v_products := v_products || jsonb_build_array(jsonb_build_object(
      'product_id', v_line.product_id,
      'product_name', COALESCE(v_line.description,'Item'),
      'quantity', v_qty,
      'unit', 'Unit',
      'serial_numbers', v_serials,
      'warehouse_location', ''
    ));
  END LOOP;

  -- is_partial?
  SELECT EXISTS (
    SELECT 1 FROM public.invoice_lines
     WHERE invoice_id = p_invoice_id AND COALESCE(quantity_delivered,0) < quantity
  ) INTO v_is_partial;

  UPDATE public.delivery_notes
     SET products_json = v_products, is_partial = v_is_partial
   WHERE id = v_dn_id;

  -- Add to scan queue (pre-delivery scan verification)
  INSERT INTO public.scan_queue (
    document_type, document_id, document_reference,
    expected_items_count, scan_status, priority
  ) VALUES (
    'delivery_note', v_dn_id, v_reference, v_total_items, 'pending', 'normal'
  );

  -- Update SO status to 'delivering' (will go to 'delivered' on confirm)
  IF v_invoice.sales_order_id IS NOT NULL THEN
    UPDATE public.sales_orders
       SET status = CASE WHEN status IN ('cancelled','closed') THEN status
                         ELSE 'delivering' END
     WHERE id = v_invoice.sales_order_id;
  END IF;

  -- Activity logs (best effort)
  BEGIN
    INSERT INTO public.activity_log (entity_type, entity_id, action, details, performed_by)
    VALUES
      ('invoice', p_invoice_id, 'delivery_note_created',
       jsonb_build_object('dn_id', v_dn_id, 'dn_reference', v_reference, 'is_partial', v_is_partial), v_uid),
      ('delivery_note', v_dn_id, 'created',
       jsonb_build_object('invoice_id', p_invoice_id, 'items', v_total_items), v_uid);
    IF v_invoice.sales_order_id IS NOT NULL THEN
      INSERT INTO public.activity_log (entity_type, entity_id, action, details, performed_by)
      VALUES ('sales_order', v_invoice.sales_order_id, 'delivery_note_created',
        jsonb_build_object('dn_id', v_dn_id, 'dn_reference', v_reference), v_uid);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_dn_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.create_return_request(p_invoice_id uuid, p_items jsonb, p_reason text, p_issue_description text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_invoice public.invoices%ROWTYPE;
  v_so_id uuid;
  v_customer_id uuid;
  v_customer_name text;
  v_rt_id uuid;
  v_item jsonb;
  v_serial_id uuid;
  v_qty int;
  v_eligibility jsonb;
  v_serial public.goods_receipt_serials%ROWTYPE;
  v_dnl public.delivery_note_lines%ROWTYPE;
  v_dn_id uuid;
  v_invoice_line public.invoice_lines%ROWTYPE;
  v_so_line public.order_lines%ROWTYPE;
  v_unit_price numeric;
  v_is_custom boolean;
  v_custom_details jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  v_so_id := v_invoice.sales_order_id;
  IF v_so_id IS NULL THEN
    RAISE EXCEPTION 'Invoice has no linked sales order';
  END IF;

  SELECT customer_id, COALESCE(billing_customer_name,'')
    INTO v_customer_id, v_customer_name
    FROM public.sales_orders WHERE id = v_so_id;
  IF v_customer_name = '' OR v_customer_name IS NULL THEN
    SELECT name INTO v_customer_name FROM public.customers WHERE id = v_customer_id;
  END IF;

  -- Validate each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_serial_id := (v_item->>'serial_id')::uuid;
    v_eligibility := public.validate_return_eligibility(v_serial_id);
    IF NOT (v_eligibility->>'eligible')::boolean THEN
      RAISE EXCEPTION 'Item %: %', v_serial_id, v_eligibility->>'reason';
    END IF;
  END LOOP;

  INSERT INTO public.return_requests (
    source_invoice_id, source_sales_order_id, customer_id, customer_name_snapshot,
    request_status, customer_reported_reason, customer_reported_issue_description,
    requested_by, requested_at
  ) VALUES (
    p_invoice_id, v_so_id, v_customer_id, v_customer_name,
    'draft', p_reason, p_issue_description,
    v_uid, now()
  ) RETURNING id INTO v_rt_id;

  -- Insert items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_serial_id := (v_item->>'serial_id')::uuid;
    v_qty := COALESCE((v_item->>'qty')::int, 1);

    SELECT * INTO v_serial FROM public.goods_receipt_serials WHERE id = v_serial_id;

    SELECT dnl.* INTO v_dnl
    FROM public.delivery_note_lines dnl
    WHERE dnl.serial_numbers ? v_serial.serial_number
    ORDER BY dnl.created_at DESC
    LIMIT 1;
    v_dn_id := v_dnl.delivery_note_id;

    v_invoice_line := NULL;
    IF v_dnl.invoice_line_id IS NOT NULL THEN
      SELECT * INTO v_invoice_line FROM public.invoice_lines WHERE id = v_dnl.invoice_line_id;
    END IF;
    IF v_invoice_line.id IS NULL THEN
      SELECT * INTO v_invoice_line
      FROM public.invoice_lines
      WHERE invoice_id = p_invoice_id AND product_id = v_serial.product_id
      LIMIT 1;
    END IF;
    IF v_invoice_line.id IS NULL THEN
      RAISE EXCEPTION 'Could not locate invoice line for serial %', v_serial.serial_number;
    END IF;

    v_unit_price := COALESCE(v_invoice_line.unit_price, 0);
    v_is_custom := false;
    v_custom_details := NULL;

    IF v_invoice_line.sales_order_line_id IS NOT NULL THEN
      SELECT * INTO v_so_line FROM public.order_lines WHERE id = v_invoice_line.sales_order_line_id;
      v_is_custom := COALESCE(
        NULLIF(v_so_line.customization_size, '') IS NOT NULL
        OR NULLIF(v_so_line.customization_colour, '') IS NOT NULL
        OR NULLIF(v_so_line.customization_fabric, '') IS NOT NULL
        OR NULLIF(v_so_line.customization_polish, '') IS NOT NULL
        OR NULLIF(v_so_line.customization_notes, '') IS NOT NULL,
        false);
      IF v_is_custom THEN
        v_custom_details := jsonb_build_object(
          'size', v_so_line.customization_size,
          'colour', v_so_line.customization_colour,
          'fabric', v_so_line.customization_fabric,
          'polish', v_so_line.customization_polish,
          'notes', v_so_line.customization_notes
        );
      END IF;
    END IF;

    INSERT INTO public.return_request_items (
      return_request_id, goods_receipt_serial_id,
      delivery_note_id, delivery_note_line_id,
      invoice_line_id, product_id, serial_number, quantity,
      original_unit_price, is_customized, customization_details
    ) VALUES (
      v_rt_id, v_serial_id,
      v_dn_id, v_dnl.id,
      v_invoice_line.id, v_serial.product_id, v_serial.serial_number, v_qty,
      v_unit_price, v_is_custom, v_custom_details
    );
  END LOOP;

  RETURN v_rt_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.generate_document_number(p_document_type text, p_operation_type_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fy      text;
  v_padding integer;
  v_sep     text;
  v_next    integer;
  v_prefix  text;
  v_ot      public.operation_types%ROWTYPE;
BEGIN
  v_fy := public.get_current_fy_label();

  -- Global format defaults; an operation type may override them per-sequence.
  SELECT sequential_padding, prefix_separator INTO v_padding, v_sep
    FROM public.numbering_settings LIMIT 1;
  IF v_padding IS NULL THEN v_padding := 4; END IF;
  IF v_sep IS NULL THEN v_sep := '-'; END IF;

  -- =========================================================================
  -- BRANCH A — the operation type owns its sequence.
  --
  -- FOR UPDATE takes a row-level lock for the rest of the transaction, which is
  -- what makes the read-modify-write atomic. It is the per-row equivalent of
  -- the INSERT .. ON CONFLICT DO UPDATE used by the global branch: two
  -- concurrent inserts under the same operation type serialise here rather than
  -- both reading the same current_number.
  -- =========================================================================
  IF p_operation_type_id IS NOT NULL THEN
    SELECT * INTO v_ot
      FROM public.operation_types
     WHERE id = p_operation_type_id
       FOR UPDATE;

    IF FOUND AND v_ot.owns_sequence AND v_ot.sequence_prefix IS NOT NULL THEN
      -- Per-sequence format overrides, falling back to the global settings.
      v_padding := COALESCE(v_ot.sequence_padding, v_padding);
      v_sep     := COALESCE(v_ot.sequence_separator, v_sep);

      -- Financial-year roll-over: the first document of a new FY restarts the
      -- series at 1 and stamps the new label.
      IF v_ot.sequence_fy_label IS DISTINCT FROM v_fy THEN
        v_next := 1;
      ELSE
        v_next := v_ot.sequence_current_number + 1;
      END IF;

      UPDATE public.operation_types
         SET sequence_current_number = v_next,
             sequence_fy_label       = v_fy,
             updated_at              = now()
       WHERE id = p_operation_type_id;

      RETURN v_ot.sequence_prefix || v_sep || v_fy || v_sep
             || lpad(v_next::text, v_padding, '0');
    END IF;
    -- Not found, or does not own a sequence: fall through to the global branch.
  END IF;

  -- =========================================================================
  -- BRANCH B — global sequence. Unchanged from the pre-migration function.
  -- This is the path every Sales, Invoicing, Manufacturing and Returns document
  -- takes, and it must stay byte-for-byte equivalent in behaviour.
  -- =========================================================================
  v_prefix := CASE lower(p_document_type)
    WHEN 'sales_order' THEN 'SO' WHEN 'quotation' THEN 'QT' WHEN 'invoice' THEN 'INV'
    WHEN 'delivery_note' THEN 'DN' WHEN 'internal_transfer' THEN 'ITO' WHEN 'internal_movement' THEN 'IM'
    WHEN 'vendor_order' THEN 'VO' WHEN 'work_order' THEN 'WO' WHEN 'return_request' THEN 'RT'
    WHEN 'credit_note' THEN 'CN' WHEN 'goods_receipt' THEN 'GR' WHEN 'payment_receipt' THEN 'PR'
    WHEN 'correction_order' THEN 'CO' WHEN 'stock_count' THEN 'SC' WHEN 'write_off' THEN 'WF'
    WHEN 'refund' THEN 'RF' WHEN 'exchange' THEN 'EX'
    ELSE upper(p_document_type) END;

  INSERT INTO public.numbering_sequences (document_type, fy_label, last_number)
  VALUES (p_document_type, v_fy, 1)
  ON CONFLICT (document_type, fy_label)
  DO UPDATE SET last_number = public.numbering_sequences.last_number + 1, updated_at = now()
  RETURNING last_number INTO v_next;

  RETURN v_prefix || v_sep || v_fy || v_sep || lpad(v_next::text, v_padding, '0');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_serials_for_gr_line(p_gr_line_id uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line public.goods_receipt_lines%ROWTYPE;
  v_sku text;
  v_yymm text;
  v_existing int;
  v_to_create int;
  v_i int;
  v_serial text;
  v_barcode text;
  v_id uuid;
  v_out uuid[] := ARRAY[]::uuid[];
  v_qty int;
BEGIN
  SELECT * INTO v_line FROM public.goods_receipt_lines WHERE id = p_gr_line_id;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'GR line % not found', p_gr_line_id; END IF;

  SELECT COALESCE(sku, 'SKU') INTO v_sku FROM public.products WHERE id = v_line.product_id;
  v_yymm := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYMM');

  -- target qty is received_quantity (we generate labels once goods arrive)
  v_qty := GREATEST(COALESCE(v_line.received_quantity, 0), 0);

  SELECT COUNT(*) INTO v_existing FROM public.goods_receipt_serials WHERE goods_receipt_line_id = p_gr_line_id;
  v_to_create := v_qty - v_existing;
  IF v_to_create <= 0 THEN RETURN v_out; END IF;

  FOR v_i IN 1..v_to_create LOOP
    LOOP
      -- next sequence for this product+yymm
      SELECT v_sku || '-' || v_yymm || '-' || lpad(
        (COALESCE((
          SELECT MAX(CAST(split_part(serial_number, '-', array_length(string_to_array(serial_number, '-'),1)) AS integer))
          FROM public.goods_receipt_serials
          WHERE serial_number LIKE v_sku || '-' || v_yymm || '-%'
        ), 0) + 1)::text, 4, '0')
      INTO v_serial;
      v_barcode := 'GLF-' || v_serial;
      BEGIN
        INSERT INTO public.goods_receipt_serials (
          goods_receipt_id, goods_receipt_line_id, product_id, serial_number, barcode_value
        ) VALUES (v_line.goods_receipt_id, p_gr_line_id, v_line.product_id, v_serial, v_barcode)
        RETURNING id INTO v_id;
        v_out := array_append(v_out, v_id);
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- collision (rare with concurrent inserts), retry
        CONTINUE;
      END;
    END LOOP;
  END LOOP;

  RETURN v_out;
END $function$
;

CREATE OR REPLACE FUNCTION public.get_current_fy_label()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_month integer;
  v_day integer;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_start_year integer;
  v_end_year integer;
BEGIN
  SELECT fy_start_month, fy_start_day INTO v_month, v_day FROM public.numbering_settings LIMIT 1;
  IF v_month IS NULL THEN v_month := 4; v_day := 1; END IF;

  IF (EXTRACT(MONTH FROM v_today)::int > v_month)
     OR (EXTRACT(MONTH FROM v_today)::int = v_month AND EXTRACT(DAY FROM v_today)::int >= v_day) THEN
    v_start_year := EXTRACT(YEAR FROM v_today)::int;
  ELSE
    v_start_year := EXTRACT(YEAR FROM v_today)::int - 1;
  END IF;
  v_end_year := v_start_year + 1;

  RETURN lpad((v_start_year % 100)::text, 2, '0') || lpad((v_end_year % 100)::text, 2, '0');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_invoice_delivery_summary(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric := 0;
  v_delivered numeric := 0;
  v_dn_count int := 0;
  v_lines jsonb;
BEGIN
  SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(COALESCE(quantity_delivered,0)),0)
    INTO v_total, v_delivered
    FROM public.invoice_lines WHERE invoice_id = p_invoice_id;

  SELECT COUNT(*) INTO v_dn_count FROM public.delivery_notes WHERE invoice_id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'line_id', il.id,
    'product_id', il.product_id,
    'product', COALESCE(il.description, 'Item'),
    'qty_invoiced', il.quantity,
    'qty_delivered', COALESCE(il.quantity_delivered,0),
    'qty_remaining', GREATEST(il.quantity - COALESCE(il.quantity_delivered,0), 0),
    'fully_delivered', COALESCE(il.quantity_delivered,0) >= il.quantity,
    'serial_numbers_delivered', COALESCE((
      SELECT jsonb_agg(s) FROM public.delivery_note_lines dnl,
             LATERAL jsonb_array_elements_text(dnl.serial_numbers) s
       WHERE dnl.invoice_line_id = il.id
    ), '[]'::jsonb)
  ) ORDER BY il.created_at), '[]'::jsonb)
  INTO v_lines
  FROM public.invoice_lines il WHERE il.invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'total_invoiced_qty', v_total,
    'total_delivered_qty', v_delivered,
    'balance_to_deliver', GREATEST(v_total - v_delivered, 0),
    'dn_count', v_dn_count,
    'line_summary', v_lines
  );
END $function$
;

CREATE OR REPLACE FUNCTION public.gr_fill_default_locations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_src uuid;
  v_dst uuid;
BEGIN
  -- Nothing to derive from.
  IF NEW.operation_type_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Both already supplied by the caller: nothing to do.
  IF NEW.source_location_id IS NOT NULL AND NEW.dest_location_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT default_source_location_id, default_dest_location_id
    INTO v_src, v_dst
    FROM public.operation_types
   WHERE id = NEW.operation_type_id;

  -- Operation type not found (FK is ON DELETE SET NULL, so this is possible in
  -- a race): leave the row exactly as supplied rather than guessing.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Caller-supplied values win; NULL means derive from the operation type.
  NEW.source_location_id := COALESCE(NEW.source_location_id, v_src);
  NEW.dest_location_id   := COALESCE(NEW.dest_location_id,   v_dst);

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.initialize_stock_count(p_count_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count record;
BEGIN
  IF NOT (public.is_admin() OR public.can_write_inventory()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_count FROM public.stock_counts WHERE id = p_count_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock count not found'; END IF;

  INSERT INTO public.stock_count_items(stock_count_id, serial_id, product_id, expected_status, actual_status)
  SELECT p_count_id, s.id, s.product_id, s.stock_status, NULL
    FROM public.goods_receipt_serials s
   WHERE s.stock_status IN ('available','reserved')
     AND NOT EXISTS (SELECT 1 FROM public.stock_count_items i
                      WHERE i.stock_count_id = p_count_id AND i.serial_id = s.id);

  UPDATE public.stock_counts SET status = 'in_progress', started_at = now(), updated_at = now()
   WHERE id = p_count_id AND status = 'draft';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.inv_approve_adjustment(_adjustment_id uuid, _approved_by text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_line record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve adjustments';
  END IF;

  SELECT status INTO v_status
  FROM public.inventory_adjustments WHERE id = _adjustment_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Adjustment % not found', _adjustment_id;
  END IF;
  IF v_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Adjustment % is in status % and cannot be approved', _adjustment_id, v_status;
  END IF;

  FOR v_line IN
    SELECT product_id, difference FROM public.adjustment_lines WHERE adjustment_id = _adjustment_id
  LOOP
    IF v_line.difference <> 0 THEN
      UPDATE public.products
      SET stock_on_hand = stock_on_hand + v_line.difference,
          updated_at = now()
      WHERE id = v_line.product_id;
    END IF;
  END LOOP;

  UPDATE public.inventory_adjustments
  SET status = 'done',
      approved_by = _approved_by,
      approved_at = now(),
      updated_at = now()
  WHERE id = _adjustment_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.inv_delete_stock_move(_move_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.stock_move_lines WHERE stock_move_id = _move_id;
  DELETE FROM public.stock_moves WHERE id = _move_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.inv_save_stock_move(_move_id uuid, _header jsonb, _lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := _move_id;
  v_line jsonb;
BEGIN
  IF v_id IS NULL THEN
    INSERT INTO public.stock_moves (
      reference, operation_type, source_location_id, source_location_name,
      destination_location_id, destination_location_name, scheduled_date, state,
      source_document, reference_document_type, reference_document_id, created_by
    ) VALUES (
      _header->>'reference', _header->>'operation_type',
      (_header->>'source_location_id')::uuid, _header->>'source_location_name',
      (_header->>'destination_location_id')::uuid, _header->>'destination_location_name',
      COALESCE((_header->>'scheduled_date')::timestamptz, now()),
      COALESCE(_header->>'state','draft'),
      _header->>'source_document',
      _header->>'reference_document_type',
      NULLIF(_header->>'reference_document_id','')::uuid,
      v_uid
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.stock_moves
       SET reference = COALESCE(_header->>'reference', reference),
           operation_type = COALESCE(_header->>'operation_type', operation_type),
           source_location_id = COALESCE((_header->>'source_location_id')::uuid, source_location_id),
           source_location_name = COALESCE(_header->>'source_location_name', source_location_name),
           destination_location_id = COALESCE((_header->>'destination_location_id')::uuid, destination_location_id),
           destination_location_name = COALESCE(_header->>'destination_location_name', destination_location_name),
           scheduled_date = COALESCE((_header->>'scheduled_date')::timestamptz, scheduled_date),
           state = COALESCE(_header->>'state', state),
           source_document = COALESCE(_header->>'source_document', source_document),
           reference_document_type = COALESCE(_header->>'reference_document_type', reference_document_type),
           updated_at = now()
     WHERE id = v_id;
    DELETE FROM public.stock_move_lines WHERE stock_move_id = v_id;
  END IF;

  IF _lines IS NOT NULL AND jsonb_typeof(_lines) = 'array' THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
      INSERT INTO public.stock_move_lines (
        stock_move_id, product_id, product_name, product_sku,
        demand_qty, reserved_qty, done_qty, unit_of_measure,
        lot_id, lot_name, serial_numbers,
        source_location_id, destination_location_id
      ) VALUES (
        v_id,
        NULLIF(v_line->>'product_id','')::uuid,
        v_line->>'product_name', v_line->>'product_sku',
        COALESCE((v_line->>'demand_qty')::numeric,0),
        COALESCE((v_line->>'reserved_qty')::numeric,0),
        COALESCE((v_line->>'done_qty')::numeric,0),
        COALESCE(v_line->>'unit_of_measure','Unit'),
        NULLIF(v_line->>'lot_id','')::uuid,
        v_line->>'lot_name',
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_line->'serial_numbers','[]'::jsonb))), ARRAY[]::text[]),
        NULLIF(v_line->>'source_location_id','')::uuid,
        NULLIF(v_line->>'destination_location_id','')::uuid
      );
    END LOOP;
  END IF;

  RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.inv_validate_stock_move(_move_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_state text;
  v_op text;
  v_line record;
  v_sign int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can validate stock moves';
  END IF;

  SELECT state, operation_type INTO v_state, v_op
  FROM public.stock_moves WHERE id = _move_id FOR UPDATE;

  IF v_state IS NULL THEN
    RAISE EXCEPTION 'Stock move % not found', _move_id;
  END IF;
  IF v_state NOT IN ('confirmed','assigned') THEN
    RAISE EXCEPTION 'Stock move % is in state % and cannot be validated', _move_id, v_state;
  END IF;

  v_sign := CASE WHEN v_op = 'receipt' THEN 1
                 WHEN v_op IN ('delivery','return') THEN -1
                 ELSE 0 END;

  FOR v_line IN
    SELECT product_id, done_qty FROM public.stock_move_lines WHERE stock_move_id = _move_id
  LOOP
    IF v_sign <> 0 AND v_line.done_qty <> 0 THEN
      UPDATE public.products
      SET stock_on_hand = stock_on_hand + (v_sign * v_line.done_qty),
          updated_at = now()
      WHERE id = v_line.product_id;
    END IF;
  END LOOP;

  UPDATE public.stock_moves
  SET state = 'done', effective_date = now(), updated_at = now()
  WHERE id = _move_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_count_required_this_month(p_year integer, p_month integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.stock_counts
    WHERE count_period_year = p_year
      AND count_period_month = p_month
      AND status IN ('completed','reconciled','skipped','in_progress')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_factory_user_for(p_factory_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.factory_user_assignments
    WHERE user_id = auth.uid() AND factory_id = p_factory_id AND is_active = true
  );
$function$
;

CREATE OR REPLACE FUNCTION public.ito_after_line_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ito_id uuid := NEW.internal_transfer_order_id;
  v_so_id uuid;
  v_total int;
  v_done int;
  v_new_ito_status text;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE line_status='completed')
    INTO v_total, v_done
    FROM public.internal_transfer_order_lines
    WHERE internal_transfer_order_id = v_ito_id;

  IF v_total > 0 AND v_done = v_total THEN
    v_new_ito_status := 'completed';
  ELSIF v_done > 0 THEN
    v_new_ito_status := 'partial';
  ELSE
    v_new_ito_status := 'confirmed';
  END IF;

  UPDATE public.internal_transfer_orders
     SET status = v_new_ito_status, updated_at = now()
   WHERE id = v_ito_id
   RETURNING sales_order_id INTO v_so_id;

  IF v_so_id IS NOT NULL AND public.check_so_ready_to_invoice(v_so_id) THEN
    UPDATE public.sales_orders SET status='ready_to_invoice', updated_at=now()
     WHERE id = v_so_id AND status IN ('fulfilling','confirmed');
  END IF;

  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.prevent_stock_move_line_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  parent_state text;
  parent_id uuid;
BEGIN
  parent_id := COALESCE(OLD.stock_move_id, NEW.stock_move_id);
  SELECT state INTO parent_state FROM public.stock_moves WHERE id = parent_id;

  IF TG_OP = 'DELETE' THEN
    IF parent_state IN ('done','validated') THEN
      RAISE EXCEPTION 'stock_move_lines for move % (state %) cannot be deleted (ledger is permanent)', parent_id, parent_state;
    END IF;
    RETURN OLD;
  ELSE
    IF parent_state IN ('done','validated') THEN
      RAISE EXCEPTION 'stock_move_lines for move % (state %) cannot be updated (ledger is permanent)', parent_id, parent_state;
    END IF;
    RETURN NEW;
  END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.prevent_stock_move_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state IN ('done','validated') THEN
      RAISE EXCEPTION 'stock_moves row % is % and cannot be deleted (ledger is permanent)', OLD.id, OLD.state;
    END IF;
    RETURN OLD;
  ELSE
    -- UPDATE
    IF OLD.state IN ('done','validated') THEN
      RAISE EXCEPTION 'stock_moves row % is % and cannot be updated (ledger is permanent)', OLD.id, OLD.state;
    END IF;
    RETURN NEW;
  END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.preview_next_document_number(p_document_type text, p_operation_type_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fy      text;
  v_padding integer;
  v_sep     text;
  v_next    integer;
  v_prefix  text;
  v_ot      public.operation_types%ROWTYPE;
BEGIN
  v_fy := public.get_current_fy_label();

  SELECT sequential_padding, prefix_separator INTO v_padding, v_sep
    FROM public.numbering_settings LIMIT 1;
  IF v_padding IS NULL THEN v_padding := 4; END IF;
  IF v_sep IS NULL THEN v_sep := '-'; END IF;

  IF p_operation_type_id IS NOT NULL THEN
    SELECT * INTO v_ot FROM public.operation_types WHERE id = p_operation_type_id;

    IF FOUND AND v_ot.owns_sequence AND v_ot.sequence_prefix IS NOT NULL THEN
      v_padding := COALESCE(v_ot.sequence_padding, v_padding);
      v_sep     := COALESCE(v_ot.sequence_separator, v_sep);

      IF v_ot.sequence_fy_label IS DISTINCT FROM v_fy THEN
        v_next := 1;
      ELSE
        v_next := v_ot.sequence_current_number + 1;
      END IF;

      RETURN v_ot.sequence_prefix || v_sep || v_fy || v_sep
             || lpad(v_next::text, v_padding, '0');
    END IF;
  END IF;

  SELECT COALESCE(last_number, 0) + 1 INTO v_next
  FROM public.numbering_sequences
  WHERE document_type = p_document_type AND fy_label = v_fy;
  IF v_next IS NULL THEN v_next := 1; END IF;

  v_prefix := CASE lower(p_document_type)
    WHEN 'sales_order' THEN 'SO' WHEN 'quotation' THEN 'QT' WHEN 'invoice' THEN 'INV'
    WHEN 'delivery_note' THEN 'DN' WHEN 'internal_transfer' THEN 'ITO' WHEN 'internal_movement' THEN 'IM'
    WHEN 'vendor_order' THEN 'VO' WHEN 'work_order' THEN 'WO' WHEN 'return_request' THEN 'RT'
    WHEN 'credit_note' THEN 'CN' WHEN 'goods_receipt' THEN 'GR' WHEN 'payment_receipt' THEN 'PR'
    WHEN 'correction_order' THEN 'CO' WHEN 'stock_count' THEN 'SC' WHEN 'write_off' THEN 'WF'
    WHEN 'refund' THEN 'RF' WHEN 'exchange' THEN 'EX'
    ELSE upper(p_document_type) END;

  RETURN v_prefix || v_sep || v_fy || v_sep || lpad(v_next::text, v_padding, '0');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_exchange_resolution(p_item_id uuid, p_replacement_product_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.return_request_items%ROWTYPE;
  v_rt public.return_requests%ROWTYPE;
  v_replacement_price numeric;
  v_exch_id uuid;
BEGIN
  SELECT * INTO v_item FROM public.return_request_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'Return item % not found', p_item_id; END IF;
  IF v_item.resolution_status = 'completed' THEN RAISE EXCEPTION 'Item already resolved'; END IF;

  SELECT * INTO v_rt FROM public.return_requests WHERE id = v_item.return_request_id;
  IF v_rt.id IS NULL THEN RAISE EXCEPTION 'Return request not found'; END IF;

  SELECT COALESCE(sale_price, list_price, 0) INTO v_replacement_price
    FROM public.products WHERE id = p_replacement_product_id;
  IF v_replacement_price IS NULL THEN RAISE EXCEPTION 'Replacement product not found'; END IF;
  IF v_replacement_price < v_item.original_unit_price THEN
    RAISE EXCEPTION 'Replacement price (₹%) must be >= original price (₹%)',
      v_replacement_price, v_item.original_unit_price;
  END IF;

  INSERT INTO public.exchanges (
    exchange_number, source_return_request_id, source_invoice_id, return_request_item_id,
    customer_id, original_serial_id, replacement_product_id,
    original_unit_price, replacement_unit_price, status, processed_by
  ) VALUES (
    '', v_rt.id, v_rt.source_invoice_id, v_item.id,
    v_rt.customer_id, v_item.goods_receipt_serial_id, p_replacement_product_id,
    v_item.original_unit_price, v_replacement_price, 'pending', auth.uid()
  ) RETURNING id INTO v_exch_id;

  UPDATE public.return_request_items
     SET resolution_type = 'exchange', resolution_status = 'in_progress', updated_at = now()
   WHERE id = p_item_id;

  RETURN v_exch_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.reconcile_stock_count(p_count_id uuid, p_item_reconciliations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec jsonb;
  v_item_id uuid;
  v_action text;
  v_serial uuid;
  v_processed int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admins can reconcile stock counts';
  END IF;

  IF jsonb_typeof(p_item_reconciliations) <> 'array' THEN
    RAISE EXCEPTION 'p_item_reconciliations must be a JSON array';
  END IF;

  FOR v_rec IN SELECT value FROM jsonb_array_elements(p_item_reconciliations)
  LOOP
    v_item_id := (v_rec->>'item_id')::uuid;
    v_action := v_rec->>'action';

    SELECT goods_receipt_serial_id INTO v_serial
      FROM public.stock_count_items WHERE id = v_item_id AND stock_count_id = p_count_id;
    IF v_serial IS NULL THEN CONTINUE; END IF;

    IF v_action = 'mark_lost' OR v_action = 'write_off' THEN
      UPDATE public.goods_receipt_serials
         SET stock_status = 'written_off', updated_at = now()
       WHERE id = v_serial;
      UPDATE public.stock_count_items
         SET count_status = 'reconciled',
             discrepancy_notes = COALESCE(discrepancy_notes,'') || ' [' || v_action || ']',
             updated_at = now()
       WHERE id = v_item_id;
    ELSIF v_action = 'found_late' THEN
      UPDATE public.stock_count_items
         SET count_status = 'found', scanned_at = COALESCE(scanned_at, now()), scanned_by = COALESCE(scanned_by, auth.uid()), updated_at = now()
       WHERE id = v_item_id;
    ELSIF v_action = 'ignore' THEN
      UPDATE public.stock_count_items
         SET count_status = 'reconciled',
             discrepancy_notes = COALESCE(discrepancy_notes,'') || ' [ignored]',
             updated_at = now()
       WHERE id = v_item_id;
    END IF;
    v_processed := v_processed + 1;
  END LOOP;

  UPDATE public.stock_counts
     SET status = 'reconciled', reconciled_by = auth.uid(), reconciled_at = now(), updated_at = now()
   WHERE id = p_count_id;

  RETURN jsonb_build_object('processed', v_processed);
END $function$
;

CREATE OR REPLACE FUNCTION public.record_gr_item_qc(_serial_id uuid, _passed boolean, _notes text DEFAULT NULL::text, _images jsonb DEFAULT '[]'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ser public.goods_receipt_serials%ROWTYPE;
  v_gr public.goods_receipts%ROWTYPE;
  v_wh_id uuid;
  v_loc_id uuid;
  v_loc_name text;
  v_vendor_loc_id uuid;
  v_vendor_loc_name text;
  v_product_name text;
  v_product_sku text;
  v_move_id uuid;
  v_ref text;
BEGIN
  SELECT * INTO v_ser FROM public.goods_receipt_serials WHERE id = _serial_id FOR UPDATE;
  IF v_ser.id IS NULL THEN RAISE EXCEPTION 'Serial % not found', _serial_id; END IF;

  SELECT * INTO v_gr FROM public.goods_receipts WHERE id = v_ser.goods_receipt_id;
  v_wh_id := COALESCE(v_ser.current_warehouse_id, v_gr.warehouse_id);

  -- ---- destination: document -> operation type -> warehouse default ----
  v_loc_id := v_gr.dest_location_id;

  IF v_loc_id IS NULL AND v_gr.operation_type_id IS NOT NULL THEN
    SELECT default_dest_location_id INTO v_loc_id
      FROM public.operation_types WHERE id = v_gr.operation_type_id;
  END IF;

  IF v_loc_id IS NULL AND v_wh_id IS NOT NULL THEN
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

  -- ---- source: document -> operation type -> VDR106 ----
  v_vendor_loc_id := v_gr.source_location_id;

  IF v_vendor_loc_id IS NULL AND v_gr.operation_type_id IS NOT NULL THEN
    SELECT default_source_location_id INTO v_vendor_loc_id
      FROM public.operation_types WHERE id = v_gr.operation_type_id;
  END IF;

  IF v_vendor_loc_id IS NULL THEN
    SELECT id INTO v_vendor_loc_id
      FROM public.warehouse_locations WHERE code = 'VDR106' LIMIT 1;
  END IF;

  SELECT name INTO v_loc_name        FROM public.warehouse_locations WHERE id = v_loc_id;
  SELECT name INTO v_vendor_loc_name FROM public.warehouse_locations WHERE id = v_vendor_loc_id;

  -- ---- Rule 5: fail loudly BEFORE writing anything ----
  IF _passed AND v_loc_id IS NULL THEN
    RAISE EXCEPTION
      'Cannot record QC pass for goods receipt %: no destination location could be resolved. Set a destination on the receipt, a default destination on its operation type, or a default receipt location on its warehouse.',
      COALESCE(v_gr.gr_number, v_gr.id::text)
      USING ERRCODE = 'check_violation';
  END IF;

  IF _passed AND v_vendor_loc_id IS NULL THEN
    RAISE EXCEPTION
      'Cannot record QC pass for goods receipt %: no source location could be resolved. Set a source on the receipt, a default source on its operation type, or create the VDR106 vendor location.',
      COALESCE(v_gr.gr_number, v_gr.id::text)
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.goods_receipt_serials
     SET qc_status = CASE WHEN _passed THEN 'passed' ELSE 'failed' END,
         qc_notes = _notes,
         qc_images = _images,
         qc_checked_by = v_uid,
         qc_checked_at = now(),
         stock_status = CASE WHEN _passed THEN 'available' ELSE 'under_correction' END,
         current_warehouse_id = CASE WHEN _passed THEN COALESCE(v_wh_id, current_warehouse_id) ELSE current_warehouse_id END,
         current_location = CASE WHEN _passed THEN COALESCE(v_loc_id::text, current_location) ELSE current_location END,
         updated_at = now()
   WHERE id = _serial_id;

  IF _passed THEN
    SELECT name, sku INTO v_product_name, v_product_sku FROM public.products WHERE id = v_ser.product_id;
    v_ref := 'GRQC/' || substr(_serial_id::text, 1, 8);
    INSERT INTO public.stock_moves (
      reference, operation_type, source_location_id, source_location_name,
      destination_location_id, destination_location_name, scheduled_date, state,
      source_document, reference_document_type, reference_document_id, created_by
    ) VALUES (
      v_ref, 'receipt', v_vendor_loc_id, v_vendor_loc_name,
      v_loc_id, v_loc_name,
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
END $function$
;

CREATE OR REPLACE FUNCTION public.record_scan(p_queue_id uuid, p_barcode text, p_serial text DEFAULT NULL::text, p_product_id uuid DEFAULT NULL::uuid, p_expected text[] DEFAULT NULL::text[], p_already_scanned text[] DEFAULT NULL::text[])
 RETURNS scan_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code TEXT := btrim(coalesce(p_barcode, ''));
  v_result TEXT := 'valid';
  v_rec public.scan_records;
  v_queue public.scan_queue;
BEGIN
  SELECT * INTO v_queue FROM public.scan_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scan_queue % not found', p_queue_id;
  END IF;
  IF v_queue.scan_status = 'completed' THEN
    RAISE EXCEPTION 'scan queue already completed';
  END IF;

  IF v_code = '' THEN
    v_result := 'invalid';
  ELSIF p_already_scanned IS NOT NULL AND v_code = ANY(p_already_scanned) THEN
    v_result := 'duplicate';
  ELSIF EXISTS (SELECT 1 FROM public.scan_records WHERE scan_queue_id = p_queue_id AND barcode = v_code AND scan_result = 'valid') THEN
    v_result := 'duplicate';
  ELSIF p_expected IS NOT NULL AND array_length(p_expected, 1) > 0 AND NOT (v_code = ANY(p_expected)) THEN
    v_result := 'not_expected';
  END IF;

  INSERT INTO public.scan_records (scan_queue_id, barcode, serial_number, product_id, scanned_by, scan_result)
  VALUES (p_queue_id, v_code, p_serial, p_product_id, auth.uid(), v_result)
  RETURNING * INTO v_rec;

  IF v_result = 'valid' THEN
    UPDATE public.scan_queue
    SET scanned_items_count = scanned_items_count + 1,
        scan_status = CASE WHEN scan_status = 'pending' THEN 'in_progress' ELSE scan_status END,
        updated_at = now()
    WHERE id = p_queue_id;
  END IF;

  RETURN v_rec;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.release_reservations(_document_type text, _document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.reserve_quantity(_so_id uuid, _order_line_id uuid, _product_id uuid, _quantity numeric, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;
  INSERT INTO public.stock_reservations (
    sales_order_id, order_line_id, product_id,
    quantity, status, reserved_by, notes
  ) VALUES (
    _so_id, _order_line_id, _product_id,
    _quantity, 'reserved', v_uid, _notes
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.reserve_serials(_so_id uuid, _order_line_id uuid, _product_id uuid, _serial_ids uuid[], _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    SELECT id, product_id, stock_status, reserved_for_so_id, serial_number,
           current_warehouse_id, current_location
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
    IF v_ser.current_warehouse_id IS NULL OR v_ser.current_location IS NULL
       OR v_ser.current_location = '' THEN
      RAISE EXCEPTION 'Serial % has no location — receive or correct it first before reserving', v_ser.serial_number;
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
END $function$
;

CREATE OR REPLACE FUNCTION public.save_serial_number(_id uuid, _product_id uuid, _name text, _status text, _lot_id uuid DEFAULT NULL::uuid, _location_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid := _id;
BEGIN
  IF v_id IS NULL THEN
    INSERT INTO public.serial_numbers (product_id, name, status, lot_id, location_id)
    VALUES (_product_id, _name, COALESCE(_status,'available'), _lot_id, _location_id)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.serial_numbers
       SET product_id = COALESCE(_product_id, product_id),
           name = COALESCE(_name, name),
           status = COALESCE(_status, status),
           lot_id = _lot_id,
           location_id = _location_id,
           updated_at = now()
     WHERE id = v_id;
  END IF;
  RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.scan_record_update_ito_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc_type text;
  v_doc_id uuid;
  v_line_id uuid;
  v_so_id uuid;
  v_serial_id uuid;
  v_imi RECORD;
  v_sci RECORD;
  v_serial RECORD;
BEGIN
  IF NEW.scan_result <> 'valid' THEN RETURN NEW; END IF;
  SELECT document_type, document_id INTO v_doc_type, v_doc_id
    FROM public.scan_queue WHERE id = NEW.scan_queue_id;
  IF v_doc_id IS NULL THEN RETURN NEW; END IF;

  IF v_doc_type = 'internal_transfer' THEN
    SELECT id INTO v_line_id
      FROM public.internal_transfer_order_lines
     WHERE internal_transfer_order_id = v_doc_id
       AND (NEW.product_id IS NULL OR product_id = NEW.product_id)
       AND line_status <> 'completed'
     ORDER BY (line_status='blocked') ASC, created_at ASC
     LIMIT 1;
    IF v_line_id IS NOT NULL THEN
      UPDATE public.internal_transfer_order_lines
         SET quantity_scanned = quantity_scanned + 1, updated_at = now()
       WHERE id = v_line_id;
    END IF;
    SELECT sales_order_id INTO v_so_id FROM public.internal_transfer_orders WHERE id = v_doc_id;
    IF v_so_id IS NOT NULL AND NEW.barcode_value IS NOT NULL THEN
      SELECT id INTO v_serial_id FROM public.goods_receipt_serials
       WHERE barcode_value = NEW.barcode_value OR serial_number = NEW.barcode_value LIMIT 1;
      IF v_serial_id IS NOT NULL THEN
        UPDATE public.goods_receipt_serials
           SET stock_status = 'reserved', reserved_for_so_id = v_so_id, updated_at = now()
         WHERE id = v_serial_id AND stock_status = 'available';
      END IF;
    END IF;
  ELSIF v_doc_type = 'internal_movement' THEN
    SELECT * INTO v_imi FROM public.internal_movement_items
     WHERE internal_movement_id = v_doc_id
       AND (serial_number = NEW.barcode_value OR serial_number = NEW.serial_number
            OR EXISTS (SELECT 1 FROM public.goods_receipt_serials s
                        WHERE s.id = internal_movement_items.goods_receipt_serial_id
                          AND (s.barcode_value = NEW.barcode_value OR s.serial_number = NEW.barcode_value)))
     ORDER BY scanned_at_source ASC, created_at ASC
     LIMIT 1;
    IF v_imi.id IS NOT NULL THEN
      IF v_imi.scanned_at_source = false THEN
        UPDATE public.internal_movement_items SET scanned_at_source = true, updated_at = now() WHERE id = v_imi.id;
        UPDATE public.internal_movements SET status = 'in_progress', updated_at = now() WHERE id = v_doc_id AND status = 'draft';
      ELSIF v_imi.scanned_at_destination = false THEN
        UPDATE public.internal_movement_items SET scanned_at_destination = true, updated_at = now() WHERE id = v_imi.id;
      END IF;
    END IF;
  ELSIF v_doc_type = 'stock_count' THEN
    -- find serial by barcode/serial_number
    SELECT s.* INTO v_serial FROM public.goods_receipt_serials s
     WHERE s.barcode_value = NEW.barcode_value OR s.serial_number = NEW.barcode_value OR s.serial_number = NEW.serial_number
     LIMIT 1;
    IF v_serial.id IS NOT NULL THEN
      SELECT * INTO v_sci FROM public.stock_count_items
       WHERE stock_count_id = v_doc_id AND goods_receipt_serial_id = v_serial.id LIMIT 1;
      IF v_sci.id IS NOT NULL THEN
        UPDATE public.stock_count_items
           SET count_status = 'found',
               scanned_at = now(),
               scanned_by = auth.uid(),
               found_location_type = v_serial.stock_status,
               updated_at = now()
         WHERE id = v_sci.id;
      ELSE
        INSERT INTO public.stock_count_items (
          stock_count_id, goods_receipt_serial_id, product_id, serial_number,
          expected_location_type, count_status, scanned_at, scanned_by, found_location_type
        ) VALUES (
          v_doc_id, v_serial.id, v_serial.product_id, v_serial.serial_number,
          NULL, 'unexpected_found', now(), auth.uid(), v_serial.stock_status
        ) ON CONFLICT (stock_count_id, goods_receipt_serial_id) DO NOTHING;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.start_polishing(p_wo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stage text;
  v_bom_count int;
  v_uid uuid := auth.uid();
  v_entry record;
  v_insufficient text := '';
BEGIN
  IF NOT public.is_assigned_or_admin(p_wo_id) THEN
    RAISE EXCEPTION 'Not authorized for work order %', p_wo_id;
  END IF;
  SELECT current_stage INTO v_stage FROM public.work_orders WHERE id = p_wo_id FOR UPDATE;
  IF v_stage <> 'work_start' THEN
    RAISE EXCEPTION 'Can only start polishing from work_start, current: %', v_stage;
  END IF;
  SELECT COUNT(*) INTO v_bom_count FROM public.work_order_bom_entries WHERE work_order_id = p_wo_id;
  IF v_bom_count = 0 THEN RAISE EXCEPTION 'BOM has not been entered yet'; END IF;

  -- Validate stock
  FOR v_entry IN
    SELECT b.id, b.factory_inventory_item_id, b.quantity_required, i.name, i.current_stock
      FROM public.work_order_bom_entries b
      JOIN public.factory_inventory_items i ON i.id = b.factory_inventory_item_id
     WHERE b.work_order_id = p_wo_id
  LOOP
    IF v_entry.current_stock < v_entry.quantity_required THEN
      v_insufficient := v_insufficient || v_entry.name || ' (need '
        || v_entry.quantity_required || ', have ' || v_entry.current_stock || '); ';
    END IF;
  END LOOP;
  IF v_insufficient <> '' THEN
    RAISE EXCEPTION 'Insufficient stock: %', v_insufficient;
  END IF;

  -- Consume
  FOR v_entry IN
    SELECT b.id, b.factory_inventory_item_id, b.quantity_required
      FROM public.work_order_bom_entries b
     WHERE b.work_order_id = p_wo_id
  LOOP
    INSERT INTO public.factory_stock_movements (
      factory_inventory_item_id, movement_type, quantity, related_work_order_id, recorded_by, notes
    ) VALUES (
      v_entry.factory_inventory_item_id, 'consumed', -v_entry.quantity_required,
      p_wo_id, v_uid, 'Consumed via start_polishing'
    );
    UPDATE public.factory_inventory_items
       SET current_stock = current_stock - v_entry.quantity_required, updated_at = now()
     WHERE id = v_entry.factory_inventory_item_id;
    UPDATE public.work_order_bom_entries
       SET quantity_consumed = v_entry.quantity_required, updated_at = now()
     WHERE id = v_entry.id;
  END LOOP;

  UPDATE public.work_orders
     SET current_stage = 'polishing', materials_consumed_at = now(), updated_at = now()
   WHERE id = p_wo_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.update_serial_status(_serial_id uuid, _status text, _location_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.serial_numbers
     SET status = _status,
         location_id = COALESCE(_location_id, location_id),
         updated_at = now()
   WHERE id = _serial_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.validate_return_eligibility(p_serial_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_serial public.goods_receipt_serials%ROWTYPE;
  v_dnl public.delivery_note_lines%ROWTYPE;
  v_invoice_id uuid;
  v_invoice_line public.invoice_lines%ROWTYPE;
  v_so_line public.order_lines%ROWTYPE;
  v_delivered_at timestamptz;
  v_has_custom boolean := false;
BEGIN
  SELECT * INTO v_serial FROM public.goods_receipt_serials WHERE id = p_serial_id;
  IF v_serial.id IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'Serial not found');
  END IF;
  IF v_serial.stock_status <> 'sold' THEN
    RETURN jsonb_build_object('eligible', false, 'reason',
      'Item is not in sold status (current: ' || v_serial.stock_status || ')');
  END IF;

  -- Find the delivery note line that delivered this serial
  SELECT dnl.* INTO v_dnl
  FROM public.delivery_note_lines dnl
  WHERE dnl.serial_numbers ? v_serial.serial_number
  ORDER BY dnl.created_at DESC
  LIMIT 1;

  IF v_dnl.id IS NOT NULL THEN
    SELECT delivered_at INTO v_delivered_at
      FROM public.delivery_notes WHERE id = v_dnl.delivery_note_id;
  END IF;

  -- Try to find related invoice line (via DN line if available, else through SO product match)
  IF v_dnl.invoice_line_id IS NOT NULL THEN
    SELECT * INTO v_invoice_line FROM public.invoice_lines WHERE id = v_dnl.invoice_line_id;
    v_invoice_id := v_invoice_line.invoice_id;
  END IF;

  -- Detect customization from SO line if available
  IF v_invoice_line.sales_order_line_id IS NOT NULL THEN
    SELECT * INTO v_so_line FROM public.order_lines WHERE id = v_invoice_line.sales_order_line_id;
    v_has_custom := COALESCE(
      NULLIF(v_so_line.customization_size, '') IS NOT NULL
      OR NULLIF(v_so_line.customization_colour, '') IS NOT NULL
      OR NULLIF(v_so_line.customization_fabric, '') IS NOT NULL
      OR NULLIF(v_so_line.customization_polish, '') IS NOT NULL
      OR NULLIF(v_so_line.customization_notes, '') IS NOT NULL,
      false);
  END IF;

  IF v_has_custom THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason', 'Customized products cannot be returned',
      'has_customization', true,
      'original_invoice_id', v_invoice_id,
      'delivered_at', v_delivered_at,
      'days_since_delivery',
        CASE WHEN v_delivered_at IS NOT NULL
             THEN EXTRACT(EPOCH FROM (now() - v_delivered_at))::int / 86400
             ELSE NULL END
    );
  END IF;

  RETURN jsonb_build_object(
    'eligible', true,
    'reason', NULL,
    'has_customization', false,
    'original_invoice_id', v_invoice_id,
    'delivered_at', v_delivered_at,
    'days_since_delivery',
      CASE WHEN v_delivered_at IS NOT NULL
           THEN EXTRACT(EPOCH FROM (now() - v_delivered_at))::int / 86400
           ELSE NULL END
  );
END $function$
;
