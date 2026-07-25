-- Batch 1: make Goods Receipt QC failures create Correction Orders.
--
-- complete_gr_line_qc sets failed serials to stock_status='rejected'
-- (per the §7.1 state machine), but the auto-CO trigger only fired on
-- 'under_correction' and auto_create_correction_order only selected
-- under_correction serials. So the wizard path produced ZERO correction
-- orders and the CorrectionOrderBanner never rendered. This wires the two
-- together, and along the way fixes three defects the prior version carried.
--
-- Changes:
--   1. auto_create_correction_order — one CO per failed UNIT (§3.4), not one
--      CO per GR with many items; covers both 'rejected' (receipt QC fail) and
--      'under_correction' (damage found later).
--   2. the trigger fires on 'rejected' as well as 'under_correction'.
--   3. complete_gr_line_qc — line quantity accounting is recomputed from the
--      serials (idempotent) instead of incremented, so re-running no longer
--      double-counts, and rejects land in rejected_quantity rather than being
--      mislabelled as under_correction_quantity. The passed-serial ledger
--      insert is guarded so a re-run cannot write duplicate stock_moves.

-- ── 1. One correction order per failed unit ──────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_create_correction_order(p_gr_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
END $$;

-- ── 2. Fire the auto-CO trigger on rejected as well ──────────────────────
-- Same function name, so the existing trigger keeps pointing at it.
CREATE OR REPLACE FUNCTION public.trg_gr_serial_after_under_correction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.qc_status = 'failed'
     AND NEW.stock_status IN ('under_correction', 'rejected')
     AND (OLD.stock_status IS DISTINCT FROM NEW.stock_status) THEN
    PERFORM public.auto_create_correction_order(NEW.goods_receipt_id);
  END IF;
  RETURN NEW;
END $$;

-- ── 3. Idempotent completion + correct line accounting ───────────────────
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

    -- Ledger: one stock_moves row per passed serial (VENDORS -> receipt
    -- location). The NOT EXISTS guard keeps re-runs from writing duplicates.
    IF v_vendor_loc_id IS NOT NULL AND v_loc_id IS NOT NULL THEN
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
    -- Correction orders are raised by trg_gr_serial_after_under_correction,
    -- which now fires on the 'rejected' transition above.
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
END $function$;

-- Backfill: raise correction orders for any already-rejected serials that
-- never got one because the trigger predates this fix.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT goods_receipt_id
      FROM public.goods_receipt_serials
     WHERE qc_status = 'failed'
       AND stock_status IN ('rejected', 'under_correction')
       AND NOT EXISTS (
         SELECT 1 FROM public.correction_order_items i
          WHERE i.goods_receipt_serial_id = goods_receipt_serials.id
       )
  LOOP
    PERFORM public.auto_create_correction_order(r.goods_receipt_id);
  END LOOP;
END $$;
