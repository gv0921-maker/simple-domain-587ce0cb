
-- INVOICES
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  sales_order_id uuid REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'regular' CHECK (type IN ('regular','kh','minimum')),
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
  notes text,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices_select_auth" ON public.invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "invoices_insert_acct" ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin','super_admin']::app_role[]));
CREATE POLICY "invoices_update_acct" ON public.invoices FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin','super_admin']::app_role[]));
CREATE POLICY "invoices_delete_acct" ON public.invoices FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin','super_admin']::app_role[]));
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_invoices_customer ON public.invoices(customer_id);
CREATE INDEX idx_invoices_status ON public.invoices(status);
CREATE INDEX idx_invoices_type ON public.invoices(type);

-- INVOICE LINES
CREATE TABLE public.invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  description text,
  quantity numeric(14,3) NOT NULL DEFAULT 1,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  discount numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate numeric(6,2) NOT NULL DEFAULT 0,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_lines TO authenticated;
GRANT ALL ON public.invoice_lines TO service_role;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_lines_select_auth" ON public.invoice_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "invoice_lines_insert_acct" ON public.invoice_lines FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin','super_admin']::app_role[]));
CREATE POLICY "invoice_lines_update_acct" ON public.invoice_lines FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin','super_admin']::app_role[]));
CREATE POLICY "invoice_lines_delete_acct" ON public.invoice_lines FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin','super_admin']::app_role[]));
CREATE TRIGGER trg_invoice_lines_updated_at BEFORE UPDATE ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_invoice_lines_invoice ON public.invoice_lines(invoice_id);

-- PAYMENTS
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  method text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','bank_transfer','cheque','card')),
  reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments_select_auth" ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "payments_insert_acct" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin','super_admin']::app_role[]));
CREATE POLICY "payments_update_acct" ON public.payments FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin','super_admin']::app_role[]));
CREATE POLICY "payments_delete_acct" ON public.payments FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin','super_admin']::app_role[]));
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_payments_invoice ON public.payments(invoice_id);
CREATE INDEX idx_payments_customer ON public.payments(customer_id);
