
-- ============== stock_counts ==============
CREATE TABLE IF NOT EXISTS public.stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_number text NOT NULL UNIQUE,
  count_period_month integer NOT NULL CHECK (count_period_month BETWEEN 1 AND 12),
  count_period_year integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  count_type text NOT NULL DEFAULT 'full',
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  started_by uuid REFERENCES auth.users(id),
  started_at timestamptz DEFAULT now(),
  completed_by uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  reconciled_by uuid REFERENCES auth.users(id),
  reconciled_at timestamptz,
  skip_reason text,
  skip_approved_by uuid REFERENCES auth.users(id),
  skip_approved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_counts_period_wh
  ON public.stock_counts (count_period_year, count_period_month, COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_counts TO authenticated;
GRANT ALL ON public.stock_counts TO service_role;

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_counts_select" ON public.stock_counts
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['warehouse_operator','sales_rep','sales_manager','admin','super_admin']::app_role[])
  );

CREATE POLICY "stock_counts_insert" ON public.stock_counts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['warehouse_operator','sales_manager','admin','super_admin']::app_role[])
  );

CREATE POLICY "stock_counts_update" ON public.stock_counts
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['warehouse_operator','sales_manager','admin','super_admin']::app_role[])
  );

CREATE POLICY "stock_counts_delete_admin" ON public.stock_counts
  FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE TRIGGER trg_stock_counts_updated
  BEFORE UPDATE ON public.stock_counts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- auto number
CREATE OR REPLACE FUNCTION public.stock_counts_set_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.count_number IS NULL OR NEW.count_number = '' THEN
    NEW.count_number := public.generate_document_number('stock_count');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_stock_counts_number
  BEFORE INSERT ON public.stock_counts
  FOR EACH ROW EXECUTE FUNCTION public.stock_counts_set_number();

-- ============== stock_count_items ==============
CREATE TABLE IF NOT EXISTS public.stock_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_count_id uuid NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  goods_receipt_serial_id uuid NOT NULL REFERENCES public.goods_receipt_serials(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  serial_number text NOT NULL,
  expected_location_type text,
  expected_warehouse_id uuid,
  scanned_at timestamptz,
  scanned_by uuid REFERENCES auth.users(id),
  found_location_type text,
  found_warehouse_id uuid,
  count_status text NOT NULL DEFAULT 'expected',
  discrepancy_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sci_count_status ON public.stock_count_items (stock_count_id, count_status);
CREATE INDEX IF NOT EXISTS idx_sci_serial ON public.stock_count_items (goods_receipt_serial_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sci_count_serial ON public.stock_count_items (stock_count_id, goods_receipt_serial_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_count_items TO authenticated;
GRANT ALL ON public.stock_count_items TO service_role;

ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_count_items_select" ON public.stock_count_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['warehouse_operator','sales_rep','sales_manager','admin','super_admin']::app_role[]));

CREATE POLICY "stock_count_items_insert" ON public.stock_count_items
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['warehouse_operator','sales_manager','admin','super_admin']::app_role[]));

CREATE POLICY "stock_count_items_update" ON public.stock_count_items
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['warehouse_operator','sales_manager','admin','super_admin']::app_role[]));

CREATE POLICY "stock_count_items_delete_admin" ON public.stock_count_items
  FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE TRIGGER trg_stock_count_items_updated
  BEFORE UPDATE ON public.stock_count_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============== initialize_stock_count ==============
CREATE OR REPLACE FUNCTION public.initialize_stock_count(p_count_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer := 0;
  v_warehouse uuid;
BEGIN
  SELECT warehouse_id INTO v_warehouse FROM public.stock_counts WHERE id = p_count_id FOR UPDATE;

  INSERT INTO public.stock_count_items (
    stock_count_id, goods_receipt_serial_id, product_id, serial_number,
    expected_location_type, expected_warehouse_id, count_status
  )
  SELECT p_count_id, s.id, s.product_id, s.serial_number,
         s.stock_status, NULL, 'expected'
    FROM public.goods_receipt_serials s
   WHERE s.stock_status IN ('available','under_correction','reserved')
   ON CONFLICT (stock_count_id, goods_receipt_serial_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.stock_counts
     SET status = 'in_progress', started_by = COALESCE(started_by, auth.uid()), started_at = COALESCE(started_at, now()), updated_at = now()
   WHERE id = p_count_id AND status = 'draft';

  RETURN v_count;
END $$;

-- ============== complete_stock_count ==============
CREATE OR REPLACE FUNCTION public.complete_stock_count(p_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total int; v_found int; v_missing int; v_unexp int;
BEGIN
  UPDATE public.stock_count_items
     SET count_status = 'missing', updated_at = now()
   WHERE stock_count_id = p_count_id AND count_status = 'expected';

  SELECT
    COUNT(*) FILTER (WHERE count_status IN ('expected','found','missing','reconciled')),
    COUNT(*) FILTER (WHERE count_status = 'found'),
    COUNT(*) FILTER (WHERE count_status = 'missing'),
    COUNT(*) FILTER (WHERE count_status = 'unexpected_found')
  INTO v_total, v_found, v_missing, v_unexp
  FROM public.stock_count_items
  WHERE stock_count_id = p_count_id;

  UPDATE public.stock_counts
     SET status = 'completed', completed_by = auth.uid(), completed_at = now(), updated_at = now()
   WHERE id = p_count_id AND status IN ('draft','in_progress');

  RETURN jsonb_build_object(
    'total_expected', v_total,
    'found', v_found,
    'missing', v_missing,
    'unexpected_found', v_unexp
  );
END $$;

-- ============== reconcile_stock_count ==============
CREATE OR REPLACE FUNCTION public.reconcile_stock_count(p_count_id uuid, p_item_reconciliations jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rec jsonb;
  v_item_id uuid;
  v_action text;
  v_serial uuid;
  v_processed int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admins can reconcile stock counts';
  END IF;

  IF jsonb_typeof(p_item_reconciliations) <> 'array' THEN
    RAISE EXCEPTION 'p_item_reconciliations must be a JSON array';
  END IF;

  FOR v_rec IN SELECT value FROM jsonb_array_elements(p_item_reconciliations)
  LOOP
    v_item_id := (v_rec->>'item_id')::uuid;
    v_action := v_rec->>'action';

    SELECT goods_receipt_serial_id INTO v_serial
      FROM public.stock_count_items WHERE id = v_item_id AND stock_count_id = p_count_id;
    IF v_serial IS NULL THEN CONTINUE; END IF;

    IF v_action = 'mark_lost' OR v_action = 'write_off' THEN
      UPDATE public.goods_receipt_serials
         SET stock_status = 'written_off', updated_at = now()
       WHERE id = v_serial;
      UPDATE public.stock_count_items
         SET count_status = 'reconciled',
             discrepancy_notes = COALESCE(discrepancy_notes,'') || ' [' || v_action || ']',
             updated_at = now()
       WHERE id = v_item_id;
    ELSIF v_action = 'found_late' THEN
      UPDATE public.stock_count_items
         SET count_status = 'found', scanned_at = COALESCE(scanned_at, now()), scanned_by = COALESCE(scanned_by, auth.uid()), updated_at = now()
       WHERE id = v_item_id;
    ELSIF v_action = 'ignore' THEN
      UPDATE public.stock_count_items
         SET count_status = 'reconciled',
             discrepancy_notes = COALESCE(discrepancy_notes,'') || ' [ignored]',
             updated_at = now()
       WHERE id = v_item_id;
    END IF;
    v_processed := v_processed + 1;
  END LOOP;

  UPDATE public.stock_counts
     SET status = 'reconciled', reconciled_by = auth.uid(), reconciled_at = now(), updated_at = now()
   WHERE id = p_count_id;

  RETURN jsonb_build_object('processed', v_processed);
END $$;

-- ============== is_count_required_this_month ==============
CREATE OR REPLACE FUNCTION public.is_count_required_this_month(p_year integer, p_month integer)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.stock_counts
    WHERE count_period_year = p_year
      AND count_period_month = p_month
      AND status IN ('completed','reconciled','skipped','in_progress')
  );
$$;

-- ============== approve_count_skip ==============
CREATE OR REPLACE FUNCTION public.approve_count_skip(p_year integer, p_month integer, p_reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admins can approve count skips';
  END IF;
  INSERT INTO public.stock_counts (
    count_period_year, count_period_month, status, skip_reason, skip_approved_by, skip_approved_at, started_by
  ) VALUES (
    p_year, p_month, 'skipped', p_reason, auth.uid(), now(), auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ============== scan integration: extend scan_record trigger ==============
CREATE OR REPLACE FUNCTION public.scan_record_update_ito_line()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_doc_type text;
  v_doc_id uuid;
  v_line_id uuid;
  v_so_id uuid;
  v_serial_id uuid;
  v_imi RECORD;
  v_sci RECORD;
  v_serial RECORD;
BEGIN
  IF NEW.scan_result <> 'valid' THEN RETURN NEW; END IF;
  SELECT document_type, document_id INTO v_doc_type, v_doc_id
    FROM public.scan_queue WHERE id = NEW.scan_queue_id;
  IF v_doc_id IS NULL THEN RETURN NEW; END IF;

  IF v_doc_type = 'internal_transfer' THEN
    SELECT id INTO v_line_id
      FROM public.internal_transfer_order_lines
     WHERE internal_transfer_order_id = v_doc_id
       AND (NEW.product_id IS NULL OR product_id = NEW.product_id)
       AND line_status <> 'completed'
     ORDER BY (line_status='blocked') ASC, created_at ASC
     LIMIT 1;
    IF v_line_id IS NOT NULL THEN
      UPDATE public.internal_transfer_order_lines
         SET quantity_scanned = quantity_scanned + 1, updated_at = now()
       WHERE id = v_line_id;
    END IF;
    SELECT sales_order_id INTO v_so_id FROM public.internal_transfer_orders WHERE id = v_doc_id;
    IF v_so_id IS NOT NULL AND NEW.barcode_value IS NOT NULL THEN
      SELECT id INTO v_serial_id FROM public.goods_receipt_serials
       WHERE barcode_value = NEW.barcode_value OR serial_number = NEW.barcode_value LIMIT 1;
      IF v_serial_id IS NOT NULL THEN
        UPDATE public.goods_receipt_serials
           SET stock_status = 'reserved', reserved_for_so_id = v_so_id, updated_at = now()
         WHERE id = v_serial_id AND stock_status = 'available';
      END IF;
    END IF;
  ELSIF v_doc_type = 'internal_movement' THEN
    SELECT * INTO v_imi FROM public.internal_movement_items
     WHERE internal_movement_id = v_doc_id
       AND (serial_number = NEW.barcode_value OR serial_number = NEW.serial_number
            OR EXISTS (SELECT 1 FROM public.goods_receipt_serials s
                        WHERE s.id = internal_movement_items.goods_receipt_serial_id
                          AND (s.barcode_value = NEW.barcode_value OR s.serial_number = NEW.barcode_value)))
     ORDER BY scanned_at_source ASC, created_at ASC
     LIMIT 1;
    IF v_imi.id IS NOT NULL THEN
      IF v_imi.scanned_at_source = false THEN
        UPDATE public.internal_movement_items SET scanned_at_source = true, updated_at = now() WHERE id = v_imi.id;
        UPDATE public.internal_movements SET status = 'in_progress', updated_at = now() WHERE id = v_doc_id AND status = 'draft';
      ELSIF v_imi.scanned_at_destination = false THEN
        UPDATE public.internal_movement_items SET scanned_at_destination = true, updated_at = now() WHERE id = v_imi.id;
      END IF;
    END IF;
  ELSIF v_doc_type = 'stock_count' THEN
    -- find serial by barcode/serial_number
    SELECT s.* INTO v_serial FROM public.goods_receipt_serials s
     WHERE s.barcode_value = NEW.barcode_value OR s.serial_number = NEW.barcode_value OR s.serial_number = NEW.serial_number
     LIMIT 1;
    IF v_serial.id IS NOT NULL THEN
      SELECT * INTO v_sci FROM public.stock_count_items
       WHERE stock_count_id = v_doc_id AND goods_receipt_serial_id = v_serial.id LIMIT 1;
      IF v_sci.id IS NOT NULL THEN
        UPDATE public.stock_count_items
           SET count_status = 'found',
               scanned_at = now(),
               scanned_by = auth.uid(),
               found_location_type = v_serial.stock_status,
               updated_at = now()
         WHERE id = v_sci.id;
      ELSE
        INSERT INTO public.stock_count_items (
          stock_count_id, goods_receipt_serial_id, product_id, serial_number,
          expected_location_type, count_status, scanned_at, scanned_by, found_location_type
        ) VALUES (
          v_doc_id, v_serial.id, v_serial.product_id, v_serial.serial_number,
          NULL, 'unexpected_found', now(), auth.uid(), v_serial.stock_status
        ) ON CONFLICT (stock_count_id, goods_receipt_serial_id) DO NOTHING;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;
