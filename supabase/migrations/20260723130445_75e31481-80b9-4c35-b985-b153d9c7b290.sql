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
$function$;