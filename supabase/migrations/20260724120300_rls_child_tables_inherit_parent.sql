-- RLS tier 1: stop child tables leaking what their parents protect.
--
-- sales_orders, quotations, invoices and delivery_notes all have carefully
-- scoped SELECT policies built on _can_see_all_sales() /
-- is_sales_rep_for_record() / has_any_role(). Their line and history tables
-- were left on USING (true), so anyone authenticated could read the line
-- items, amounts and revision history of documents they cannot open. The
-- parent policy was effectively decorative for anyone willing to query the
-- child directly.
--
-- Postgres applies a referenced table's own RLS inside a policy's EXISTS
-- subquery, so gating each child on "can I see the parent" makes the child
-- inherit the parent's scoping automatically, and keeps inheriting it if the
-- parent policy is later changed. Verified empirically before writing this.
--
-- Deliberately NOT changed here:
--   * salary_components — a catalogue of component definitions (Basic, HRA,
--     PF rules), not per-employee pay. No personal data.
--   * lookup tables (units_of_measure, product_categories, operation_types,
--     leave_types, numbering_*) — read-open is intended.
--   * app_roles / app_role_permissions — the client's RBAC hydration reads
--     these directly; restricting them needs a client change first.

-- ---------------------------------------------------------------- invoices
DROP POLICY IF EXISTS invoice_lines_select_auth ON public.invoice_lines;
CREATE POLICY invoice_lines_select_via_invoice
  ON public.invoice_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i WHERE i.id = invoice_lines.invoice_id
  ));

-- --------------------------------------------------------- delivery notes
DROP POLICY IF EXISTS dnl_select_auth ON public.delivery_note_lines;
CREATE POLICY dnl_select_via_delivery_note
  ON public.delivery_note_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.delivery_notes d
     WHERE d.id = delivery_note_lines.delivery_note_id
  ));

-- ------------------------------------------------------------- quotations
DROP POLICY IF EXISTS quotation_versions_select ON public.quotation_versions;
CREATE POLICY quotation_versions_select_via_quotation
  ON public.quotation_versions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotations q
     WHERE q.id = quotation_versions.quotation_id
  ));

-- ----------------------------------------------------------- sales orders
DROP POLICY IF EXISTS order_activities_select ON public.order_activities;
CREATE POLICY order_activities_select_via_order
  ON public.order_activities FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sales_orders so WHERE so.id = order_activities.order_id
  ));

-- ---------------------------------------------------------- subscriptions
-- subscriptions itself was USING (true), so gating only the lines would have
-- achieved nothing. Scope the parent to the same audience that can see sales
-- orders, then let the lines inherit it.
DROP POLICY IF EXISTS subscriptions_select ON public.subscriptions;
CREATE POLICY subscriptions_select
  ON public.subscriptions FOR SELECT TO authenticated
  USING (
    public._can_see_all_sales()
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS subscription_lines_select ON public.subscription_lines;
CREATE POLICY subscription_lines_select_via_subscription
  ON public.subscription_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.subscriptions s
     WHERE s.id = subscription_lines.subscription_id
  ));
