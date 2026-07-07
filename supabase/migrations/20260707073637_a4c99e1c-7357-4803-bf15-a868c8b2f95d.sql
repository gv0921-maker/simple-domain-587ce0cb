CREATE OR REPLACE FUNCTION public.create_ito_from_so(p_so_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ito_id uuid;
  v_number text;
  v_so record;
  v_line record;
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

  SELECT * INTO v_so FROM public.sales_orders WHERE id = p_so_id;
  IF NOT FOUND THEN
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

  -- Generate the ITO number (this was missing in the broken version)
  v_number := public.generate_document_number('internal_transfer');

  INSERT INTO public.internal_transfer_orders(
    ito_number, sales_order_id, status, created_by, confirmed_by, confirmed_at
  ) VALUES (
    v_number, p_so_id, 'confirmed', v_user, v_user, now()
  )
  RETURNING id INTO v_ito_id;

  -- Create lines only for stock-fulfilled sources (warehouse/display).
  -- Vendor / factory lines await their own receipt flow.
  FOR v_line IN
    SELECT id, product_id, product_source, quantity
    FROM public.order_lines
    WHERE order_id = p_so_id
      AND COALESCE(product_source, 'warehouse') IN ('warehouse','display')
  LOOP
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
      GREATEST(1, CEIL(COALESCE(v_line.quantity, 0))::integer),
      0,
      'pending'
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