
-- 1. activity_log: restrict SELECT
DROP POLICY IF EXISTS "Authenticated can read activity log" ON public.activity_log;
CREATE POLICY "Activity log read scoped"
  ON public.activity_log FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role])
    OR changed_by = auth.uid()
  );

-- 2. crm_leads: lock down (module removed)
DROP POLICY IF EXISTS "Authenticated users can view leads" ON public.crm_leads;
DROP POLICY IF EXISTS "Authenticated users can create leads" ON public.crm_leads;
DROP POLICY IF EXISTS "Authenticated users can update leads" ON public.crm_leads;
DROP POLICY IF EXISTS "Authenticated users can delete leads" ON public.crm_leads;
DROP POLICY IF EXISTS "crm_leads_no_access" ON public.crm_leads;
CREATE POLICY "crm_leads_super_admin_only"
  ON public.crm_leads FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

-- 3. customers: remove fallback INSERT, add scoped insert
DROP POLICY IF EXISTS "customers_insert_authenticated_fallback" ON public.customers;
CREATE POLICY "customers_insert_sales"
  ON public.customers FOR INSERT TO authenticated
  WITH CHECK (
    is_admin()
    OR (
      has_any_role(auth.uid(), ARRAY['sales_manager'::app_role, 'sales_rep'::app_role])
      AND created_by = auth.uid()
      AND portal_token IS NULL
    )
  );

-- 4. quotations: remove fallback INSERT, add scoped insert
DROP POLICY IF EXISTS "quotations_insert_authenticated_fallback" ON public.quotations;
CREATE POLICY "quotations_insert_sales"
  ON public.quotations FOR INSERT TO authenticated
  WITH CHECK (
    is_admin()
    OR (
      has_any_role(auth.uid(), ARRAY['sales_manager'::app_role, 'sales_rep'::app_role])
      AND created_by = auth.uid()
    )
  );

-- 5. sales_orders: remove fallback INSERT, add scoped insert
DROP POLICY IF EXISTS "sales_orders_insert_authenticated_fallback" ON public.sales_orders;
CREATE POLICY "sales_orders_insert_sales"
  ON public.sales_orders FOR INSERT TO authenticated
  WITH CHECK (
    is_admin()
    OR (
      has_any_role(auth.uid(), ARRAY['sales_manager'::app_role, 'sales_rep'::app_role])
      AND created_by = auth.uid()
    )
  );

-- 6. order_lines: remove fallback INSERT, add scoped insert via parent order
DROP POLICY IF EXISTS "order_lines_insert_authenticated_fallback" ON public.order_lines;
CREATE POLICY "order_lines_insert_sales"
  ON public.order_lines FOR INSERT TO authenticated
  WITH CHECK (
    is_admin()
    OR has_role(auth.uid(), 'sales_manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.sales_orders so
      WHERE so.id = order_lines.order_id
        AND has_role(auth.uid(), 'sales_rep'::app_role)
        AND so.created_by = auth.uid()
    )
  );

-- 7. quotation_lines: remove fallback INSERT, add scoped insert via parent quotation
DROP POLICY IF EXISTS "quotation_lines_insert_authenticated_fallback" ON public.quotation_lines;
CREATE POLICY "quotation_lines_insert_sales"
  ON public.quotation_lines FOR INSERT TO authenticated
  WITH CHECK (
    is_admin()
    OR has_role(auth.uid(), 'sales_manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quotation_lines.quotation_id
        AND has_role(auth.uid(), 'sales_rep'::app_role)
        AND q.created_by = auth.uid()
    )
  );

-- 8. stock_reservations: tighten insert and select
DROP POLICY IF EXISTS "stock_reservations_insert_auth" ON public.stock_reservations;
DROP POLICY IF EXISTS "stock_reservations_select_auth" ON public.stock_reservations;
CREATE POLICY "stock_reservations_insert_scoped"
  ON public.stock_reservations FOR INSERT TO authenticated
  WITH CHECK (
    reserved_by = auth.uid()
    AND (
      is_admin()
      OR can_write_inventory()
      OR has_any_role(auth.uid(), ARRAY['sales_manager'::app_role, 'sales_rep'::app_role])
    )
  );
CREATE POLICY "stock_reservations_select_scoped"
  ON public.stock_reservations FOR SELECT TO authenticated
  USING (
    is_admin()
    OR can_write_inventory()
    OR has_any_role(auth.uid(), ARRAY['sales_manager'::app_role, 'sales_rep'::app_role, 'warehouse_operator'::app_role, 'factory_incharge'::app_role])
    OR reserved_by = auth.uid()
  );

-- 9. leave_requests: prevent managers from reassigning employee_id
CREATE OR REPLACE FUNCTION public.prevent_leave_request_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
    IF NOT has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'hr_manager'::app_role]) THEN
      RAISE EXCEPTION 'Cannot reassign leave request to a different employee';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_prevent_leave_reassignment ON public.leave_requests;
CREATE TRIGGER trg_prevent_leave_reassignment
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_leave_request_reassignment();

-- 10. appraisals: add SELECT for hr_manager and direct managers
CREATE POLICY "appraisals_select_hr_or_manager"
  ON public.appraisals FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'hr_manager'::app_role)
    OR is_manager_of(employee_id)
    OR is_employee_self(employee_id)
  );

CREATE POLICY "appraisal_ratings_select_hr_or_manager"
  ON public.appraisal_ratings FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'hr_manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.appraisals a
      WHERE a.id = appraisal_ratings.appraisal_id
        AND (is_manager_of(a.employee_id) OR is_employee_self(a.employee_id))
    )
  );

CREATE POLICY "appraisal_goals_select_hr_or_manager"
  ON public.appraisal_goals FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'hr_manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.appraisals a
      WHERE a.id = appraisal_goals.appraisal_id
        AND (is_manager_of(a.employee_id) OR is_employee_self(a.employee_id))
    )
  );

CREATE POLICY "appraisal_attachments_select_hr_or_manager"
  ON public.appraisal_attachments FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'hr_manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.appraisals a
      WHERE a.id = appraisal_attachments.appraisal_id
        AND (is_manager_of(a.employee_id) OR is_employee_self(a.employee_id))
    )
  );
