-- =====================================================================
-- Phase 8 Batch 3 — Final RBAC + data integrity (corrected)
-- =====================================================================

-- ---------- Soft-delete + auth linkage --------------------------------
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS terminated_at timestamptz,
  ADD COLUMN IF NOT EXISTS termination_reason text,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_reason text;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS discontinued_at timestamptz,
  ADD COLUMN IF NOT EXISTS discontinuation_reason text;

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- ---------- factory_user_assignments ---------------------------------
CREATE TABLE IF NOT EXISTS public.factory_user_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  factory_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS factory_user_assignments_unique_active
  ON public.factory_user_assignments(user_id, factory_id) WHERE is_active;

GRANT SELECT ON public.factory_user_assignments TO authenticated;
GRANT ALL ON public.factory_user_assignments TO service_role;

ALTER TABLE public.factory_user_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "factory_assignments_select" ON public.factory_user_assignments;
CREATE POLICY "factory_assignments_select"
  ON public.factory_user_assignments FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_or_super());

DROP POLICY IF EXISTS "factory_assignments_write" ON public.factory_user_assignments;
CREATE POLICY "factory_assignments_write"
  ON public.factory_user_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE OR REPLACE FUNCTION public.is_factory_user_for(p_factory_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.factory_user_assignments
    WHERE user_id = auth.uid() AND factory_id = p_factory_id AND is_active = true
  );
$$;

-- ---------- Cascade hardening (best-effort) ---------------------------
DO $$
DECLARE
  rec RECORD;
  pair text;
  child_tbl text;
  parent_tbl text;
  col_list text;
  ref_col_list text;
  target_pairs text[] := ARRAY[
    'payslips,employees','attendance_sessions,employees','leave_requests,employees',
    'leave_balances,employees','employee_leave_entitlements,employees',
    'contracts,employees','appraisals,employees','employee_advances,employees',
    'employee_loans,employees','quotations,customers','sales_orders,customers',
    'invoices,customers','quotation_lines,products','order_lines,products',
    'invoice_lines,products','stock_moves,warehouses','transfers,warehouses',
    'goods_receipts,warehouses','invoices,sales_orders','delivery_notes,sales_orders',
    'payments,sales_orders'
  ];
BEGIN
  FOREACH pair IN ARRAY target_pairs LOOP
    child_tbl := split_part(pair, ',', 1);
    parent_tbl := split_part(pair, ',', 2);
    FOR rec IN
      SELECT con.conname, con.conrelid, con.confrelid, con.conkey, con.confkey
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_class pcl ON pcl.oid = con.confrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE n.nspname = 'public' AND cl.relname = child_tbl
        AND pcl.relname = parent_tbl AND con.contype = 'f' AND con.confdeltype = 'c'
    LOOP
      SELECT string_agg(quote_ident(att.attname), ',' ORDER BY u.ord),
             string_agg(quote_ident(ratt.attname), ',' ORDER BY u.ord)
        INTO col_list, ref_col_list
      FROM unnest(rec.conkey) WITH ORDINALITY u(attnum, ord)
      JOIN pg_attribute att ON att.attrelid = rec.conrelid AND att.attnum = u.attnum
      JOIN unnest(rec.confkey) WITH ORDINALITY ru(attnum, ord) ON ru.ord = u.ord
      JOIN pg_attribute ratt ON ratt.attrelid = rec.confrelid AND ratt.attnum = ru.attnum;

      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', child_tbl, rec.conname);
      IF col_list IS NOT NULL THEN
        EXECUTE format(
          'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES public.%I(%s) ON DELETE RESTRICT',
          child_tbl, rec.conname, col_list, parent_tbl, ref_col_list
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ---------- Generic activity-log trigger -----------------------------
CREATE OR REPLACE FUNCTION public.log_row_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  k text;
  old_v text;
  new_v text;
  rid text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    rid := COALESCE((to_jsonb(NEW) ->> 'id'), '');
    INSERT INTO public.activity_log(record_type, record_id, action_type, changed_by)
    VALUES (TG_TABLE_NAME, rid, 'created', uid);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    rid := COALESCE((to_jsonb(NEW) ->> 'id'), '');
    FOR k IN SELECT key FROM jsonb_each_text(to_jsonb(NEW))
             WHERE key NOT IN ('updated_at','created_at')
    LOOP
      old_v := (to_jsonb(OLD) ->> k);
      new_v := (to_jsonb(NEW) ->> k);
      IF old_v IS DISTINCT FROM new_v THEN
        INSERT INTO public.activity_log(record_type, record_id, action_type, field_name, old_value, new_value, changed_by)
        VALUES (TG_TABLE_NAME, rid, 'field_change', k, old_v, new_v, uid);
      END IF;
    END LOOP;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    rid := COALESCE((to_jsonb(OLD) ->> 'id'), '');
    INSERT INTO public.activity_log(record_type, record_id, action_type, changed_by)
    VALUES (TG_TABLE_NAME, rid, 'deleted', uid);
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'payslips','salary_components','contracts','refunds','credit_notes',
    'app_user_role_assignments','crm_leads','crm_opportunities',
    'holidays','payroll_settings','company_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_log_%I ON public.%I', t, t);
      EXECUTE format(
        'CREATE TRIGGER trg_log_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_row_change()',
        t, t
      );
    END IF;
  END LOOP;
END $$;

-- ---------- factory_incharge RLS scoping ------------------------------
DROP POLICY IF EXISTS "work_orders_factory_incharge_select" ON public.work_orders;
CREATE POLICY "work_orders_factory_incharge_select"
  ON public.work_orders FOR SELECT TO authenticated
  USING (
    public.is_admin_or_super()
    OR NOT public.has_role(auth.uid(), 'factory_incharge'::app_role)
    OR assigned_factory_incharge_id::text = auth.uid()::text
  );

DROP POLICY IF EXISTS "work_orders_factory_incharge_update" ON public.work_orders;
CREATE POLICY "work_orders_factory_incharge_update"
  ON public.work_orders FOR UPDATE TO authenticated
  USING (
    public.is_admin_or_super()
    OR (public.has_role(auth.uid(), 'factory_incharge'::app_role)
        AND assigned_factory_incharge_id::text = auth.uid()::text)
  )
  WITH CHECK (
    public.is_admin_or_super()
    OR (public.has_role(auth.uid(), 'factory_incharge'::app_role)
        AND assigned_factory_incharge_id::text = auth.uid()::text)
  );

-- ---------- Search-path hardening on helpers --------------------------
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY['has_role','is_admin_or_super','_can_see_all_sales'];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    BEGIN EXECUTE format('ALTER FUNCTION public.%I(uuid, app_role) SET search_path = public', fn);
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN EXECUTE format('ALTER FUNCTION public.%I() SET search_path = public', fn);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END $$;
