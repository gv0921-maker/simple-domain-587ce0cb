-- BASELINE — captured from the live database 2026-07-31, immediately before
-- migration 20260731130000_gr_qc_route_to_document_locations.sql.
--
-- Verbatim pg_get_functiondef() output. Run this file to roll the function back
-- to its pre-migration form. The signature is unchanged by that migration, so
-- CREATE OR REPLACE restores in place with no overload risk.
--
-- State at capture: destination resolved from the warehouse only; the receipt's
-- own dest_location_id ignored; source hardcoded to code 'VDR106'; the ledger
-- source name written as the literal 'VENDORS'; the ledger silently skipped when
-- either location was NULL; and the serial's current_location never set on a QC
-- pass, unlike its sibling complete_gr_line_qc.

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
END $function$
