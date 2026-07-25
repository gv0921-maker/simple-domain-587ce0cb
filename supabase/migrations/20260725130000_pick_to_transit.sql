-- Batch 4b: standalone pick-to-transit on internal_movements.
--
-- §4.2: move specific serials to the warehouse's transit location, gated by a
-- QC pass per unit; failed units block completion and go to correction. This
-- is the standalone (no sales order) version of the ITO transit pick — the
-- expected serial pool is the movement's own items, not a reservation.
--
-- Adds the movement type and QC document type, then a completion RPC modelled
-- on complete_ito_with_qc but simpler: the pool is explicit, so there is no
-- reserved_for_so_id resolution.

-- 1) allow the new movement type
ALTER TABLE public.internal_movements DROP CONSTRAINT IF EXISTS internal_movements_movement_type_check;
ALTER TABLE public.internal_movements ADD CONSTRAINT internal_movements_movement_type_check
  CHECK (movement_type = ANY (ARRAY[
    'rearrangement','display_sold','damage_quarantine','return_to_vendor',
    'cycle_count_reconciliation','location_change','pick_to_transit'
  ]::text[]));

-- 2) let the shared QC engine record against a transfer/movement
ALTER TABLE public.qc_inspections DROP CONSTRAINT IF EXISTS qc_inspections_document_type_check;
ALTER TABLE public.qc_inspections ADD CONSTRAINT qc_inspections_document_type_check
  CHECK (document_type = ANY (ARRAY[
    'ito','goods_receipt','delivery_note','return','internal_transfer'
  ]::text[]));

-- 3) QC-gated completion
CREATE OR REPLACE FUNCTION public.complete_pick_to_transit(p_movement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_pick_to_transit(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.complete_pick_to_transit(uuid) TO authenticated;
