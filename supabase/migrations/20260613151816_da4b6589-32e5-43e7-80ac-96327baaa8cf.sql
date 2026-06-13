
-- 1. Extend payroll_settings
ALTER TABLE public.payroll_settings
  ADD COLUMN IF NOT EXISTS pt_salary_threshold numeric NOT NULL DEFAULT 21000,
  ADD COLUMN IF NOT EXISTS payroll_lock_role text NOT NULL DEFAULT 'super_admin',
  ADD COLUMN IF NOT EXISTS appraisal_lock_role text NOT NULL DEFAULT 'super_admin',
  ADD COLUMN IF NOT EXISTS payslip_self_view_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

-- 2. Extend payslips for audit transparency
ALTER TABLE public.payslips
  ADD COLUMN IF NOT EXISTS esi_applicable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pt_applicable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS payroll_settings_snapshot jsonb;

-- Helper: is_super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role = 'super_admin'
  )
$$;

-- Helper: read the self-view toggle without RLS interference
CREATE OR REPLACE FUNCTION public.payslip_self_view_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT payslip_self_view_enabled FROM public.payroll_settings
    WHERE is_active = true
    ORDER BY created_at DESC LIMIT 1
  ), false)
$$;

-- 3. payroll_settings RLS → super_admin only
DROP POLICY IF EXISTS ps_mng ON public.payroll_settings;
DROP POLICY IF EXISTS ps_sel ON public.payroll_settings;
CREATE POLICY ps_super_all ON public.payroll_settings
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 4. payroll_periods RLS → super_admin only
DROP POLICY IF EXISTS pp_mng ON public.payroll_periods;
DROP POLICY IF EXISTS pp_sel ON public.payroll_periods;
CREATE POLICY pp_super_all ON public.payroll_periods
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 5. payslips RLS → super_admin only (DELETE blocked), with optional employee self-view of own finalized payslip
DROP POLICY IF EXISTS psl_mng ON public.payslips;
DROP POLICY IF EXISTS psl_own ON public.payslips;
CREATE POLICY psl_super_select ON public.payslips
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));
CREATE POLICY psl_super_insert ON public.payslips
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY psl_super_update ON public.payslips
  FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
-- No DELETE policy → blocked by default
CREATE POLICY psl_self_view ON public.payslips
  FOR SELECT TO authenticated
  USING (
    public.payslip_self_view_enabled()
    AND status IN ('finalized','paid')
    AND employee_id = public.get_current_employee_id()
  );

-- 6. payslip_components RLS → super_admin only, plus optional self-view linked to parent
DROP POLICY IF EXISTS pslc_mng ON public.payslip_components;
DROP POLICY IF EXISTS pslc_own ON public.payslip_components;
CREATE POLICY pslc_super_all ON public.payslip_components
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY pslc_self_view ON public.payslip_components
  FOR SELECT TO authenticated
  USING (
    public.payslip_self_view_enabled()
    AND payslip_id IN (
      SELECT id FROM public.payslips
      WHERE employee_id = public.get_current_employee_id()
        AND status IN ('finalized','paid')
    )
  );

-- 7. tax_slabs RLS → super_admin only
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='tax_slabs' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.tax_slabs', p.policyname);
  END LOOP;
END $$;
CREATE POLICY tax_super_all ON public.tax_slabs
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 8. Appraisals & related → super_admin only
DO $$ DECLARE r record; t text; BEGIN
  FOREACH t IN ARRAY ARRAY['appraisals','appraisal_cycles','appraisal_templates','appraisal_criteria','appraisal_ratings','appraisal_goals','appraisal_attachments'] LOOP
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
    END LOOP;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()))', t || '_super_all', t);
  END LOOP;
END $$;
