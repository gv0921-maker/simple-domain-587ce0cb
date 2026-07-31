-- Goods Receipt QC: route stock to the receipt's own source/destination.
-- Sections 5 and 6 of docs/GR_CREATION_DESIGN.md — the final GR piece.
--
-- TWO PROVEN RPCs ARE MODIFIED. complete_gr_line_qc (batch, per line) and
-- record_gr_item_qc (per serial) both write the receipt ledger, and both
-- currently resolve locations by the same duplicated logic. They MUST end up
-- identical or the same receipt could route stock two different ways depending
-- on which QC path an operator used. The resolution block below is written once
-- and pasted verbatim into both.
--
-- ---------------------------------------------------------------------------
-- SECTION 5 — three-tier resolution
--
-- BEFORE (both functions): the receipt's own dest_location_id was ignored
-- entirely. Destination came only from the warehouse:
--
--     IF v_wh_id IS NOT NULL THEN
--       SELECT default_receipt_location_id INTO v_loc_id
--         FROM public.warehouses WHERE id = v_wh_id;
--       IF v_loc_id IS NULL THEN
--         SELECT id INTO v_loc_id FROM public.warehouse_locations
--          WHERE warehouse_id = v_wh_id AND type = 'internal'
--            AND COALESCE(is_active, true) = true
--          ORDER BY created_at ASC LIMIT 1;
--       END IF;
--     END IF;
--
-- and source was a hardcoded code lookup:
--
--     SELECT id INTO v_vendor_loc_id
--       FROM public.warehouse_locations WHERE code = 'VDR106' LIMIT 1;
--
-- AFTER: document -> operation type -> the old logic, kept verbatim as the
-- final tier. A tagged receipt (RCP/2627/0011, dest STK103) now routes to what
-- it displays. An untagged receipt has NULL at tiers 1 and 2 and falls through
-- to exactly today's behaviour, so nothing that works today stops working.
--
-- Both warehouses currently have every default_*_location_id NULL, so tier 3
-- resolves via its ORDER BY created_at LIMIT 1 branch — unchanged from today.
--
-- Also fixed: the ledger hardcoded the source NAME as the literal 'VENDORS'
-- while writing a variable id. Now that the id can come from the document, a
-- hardcoded name would write a stock_moves row whose source_location_name
-- contradicts its own source_location_id. Both names are looked up.
--
-- ---------------------------------------------------------------------------
-- SECTION 6 — the Rule-5 fix
--
-- BEFORE, in complete_gr_line_qc:
--
--     IF v_vendor_loc_id IS NOT NULL AND v_loc_id IS NOT NULL THEN
--       ... write stock_moves + stock_move_lines ...
--     END IF;
--
-- and the same gate in record_gr_item_qc. If either location failed to resolve,
-- the serials were still flipped to 'available' but NO ledger rows were written
-- and NO error was raised — stock existed with no ledger entry, silently. That
-- is precisely what CLAUDE.md rule 5 forbids, and GR-2627-0001 (operation type
-- set, warehouse NULL) is the live instance.
--
-- AFTER: resolution happens BEFORE anything is written, and an unresolvable
-- location raises with a message naming which side failed and the receipt it
-- belongs to. The RAISE aborts the transaction, so serials are not left flipped
-- against a ledger that was never written — it fails atomically rather than
-- half-applying.
--
-- The guard is conditional on there being work that needs a location: a QC
-- FAILURE writes no ledger, so a failed serial is still recordable on a receipt
-- with no resolvable destination. Only the passing path demands one.
--
-- ---------------------------------------------------------------------------
-- REVERSE / ROLLBACK — restores both functions verbatim.
-- Capture the current definitions first if you want belt and braces:
--   SELECT pg_get_functiondef(oid) FROM pg_proc p JOIN pg_namespace n
--     ON n.oid = p.pronamespace WHERE n.nspname='public'
--    AND proname IN ('complete_gr_line_qc','record_gr_item_qc');
--
-- The pre-migration bodies are preserved in git at commit c236a96 and earlier;
-- the full text is also reproduced in docs/GR_CREATION_DESIGN.md section 1c.
-- Rolling back means re-applying those two CREATE OR REPLACE statements.
-- ---------------------------------------------------------------------------

BEGIN;

-- ===========================================================================
-- complete_gr_line_qc — batch QC for one goods receipt line
-- ===========================================================================
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
END $function$;

-- ===========================================================================
-- record_gr_item_qc — per-serial QC
-- Destination and source resolution below is IDENTICAL to complete_gr_line_qc.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.record_gr_item_qc(
  _serial_id uuid,
  _passed boolean,
  _notes text DEFAULT NULL::text,
  _images jsonb DEFAULT '[]'::jsonb
)
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
END $function$;

COMMIT;

-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFICATION (read-only unless stated)
--
--   -- both functions still single-version, signatures unchanged
--   SELECT proname, pg_get_function_identity_arguments(oid), count(*) OVER (PARTITION BY proname)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND proname IN ('complete_gr_line_qc','record_gr_item_qc');
--   -- expect 2 rows, 1 version each, arguments unchanged from before
--
--   -- both now read the document's locations, and neither hardcodes the name
--   SELECT proname,
--          prosrc ILIKE '%dest_location_id%'   AS reads_doc_dest,
--          prosrc ILIKE '%source_location_id%' AS reads_doc_source,
--          prosrc LIKE  '%''VENDORS''%'        AS hardcodes_vendors_name
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND proname IN ('complete_gr_line_qc','record_gr_item_qc');
--   -- expect true, true, false for both
--
--   -- ledger name/id agreement — must stay empty
--   SELECT m.id, m.source_location_name, l.name
--     FROM public.stock_moves m
--     JOIN public.warehouse_locations l ON l.id = m.source_location_id
--    WHERE m.source_location_name IS DISTINCT FROM l.name;
--
--   -- baseline to diff after the live test (captured 2026-07-31)
--   SELECT count(*) FROM public.stock_moves;               -- 8
--   SELECT count(*) FROM public.stock_move_lines;          -- 8
--   SELECT stock_status, qc_status, current_location, count(*)
--     FROM public.goods_receipt_serials GROUP BY 1,2,3;    -- 16 serials
--
-- LIVE TEST
--   (a) tagged receipt: complete QC on RCP/2627/0011 (dest STK103) ->
--       stock_move_lines.destination_location_id = STK103's id, and the passed
--       serials' current_location = that same id.
--   (b) untagged receipt: complete QC on a receipt with NULL dest and NULL
--       operation type -> still lands wherever tier 3 resolves, exactly as
--       before this migration.
--   (c) no-destination case: a receipt with NULL dest, NULL operation type and
--       NULL warehouse -> QC pass raises the destination error instead of
--       completing silently. GR-2627-0001 is the historical instance of this.
-- ---------------------------------------------------------------------------
