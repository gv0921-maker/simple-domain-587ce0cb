
-- ============================================================
-- Phase 3 Batch 2 — Correction Orders
-- ============================================================

-- 1) correction_orders
CREATE TABLE IF NOT EXISTS public.correction_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_number text NOT NULL UNIQUE,
  source_type text NOT NULL CHECK (source_type IN ('goods_receipt','return','manual')),
  source_document_id uuid NULL,
  source_document_reference text NULL,
  addressed_to_type text NOT NULL CHECK (addressed_to_type IN ('vendor','factory')),
  addressed_to_id uuid NULL,
  addressed_to_name text NULL,
  correction_type text NOT NULL DEFAULT 'replace' CHECK (correction_type IN ('replace','exchange','repair','refund')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','in_progress','completed','closed','cancelled')),
  notes text NULL,
  created_by uuid NULL REFERENCES auth.users(id),
  sent_at timestamptz NULL,
  closed_at timestamptz NULL,
  closed_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_co_status_created ON public.correction_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_co_source ON public.correction_orders(source_type, source_document_id);

GRANT SELECT, INSERT, UPDATE ON public.correction_orders TO authenticated;
GRANT ALL ON public.correction_orders TO service_role;
ALTER TABLE public.correction_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "co select" ON public.correction_orders FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_rep','sales_manager','warehouse_operator','accountant','admin','super_admin']::app_role[]));
CREATE POLICY "co insert" ON public.correction_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['warehouse_operator','admin','super_admin']::app_role[]));
CREATE POLICY "co update" ON public.correction_orders FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['warehouse_operator','admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['warehouse_operator','admin','super_admin']::app_role[]));

CREATE TRIGGER trg_co_updated BEFORE UPDATE ON public.correction_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) correction_order_items
CREATE TABLE IF NOT EXISTS public.correction_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_order_id uuid NOT NULL REFERENCES public.correction_orders(id) ON DELETE CASCADE,
  goods_receipt_serial_id uuid NOT NULL REFERENCES public.goods_receipt_serials(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  serial_number text NOT NULL,
  original_qc_notes text NULL,
  original_qc_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  latest_qc_status text NOT NULL DEFAULT 'failed' CHECK (latest_qc_status IN ('pending','passed','failed')),
  latest_qc_cycle integer NOT NULL DEFAULT 1,
  current_status text NOT NULL DEFAULT 'awaiting_correction' CHECK (current_status IN
    ('awaiting_correction','returned_to_vendor','received_back','qc_passed','qc_failed_again','refunded_by_vendor','closed')),
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coi_co ON public.correction_order_items(correction_order_id);
CREATE INDEX IF NOT EXISTS idx_coi_serial ON public.correction_order_items(goods_receipt_serial_id);

GRANT SELECT, INSERT, UPDATE ON public.correction_order_items TO authenticated;
GRANT ALL ON public.correction_order_items TO service_role;
ALTER TABLE public.correction_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coi select" ON public.correction_order_items FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_rep','sales_manager','warehouse_operator','accountant','admin','super_admin']::app_role[]));
CREATE POLICY "coi insert" ON public.correction_order_items FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['warehouse_operator','admin','super_admin']::app_role[]));
CREATE POLICY "coi update" ON public.correction_order_items FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['warehouse_operator','admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['warehouse_operator','admin','super_admin']::app_role[]));

CREATE TRIGGER trg_coi_updated BEFORE UPDATE ON public.correction_order_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) correction_qc_cycles  (append-only)
CREATE TABLE IF NOT EXISTS public.correction_qc_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_order_item_id uuid NOT NULL REFERENCES public.correction_order_items(id) ON DELETE CASCADE,
  cycle_number integer NOT NULL,
  qc_status text NOT NULL CHECK (qc_status IN ('passed','failed')),
  qc_notes text NULL,
  qc_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  qc_checked_by uuid NOT NULL REFERENCES auth.users(id),
  qc_checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (correction_order_item_id, cycle_number)
);
CREATE INDEX IF NOT EXISTS idx_cqc_item ON public.correction_qc_cycles(correction_order_item_id);

GRANT SELECT, INSERT ON public.correction_qc_cycles TO authenticated;
GRANT ALL ON public.correction_qc_cycles TO service_role;
ALTER TABLE public.correction_qc_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cqc select" ON public.correction_qc_cycles FOR SELECT TO authenticated USING (true);
CREATE POLICY "cqc insert" ON public.correction_qc_cycles FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['warehouse_operator','admin','super_admin']::app_role[]));

-- 4) correction_order_refunds
CREATE TABLE IF NOT EXISTS public.correction_order_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_order_id uuid NOT NULL REFERENCES public.correction_orders(id) ON DELETE CASCADE,
  correction_order_item_id uuid NOT NULL REFERENCES public.correction_order_items(id) ON DELETE CASCADE,
  refund_amount numeric NOT NULL,
  refund_received_date date NOT NULL,
  refund_method text NULL CHECK (refund_method IN ('cash','bank_transfer','cheque','adjustment')),
  refund_reference text NULL,
  refund_account_id uuid NULL REFERENCES public.payment_accounts(id),
  notes text NULL,
  recorded_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cor_co ON public.correction_order_refunds(correction_order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.correction_order_refunds TO authenticated;
GRANT ALL ON public.correction_order_refunds TO service_role;
ALTER TABLE public.correction_order_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cor select" ON public.correction_order_refunds FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['warehouse_operator','accountant','admin','super_admin']::app_role[]));
CREATE POLICY "cor insert" ON public.correction_order_refunds FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['warehouse_operator','admin','super_admin']::app_role[]));
CREATE POLICY "cor update" ON public.correction_order_refunds FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY "cor delete" ON public.correction_order_refunds FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role));

-- 5) auto_create_correction_order(p_gr_id)
CREATE OR REPLACE FUNCTION public.auto_create_correction_order(p_gr_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_co_id uuid;
  v_gr_ref text;
  v_addressed_type text := 'vendor';
  v_addressed_name text := NULL;
  v_failed RECORD;
  v_inserted int := 0;
BEGIN
  SELECT gr_number INTO v_gr_ref FROM public.goods_receipts WHERE id = p_gr_id;
  IF v_gr_ref IS NULL THEN RETURN NULL; END IF;

  -- find existing draft CO for this GR
  SELECT id INTO v_co_id
    FROM public.correction_orders
   WHERE source_type = 'goods_receipt'
     AND source_document_id = p_gr_id
     AND status = 'draft'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_co_id IS NULL THEN
    INSERT INTO public.correction_orders (
      co_number, source_type, source_document_id, source_document_reference,
      addressed_to_type, addressed_to_name, correction_type, status, created_by
    ) VALUES (
      public.generate_document_number('correction_order'),
      'goods_receipt', p_gr_id, v_gr_ref,
      v_addressed_type, v_addressed_name, 'replace', 'draft', auth.uid()
    ) RETURNING id INTO v_co_id;
  END IF;

  -- add failed serials that aren't already attached to any CO item
  FOR v_failed IN
    SELECT s.id, s.product_id, s.serial_number, s.qc_notes, s.qc_images
      FROM public.goods_receipt_serials s
     WHERE s.goods_receipt_id = p_gr_id
       AND s.qc_status = 'failed'
       AND s.stock_status = 'under_correction'
       AND NOT EXISTS (
         SELECT 1 FROM public.correction_order_items i WHERE i.goods_receipt_serial_id = s.id
       )
  LOOP
    INSERT INTO public.correction_order_items (
      correction_order_id, goods_receipt_serial_id, product_id, serial_number,
      original_qc_notes, original_qc_images, latest_qc_status, latest_qc_cycle, current_status
    ) VALUES (
      v_co_id, v_failed.id, v_failed.product_id, v_failed.serial_number,
      v_failed.qc_notes, COALESCE(v_failed.qc_images, '[]'::jsonb), 'failed', 1, 'awaiting_correction'
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_co_id;
END $$;

-- 6) complete_correction_qc_cycle
CREATE OR REPLACE FUNCTION public.complete_correction_qc_cycle(
  p_co_item_id uuid, p_passed boolean, p_notes text, p_images jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_next int;
  v_serial_id uuid;
  v_new_status text;
  v_item_status text;
BEGIN
  SELECT COALESCE(MAX(cycle_number),0)+1, MAX(goods_receipt_serial_id)
    INTO v_next, v_serial_id
    FROM public.correction_qc_cycles c
    RIGHT JOIN public.correction_order_items i ON i.id = c.correction_order_item_id
    WHERE i.id = p_co_item_id;

  IF v_next IS NULL THEN v_next := 1; END IF;

  INSERT INTO public.correction_qc_cycles (
    correction_order_item_id, cycle_number, qc_status, qc_notes, qc_images, qc_checked_by
  ) VALUES (
    p_co_item_id, v_next, CASE WHEN p_passed THEN 'passed' ELSE 'failed' END,
    p_notes, COALESCE(p_images, '[]'::jsonb), v_uid
  );

  v_new_status := CASE WHEN p_passed THEN 'passed' ELSE 'failed' END;
  v_item_status := CASE WHEN p_passed THEN 'qc_passed' ELSE 'qc_failed_again' END;

  UPDATE public.correction_order_items
     SET latest_qc_status = v_new_status,
         latest_qc_cycle = v_next,
         current_status = v_item_status,
         updated_at = now()
   WHERE id = p_co_item_id
   RETURNING goods_receipt_serial_id INTO v_serial_id;

  IF p_passed AND v_serial_id IS NOT NULL THEN
    UPDATE public.goods_receipt_serials
       SET qc_status = 'passed',
           stock_status = 'available',
           qc_checked_by = v_uid,
           qc_checked_at = now(),
           updated_at = now()
     WHERE id = v_serial_id;
  END IF;
END $$;

-- 7) close_correction_order
CREATE OR REPLACE FUNCTION public.close_correction_order(p_co_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending int;
BEGIN
  SELECT COUNT(*) INTO v_pending
    FROM public.correction_order_items
   WHERE correction_order_id = p_co_id
     AND current_status NOT IN ('qc_passed','refunded_by_vendor','closed');
  IF v_pending > 0 THEN
    RETURN jsonb_build_object('success', false, 'reason',
      v_pending || ' item(s) are not yet resolved');
  END IF;

  UPDATE public.correction_orders
     SET status = 'closed', closed_at = now(), closed_by = auth.uid(), updated_at = now()
   WHERE id = p_co_id;
  RETURN jsonb_build_object('success', true);
END $$;

-- 8) trigger on goods_receipt_serials -> auto-create CO
CREATE OR REPLACE FUNCTION public.trg_gr_serial_after_under_correction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock_status = 'under_correction'
     AND (OLD.stock_status IS DISTINCT FROM NEW.stock_status) THEN
    PERFORM public.auto_create_correction_order(NEW.goods_receipt_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gr_serial_auto_co ON public.goods_receipt_serials;
CREATE TRIGGER trg_gr_serial_auto_co
  AFTER UPDATE OF stock_status ON public.goods_receipt_serials
  FOR EACH ROW EXECUTE FUNCTION public.trg_gr_serial_after_under_correction();
