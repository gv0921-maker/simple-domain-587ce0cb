
-- 1. Virtual locations INVENTORY LOSS and SCRAP
-- Insert without hard warehouse dependency: pick any warehouse if warehouse_id is NOT NULL required.
DO $$
DECLARE
  wh uuid;
BEGIN
  SELECT id INTO wh FROM public.warehouses ORDER BY created_at LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM public.warehouse_locations WHERE code = 'LOSS112') THEN
    INSERT INTO public.warehouse_locations (name, code, warehouse_id, type, is_active, removal_strategy)
    VALUES ('INVENTORY LOSS', 'LOSS112', wh, 'virtual', true, 'fifo');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.warehouse_locations WHERE code = 'SCRP113') THEN
    INSERT INTO public.warehouse_locations (name, code, warehouse_id, type, is_active, removal_strategy)
    VALUES ('SCRAP', 'SCRP113', wh, 'virtual', true, 'fifo');
  END IF;
END $$;

-- 2a. Unique partial index preventing two active reservations for same serial
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_reservations_active_serial
  ON public.stock_reservations (serial_number_id)
  WHERE status = 'reserved' AND serial_number_id IS NOT NULL;

-- 2b. Trigger: goods_receipt_serials.reserved_for_so_id may only be set when stock_status='available'
CREATE OR REPLACE FUNCTION public.enforce_grs_reservation_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Allow clearing at any time
  IF NEW.reserved_for_so_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Setting or changing a reservation requires available stock
  IF TG_OP = 'INSERT'
     OR NEW.reserved_for_so_id IS DISTINCT FROM OLD.reserved_for_so_id THEN
    IF NEW.stock_status <> 'available' THEN
      RAISE EXCEPTION 'Cannot reserve serial %: stock_status must be available (is %)',
        NEW.id, NEW.stock_status;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_grs_reservation_status ON public.goods_receipt_serials;
CREATE TRIGGER trg_enforce_grs_reservation_status
  BEFORE INSERT OR UPDATE ON public.goods_receipt_serials
  FOR EACH ROW EXECUTE FUNCTION public.enforce_grs_reservation_status();

-- 3. stock_moves ledger columns + immutability
ALTER TABLE public.stock_moves
  ADD COLUMN IF NOT EXISTS reference_document_type text,
  ADD COLUMN IF NOT EXISTS reference_document_id uuid;

ALTER TABLE public.stock_moves
  DROP CONSTRAINT IF EXISTS stock_moves_reference_document_type_check;
ALTER TABLE public.stock_moves
  ADD CONSTRAINT stock_moves_reference_document_type_check
  CHECK (reference_document_type IS NULL OR reference_document_type IN
    ('goods_receipt','ito','delivery','correction','write_off','stock_count','factory','return'));

-- Ledger immutability: once a stock_move is validated/done, block UPDATE/DELETE
CREATE OR REPLACE FUNCTION public.prevent_stock_move_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state IN ('done','validated') THEN
      RAISE EXCEPTION 'stock_moves row % is % and cannot be deleted (ledger is permanent)', OLD.id, OLD.state;
    END IF;
    RETURN OLD;
  ELSE
    -- UPDATE
    IF OLD.state IN ('done','validated') THEN
      RAISE EXCEPTION 'stock_moves row % is % and cannot be updated (ledger is permanent)', OLD.id, OLD.state;
    END IF;
    RETURN NEW;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_prevent_stock_move_mutation ON public.stock_moves;
CREATE TRIGGER trg_prevent_stock_move_mutation
  BEFORE UPDATE OR DELETE ON public.stock_moves
  FOR EACH ROW EXECUTE FUNCTION public.prevent_stock_move_mutation();

CREATE OR REPLACE FUNCTION public.prevent_stock_move_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_state text;
  parent_id uuid;
BEGIN
  parent_id := COALESCE(OLD.stock_move_id, NEW.stock_move_id);
  SELECT state INTO parent_state FROM public.stock_moves WHERE id = parent_id;

  IF TG_OP = 'DELETE' THEN
    IF parent_state IN ('done','validated') THEN
      RAISE EXCEPTION 'stock_move_lines for move % (state %) cannot be deleted (ledger is permanent)', parent_id, parent_state;
    END IF;
    RETURN OLD;
  ELSE
    IF parent_state IN ('done','validated') THEN
      RAISE EXCEPTION 'stock_move_lines for move % (state %) cannot be updated (ledger is permanent)', parent_id, parent_state;
    END IF;
    RETURN NEW;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_prevent_stock_move_line_mutation ON public.stock_move_lines;
CREATE TRIGGER trg_prevent_stock_move_line_mutation
  BEFORE UPDATE OR DELETE ON public.stock_move_lines
  FOR EACH ROW EXECUTE FUNCTION public.prevent_stock_move_line_mutation();
