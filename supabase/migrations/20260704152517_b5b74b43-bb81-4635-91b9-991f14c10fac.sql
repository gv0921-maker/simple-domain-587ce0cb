ALTER TABLE public.warehouse_locations
  ADD COLUMN IF NOT EXISTS removal_strategy text DEFAULT 'fifo' CHECK (removal_strategy IN ('fifo','lifo','closest','manual')),
  ADD COLUMN IF NOT EXISTS cyclic_count_frequency_days integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_count_date date,
  ADD COLUMN IF NOT EXISTS next_count_date date,
  ADD COLUMN IF NOT EXISTS notes text;