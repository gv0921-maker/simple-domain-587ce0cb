
-- Part 1: Extend operation_types with GLF fields
ALTER TABLE public.operation_types
  ADD COLUMN IF NOT EXISTS card_color text DEFAULT 'gray',
  ADD COLUMN IF NOT EXISTS returns_operation_type_id uuid REFERENCES public.operation_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS print_delivery_slip boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS print_product_labels boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS print_lot_serial_labels boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS mandatory_scan_product boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS mandatory_scan_lot_serial boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_extra_products boolean DEFAULT true;

-- Part 3: Link operations to operation types
ALTER TABLE public.goods_receipts
  ADD COLUMN IF NOT EXISTS operation_type_id uuid REFERENCES public.operation_types(id) ON DELETE SET NULL;
ALTER TABLE public.delivery_notes
  ADD COLUMN IF NOT EXISTS operation_type_id uuid REFERENCES public.operation_types(id) ON DELETE SET NULL;
ALTER TABLE public.internal_movements
  ADD COLUMN IF NOT EXISTS operation_type_id uuid REFERENCES public.operation_types(id) ON DELETE SET NULL;

-- Backfill existing operations to seeded types
UPDATE public.goods_receipts gr
  SET operation_type_id = (SELECT id FROM public.operation_types WHERE operation_kind='receipt' ORDER BY created_at LIMIT 1)
  WHERE operation_type_id IS NULL;
UPDATE public.delivery_notes dn
  SET operation_type_id = (SELECT id FROM public.operation_types WHERE operation_kind='delivery' ORDER BY created_at LIMIT 1)
  WHERE operation_type_id IS NULL;
UPDATE public.internal_movements im
  SET operation_type_id = (SELECT id FROM public.operation_types WHERE operation_kind='internal_transfer' ORDER BY created_at LIMIT 1)
  WHERE operation_type_id IS NULL;
