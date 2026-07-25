-- Batch 4a: repair complete_internal_movement.
--
-- The deployed version is broken three ways and errors on any movement that
-- has items:
--   * it reads v_item.serial_id, but the column is goods_receipt_serial_id, so
--     the record field access raises at runtime;
--   * its movement_type CASE uses values ('sale','vendor_return','qc_correction',
--     'transfer') that are not in the movement_type CHECK, so every branch fell
--     through to ELSE even before the error;
--   * it never touched current_location, so a completed movement never actually
--     relocated the serial.
--
-- This fixes the column, maps the real movement types, relocates the serial to
-- the destination location when one is set, and writes a stock_moves ledger row
-- per serial for auditability — matching the other completion RPCs.
--
-- Pick-to-transit (added in the next migration) has its own QC-gated completion;
-- this covers the plain movement flavours (rearrangement, location_change,
-- damage_quarantine, return_to_vendor, display_sold, cycle_count_reconciliation).

-- Older definitions returned a different type in places; drop first so the
-- signature is deterministic wherever this replays.
DROP FUNCTION IF EXISTS public.complete_internal_movement(uuid);
CREATE OR REPLACE FUNCTION public.complete_internal_movement(p_movement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_internal_movement(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.complete_internal_movement(uuid) TO authenticated;
