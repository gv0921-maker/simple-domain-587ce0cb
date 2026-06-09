-- Expand invoice status to include 'delivered'
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check
  CHECK (status = ANY (ARRAY['draft','sent','paid','overdue','cancelled','delivered']::text[]));

-- Sequence for DN references
CREATE SEQUENCE IF NOT EXISTS public.delivery_notes_seq START 1;

CREATE TABLE public.delivery_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE,
  sales_order_id uuid REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  delivery_date timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','delivered')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  qc_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  products_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  customer_delivery_name text,
  customer_delivery_address text,
  customer_delivery_phone text,
  signature_collected boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_notes TO authenticated;
GRANT ALL ON public.delivery_notes TO service_role;

ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view delivery notes"
  ON public.delivery_notes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Operators can create delivery notes"
  ON public.delivery_notes FOR INSERT TO authenticated
  WITH CHECK (public.can_write_inventory());

CREATE POLICY "Operators can update delivery notes"
  ON public.delivery_notes FOR UPDATE TO authenticated
  USING (public.can_write_inventory())
  WITH CHECK (public.can_write_inventory());

CREATE POLICY "Admins can delete delivery notes"
  ON public.delivery_notes FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE INDEX idx_delivery_notes_sales_order ON public.delivery_notes(sales_order_id);
CREATE INDEX idx_delivery_notes_invoice ON public.delivery_notes(invoice_id);
CREATE INDEX idx_delivery_notes_status ON public.delivery_notes(status);

-- Reference generator: DN-YYYY-000001
CREATE OR REPLACE FUNCTION public.delivery_notes_set_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reference IS NULL OR NEW.reference = '' THEN
    NEW.reference := 'DN-' || to_char(now(), 'YYYY') || '-' ||
                     lpad(nextval('public.delivery_notes_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER delivery_notes_set_reference_trg
  BEFORE INSERT ON public.delivery_notes
  FOR EACH ROW EXECUTE FUNCTION public.delivery_notes_set_reference();

CREATE TRIGGER update_delivery_notes_updated_at
  BEFORE UPDATE ON public.delivery_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();