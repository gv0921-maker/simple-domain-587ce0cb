CREATE OR REPLACE FUNCTION public.complete_gr_line_qc(
  p_gr_line_id uuid,
  p_passed_serial_ids uuid[],
  p_failed_serial_ids uuid[],
  p_failed_notes text
)
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
  v_loc_id uuid;
  v_loc_name text;
  v_vendor_loc_id uuid;
  v_pass_cnt int := 0;
  v_fail_cnt int := 0;
  v_pending_lines int;
  v_ser record;
  v_move_id uuid;
BEGIN
  SELECT gr.goods_receipt_id, grh.warehouse_id, grh.gr_number
    INTO v_gr_id, v_wh_id, v_gr_number
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

  SELECT name INTO v_loc_name FROM public.warehouse_locations WHERE id = v_loc_id;
  SELECT id INTO v_vendor_loc_id FROM public.warehouse_locations WHERE code = 'VDR106' LIMIT 1;

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

    -- Ledger: one stock_moves row per passed serial (VENDORS -> receipt location)
    IF v_vendor_loc_id IS NOT NULL AND v_loc_id IS NOT NULL THEN
      FOR v_ser IN
        SELECT s.id, s.serial_number, s.product_id,
               p.name  AS product_name,
               p.sku   AS product_sku
          FROM public.goods_receipt_serials s
          LEFT JOIN public.products p ON p.id = s.product_id
         WHERE s.id = ANY(p_passed_serial_ids)
           AND s.goods_receipt_line_id = p_gr_line_id
      LOOP
        INSERT INTO public.stock_moves (
          reference, operation_type, source_location_id, source_location_name,
          destination_location_id, destination_location_name, scheduled_date, state,
          source_document, reference_document_type, reference_document_id, created_by
        ) VALUES (
          'GRQC/' || substr(v_ser.id::text, 1, 8),
          'receipt', v_vendor_loc_id, 'VENDORS',
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
END $function$;

-- Backfill ledger rows for already-completed GRs whose passed serials never
-- got a stock_moves entry (this bug's historical damage).
DO $$
DECLARE
  v_vendor_loc_id uuid;
  r record;
  v_move_id uuid;
  v_loc_name text;
BEGIN
  SELECT id INTO v_vendor_loc_id FROM public.warehouse_locations WHERE code = 'VDR106' LIMIT 1;
  IF v_vendor_loc_id IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT s.id AS serial_id, s.serial_number, s.product_id,
           s.goods_receipt_id, s.current_location::uuid AS loc_id,
           g.gr_number,
           p.name AS product_name, p.sku AS product_sku
      FROM public.goods_receipt_serials s
      JOIN public.goods_receipts g ON g.id = s.goods_receipt_id
      LEFT JOIN public.products p ON p.id = s.product_id
     WHERE s.qc_status = 'passed'
       AND s.stock_status = 'available'
       AND s.current_location IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.stock_move_lines sml
          WHERE s.serial_number = ANY(sml.serial_numbers)
       )
  LOOP
    SELECT name INTO v_loc_name FROM public.warehouse_locations WHERE id = r.loc_id;

    INSERT INTO public.stock_moves (
      reference, operation_type, source_location_id, source_location_name,
      destination_location_id, destination_location_name, scheduled_date, state,
      source_document, reference_document_type, reference_document_id
    ) VALUES (
      'GRQC-BF/' || substr(r.serial_id::text, 1, 8),
      'receipt', v_vendor_loc_id, 'VENDORS',
      r.loc_id, v_loc_name,
      now(), 'done',
      r.gr_number, 'goods_receipt', r.goods_receipt_id
    ) RETURNING id INTO v_move_id;

    INSERT INTO public.stock_move_lines (
      stock_move_id, product_id, product_name, product_sku,
      demand_qty, reserved_qty, done_qty, unit_of_measure,
      source_location_id, destination_location_id, serial_numbers
    ) VALUES (
      v_move_id, r.product_id, r.product_name, r.product_sku,
      1, 1, 1, 'Unit',
      v_vendor_loc_id, r.loc_id, ARRAY[r.serial_number]::text[]
    );
  END LOOP;
END $$;