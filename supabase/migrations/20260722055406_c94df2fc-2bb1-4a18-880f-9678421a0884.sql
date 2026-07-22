
-- Grants for crm_leads (missing) and relax policy to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_leads TO authenticated;
GRANT ALL ON public.crm_leads TO service_role;

DROP POLICY IF EXISTS crm_leads_super_admin_only ON public.crm_leads;

CREATE POLICY "Authenticated users can view leads"
  ON public.crm_leads FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert leads"
  ON public.crm_leads FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update leads"
  ON public.crm_leads FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete leads"
  ON public.crm_leads FOR DELETE
  TO authenticated USING (true);
