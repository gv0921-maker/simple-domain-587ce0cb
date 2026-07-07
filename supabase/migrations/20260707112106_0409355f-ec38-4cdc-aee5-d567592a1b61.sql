
-- =====================================================================
-- FIX 1: complete_gr_line_qc — stamp passed serials with warehouse + location
-- =====================================================================
CREATE OR REPLACE FUNCTION public.complete_gr_line_qc(
  p_gr_line_id uuid,
  p_passed_serial_ids uuid[],
  p_failed_serial_ids uuid[],
  p_failed_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Resolve destination stock location for the receiving warehouse.
  IF v_wh_id IS NOT NULL THEN
    SELECT default_receipt_location_id INTO v_loc_id
      FROM public.warehouses WHERE id = v_wh_id;
    IF v_loc_id IS NULL THEN
      SELECT id INTO v_loc_id
        FROM public.warehouse_locations
       WHERE warehouse_id = v_wh_id
         AND type = 'internal'
         AND COALESCE(is_active, true) = true
       ORDER BY is_default DESC NULLS LAST, created_at ASC
       LIMIT 1;
    END IF;
  END IF;

  IF p_passed_serial_ids IS NOT NULL AND array_length(p_passed_serial_ids, 1) > 0 THEN
    UPDATE public.goods_receipt_serials
       SET qc_status = 'passed',
           stock_status = 'available',
           current_warehouse_id = COALESCE(v_wh_id, current_warehouse_id),
           current_location = COALESCE(v_loc_id, current_location),
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
  END IF;
END $$;

-- =====================================================================
-- FIX 2: create_ito_from_so — reserve serials FIFO per line
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_ito_from_so(p_so_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ito_id uuid;
  v_number text;
  v_line record;
  v_qty int;
  v_reserved_ids uuid[];
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

  -- Return existing non-cancelled ITO if one already exists
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
     WHERE s.id = picked.id
    RETURNING s.id INTO v_reserved_ids;

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
$$;

REVOKE EXECUTE ON FUNCTION public.create_ito_from_so(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ito_from_so(uuid) TO authenticated;
