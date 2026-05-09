-- Phase 5: Sales add-on persistence (write-through from localStorage)
-- These tables mirror localStorage state for backup/sharing across devices.
-- The app continues to read primarily from localStorage; writes are mirrored.

-- 1. Seasonal Promotions
CREATE TABLE IF NOT EXISTS public.sales_seasonal_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value NUMERIC NOT NULL,
  applicable_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_seasonal_promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Promotions: anyone can read" ON public.sales_seasonal_promotions FOR SELECT USING (true);
CREATE POLICY "Promotions: anyone can insert" ON public.sales_seasonal_promotions FOR INSERT WITH CHECK (true);
CREATE POLICY "Promotions: anyone can update" ON public.sales_seasonal_promotions FOR UPDATE USING (true);
CREATE POLICY "Promotions: anyone can delete" ON public.sales_seasonal_promotions FOR DELETE USING (true);

-- 2. Loyalty Transactions
CREATE TABLE IF NOT EXISTS public.sales_loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id TEXT NOT NULL,
  order_id TEXT,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('earn', 'redeem', 'tier_upgrade', 'adjust')),
  points NUMERIC NOT NULL DEFAULT 0,
  amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_txn_contact ON public.sales_loyalty_transactions(contact_id);
ALTER TABLE public.sales_loyalty_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Loyalty: anyone can read" ON public.sales_loyalty_transactions FOR SELECT USING (true);
CREATE POLICY "Loyalty: anyone can insert" ON public.sales_loyalty_transactions FOR INSERT WITH CHECK (true);

-- 3. Fiscal Positions
CREATE TABLE IF NOT EXISTS public.sales_fiscal_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  country_code TEXT,
  tax_mappings JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_fiscal_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Fiscal: anyone can read" ON public.sales_fiscal_positions FOR SELECT USING (true);
CREATE POLICY "Fiscal: anyone can insert" ON public.sales_fiscal_positions FOR INSERT WITH CHECK (true);
CREATE POLICY "Fiscal: anyone can update" ON public.sales_fiscal_positions FOR UPDATE USING (true);
CREATE POLICY "Fiscal: anyone can delete" ON public.sales_fiscal_positions FOR DELETE USING (true);

-- updated_at trigger function (idempotent)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_promotions_updated_at ON public.sales_seasonal_promotions;
CREATE TRIGGER trg_promotions_updated_at
BEFORE UPDATE ON public.sales_seasonal_promotions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_fiscal_updated_at ON public.sales_fiscal_positions;
CREATE TRIGGER trg_fiscal_updated_at
BEFORE UPDATE ON public.sales_fiscal_positions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();