
-- Add payment tracking fields to sales_orders
ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_reference text;

-- Link payments directly to sales orders (GLF collects payment before invoice)
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES public.sales_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_sales_order_id ON public.payments(sales_order_id);
