-- Settle goods_receipt_serials.current_location on a single data type.
--
-- The column is `text` and every writer stores a warehouse_locations UUID cast
-- to text — complete_gr_line_qc, complete_ito_with_qc, complete_delivery_with_qc
-- all use `<uuid>::text`. approve_write_off was the sole outlier, storing the
-- location *name*:
--
--   SET stock_status = 'written_off', current_location = v_dest_name
--
-- Anything resolving that column to a location therefore breaks on written-off
-- serials — including the lookup FulfillmentSection already relies on. This
-- aligns it with the rest and backfills the rows it corrupted.
--
-- Also adds a missing guard: the destination lookup could return NULL (no
-- location with the expected code), and the serial update ran outside the
-- IF v_dest_id IS NOT NULL branch that protects the ledger writes. Silently
-- writing NULL over a serial's location is the kind of phantom data path
-- INVENTORY_PLAN.md §1.3.3 rules out, so it now fails loudly instead.

COMMENT ON COLUMN public.goods_receipt_serials.current_location IS
  'warehouse_locations.id as text. Always a UUID — never a location name.';

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
END $function$;

-- Backfill: rewrite any current_location that is a location NAME rather than a
-- UUID. Scoped by name match so genuinely free-text values are left alone.
UPDATE public.goods_receipt_serials s
   SET current_location = l.id::text,
       updated_at = now()
  FROM public.warehouse_locations l
 WHERE s.current_location IS NOT NULL
   AND s.current_location <> ''
   AND s.current_location !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND s.current_location = l.name;
