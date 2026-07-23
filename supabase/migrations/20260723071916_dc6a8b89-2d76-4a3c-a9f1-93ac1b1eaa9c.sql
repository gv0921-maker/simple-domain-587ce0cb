
-- ============================================================
-- Close remaining direct-write paths: RPCs for all ledger writes
-- ============================================================

-- ---------------------------------------------------------
-- 1a. reserve_serials — atomic reservation of GR serials to a SO
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_serials(
  _so_id uuid,
  _order_line_id uuid,
  _product_id uuid,
  _serial_ids uuid[],
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Lock candidate serials, ordered so we get deterministic errors
  FOR v_ser IN
    SELECT id, product_id, stock_status, reserved_for_so_id, serial_number
      FROM public.goods_receipt_serials
     WHERE id = ANY(_serial_ids)
     ORDER BY serial_number
     FOR UPDATE
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
      _so_id, _order_line_id, _product_id, v_ser.id,
      1, 'reserved', v_uid, _notes
    ) RETURNING id INTO v_new_id;

    UPDATE public.goods_receipt_serials
       SET reserved_for_so_id = _so_id,
           stock_status = 'reserved',
           updated_at = now()
     WHERE id = v_ser.id;

    v_created := v_created + 1;
    v_ids := v_ids || v_new_id;
  END LOOP;

  RETURN jsonb_build_object(
    'created', v_created,
    'reservation_ids', to_jsonb(v_ids)
  );
END $$;

-- ---------------------------------------------------------
-- 1b. reserve_quantity — non-serial (bulk qty) reservation
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_quantity(
  _so_id uuid,
  _order_line_id uuid,
  _product_id uuid,
  _quantity numeric,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
END $$;

-- ---------------------------------------------------------
-- 1c. release_reservations — by document (SO / reservation-id)
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_reservations(
  _document_type text,
  _document_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res record;
  v_count int := 0;
BEGIN
  IF _document_type = 'sales_order' THEN
    FOR v_res IN
      SELECT id, serial_number_id
        FROM public.stock_reservations
       WHERE sales_order_id = _document_id
         AND status = 'reserved'
         FOR UPDATE
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
    SELECT id, serial_number_id INTO v_res
      FROM public.stock_reservations
     WHERE id = _document_id
     FOR UPDATE;
    IF v_res.id IS NOT NULL THEN
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
  RETURN jsonb_build_object('released', v_count);
END $$;

-- ---------------------------------------------------------
-- 2. record_gr_item_qc — GR item QC + ledger move VENDORS → receipt loc
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_gr_item_qc(
  _serial_id uuid,
  _passed boolean,
  _notes text DEFAULT NULL,
  _images jsonb DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
       ORDER BY is_default DESC NULLS LAST, created_at ASC LIMIT 1;
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
END $$;

-- ---------------------------------------------------------
-- 3a. inv_save_stock_move — upsert draft stock_moves + lines atomically
--     (permanence trigger already blocks mutation of done/validated moves)
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_save_stock_move(
  _move_id uuid,
  _header jsonb,
  _lines jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
END $$;

-- ---------------------------------------------------------
-- 3b. inv_delete_stock_move — delete a non-validated stock move
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_delete_stock_move(_move_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.stock_move_lines WHERE stock_move_id = _move_id;
  DELETE FROM public.stock_moves WHERE id = _move_id;
END $$;

-- ---------------------------------------------------------
-- 3c. save_serial_number / update_serial_status wrappers
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_serial_number(
  _id uuid,
  _product_id uuid,
  _name text,
  _status text,
  _lot_id uuid DEFAULT NULL,
  _location_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.update_serial_status(
  _serial_id uuid,
  _status text,
  _location_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.serial_numbers
     SET status = _status,
         location_id = COALESCE(_location_id, location_id),
         updated_at = now()
   WHERE id = _serial_id;
END $$;

-- ---------------------------------------------------------
-- 4. approve_write_off — extended to write ledger row to SCRAP / LOSS
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_write_off(p_wf_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Route to SCRAP (physical disposal) vs INVENTORY LOSS (unexplained)
  v_dest_code := CASE v_rec.write_off_type
    WHEN 'damage' THEN 'SCRP113'
    WHEN 'scrap' THEN 'SCRP113'
    WHEN 'obsolete' THEN 'SCRP113'
    WHEN 'qc_unsalvageable' THEN 'SCRP113'
    ELSE 'LOSS112'
  END;
  SELECT id, name INTO v_dest_id, v_dest_name FROM public.warehouse_locations WHERE code = v_dest_code LIMIT 1;

  -- Emit ledger move per item (source = serial's current location, best-effort)
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
        v_ref, 'write_off', v_src_id, v_src_name, v_dest_id, v_dest_name,
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

  -- Also expire any lingering active reservations for these serials
  DELETE FROM public.stock_reservations
   WHERE serial_number_id IN (SELECT goods_receipt_serial_id FROM public.write_off_items WHERE write_off_record_id = p_wf_id);

  UPDATE public.write_off_records
     SET status = 'approved', approved_by = auth.uid(), approved_at = now(),
         total_value = v_total, updated_at = now()
   WHERE id = p_wf_id;

  RETURN jsonb_build_object('success', true, 'total_value', v_total, 'item_count', v_item_count);
END $$;

-- ---------------------------------------------------------
-- 5. adjust_factory_stock — atomic stock adjust + movement row
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_factory_stock(
  _item_id uuid,
  _movement_type text,
  _quantity numeric,
  _notes text DEFAULT NULL,
  _related_work_order_id uuid DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
END $$;

-- ---------------------------------------------------------
-- Grants
-- ---------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.reserve_serials(uuid, uuid, uuid, uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quantity(uuid, uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_reservations(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_gr_item_qc(uuid, boolean, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_save_stock_move(uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_delete_stock_move(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_serial_number(uuid, uuid, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_serial_status(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_factory_stock(uuid, text, numeric, text, uuid) TO authenticated;
