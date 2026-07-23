-- Guard: reserve_serials must refuse serials with no location/warehouse.
CREATE OR REPLACE FUNCTION public.reserve_serials(
  _so_id uuid, _order_line_id uuid, _product_id uuid,
  _serial_ids uuid[], _notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  FOR v_ser IN
    SELECT id, product_id, stock_status, reserved_for_so_id, serial_number,
           current_warehouse_id, current_location
      FROM public.goods_receipt_serials
     WHERE id = ANY(_serial_ids) ORDER BY serial_number FOR UPDATE
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
    IF v_ser.current_warehouse_id IS NULL OR v_ser.current_location IS NULL
       OR v_ser.current_location = '' THEN
      RAISE EXCEPTION 'Serial % has no location — receive or correct it first before reserving', v_ser.serial_number;
    END IF;

    INSERT INTO public.stock_reservations (
      sales_order_id, order_line_id, product_id, serial_number_id,
      quantity, status, reserved_by, notes
    ) VALUES (
      _so_id, _order_line_id, _product_id, v_ser.id, 1, 'reserved', v_uid, _notes
    ) RETURNING id INTO v_new_id;

    UPDATE public.goods_receipt_serials
       SET reserved_for_so_id = _so_id, stock_status = 'reserved', updated_at = now()
     WHERE id = v_ser.id;

    v_created := v_created + 1;
    v_ids := v_ids || v_new_id;
  END LOOP;

  IF v_created > 0 THEN
    PERFORM public.log_activity(
      'sales_order', _so_id, 'status_change',
      v_created || ' serial(s) reserved'
    );
  END IF;

  RETURN jsonb_build_object('created', v_created, 'reservation_ids', to_jsonb(v_ids));
END $function$;