-- RLS tier 2/3: tighten read access on sensitive tables.
--
-- These tables already had RLS enabled and role-scoped writes, but their SELECT
-- policies were `USING (true)` — every authenticated user could read every row.
-- Per the product decision:
--   * crm_leads       -> "all sales roles see all"; also lock down the wide-open
--                        writes (previously any authenticated user could edit or
--                        delete any lead).
--   * pricelists      -> readable only by sales/finance/admin roles.
--   * payment_accounts-> readable only by super_admin / admin / accountant.
--   * goods_receipts  -> deliberately left open (all staff may read).
--
-- Sales roles: admin, super_admin, sales_manager, sales_rep.
-- Finance: accountant. Idempotent (DROP … IF EXISTS before CREATE).

-- ---------------------------------------------------------------------------
-- crm_leads: sales roles only, for both reads and writes.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view leads"   ON public.crm_leads;
DROP POLICY IF EXISTS "Authenticated users can insert leads" ON public.crm_leads;
DROP POLICY IF EXISTS "Authenticated users can update leads" ON public.crm_leads;
DROP POLICY IF EXISTS "Authenticated users can delete leads" ON public.crm_leads;

CREATE POLICY "crm_leads_select_sales" ON public.crm_leads
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','sales_manager','sales_rep']::app_role[]));

CREATE POLICY "crm_leads_insert_sales" ON public.crm_leads
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','sales_manager','sales_rep']::app_role[]));

CREATE POLICY "crm_leads_update_sales" ON public.crm_leads
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','sales_manager','sales_rep']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','sales_manager','sales_rep']::app_role[]));

CREATE POLICY "crm_leads_delete_sales" ON public.crm_leads
  FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','sales_manager','sales_rep']::app_role[]));

-- ---------------------------------------------------------------------------
-- pricelists: reads limited to roles that quote/sell; writes unchanged.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "pricelists_select" ON public.pricelists;

CREATE POLICY "pricelists_select" ON public.pricelists
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','sales_manager','sales_rep','accountant']::app_role[]));

-- ---------------------------------------------------------------------------
-- payment_accounts: reads limited to super_admin / admin / accountant.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "payment_accounts read" ON public.payment_accounts;

CREATE POLICY "payment_accounts read" ON public.payment_accounts
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','accountant']::app_role[]));
