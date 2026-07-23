CREATE OR REPLACE FUNCTION public.enforce_grs_reservation_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- A serial marked reserved must point at the sales order that owns the reservation.
  IF NEW.stock_status = 'reserved' AND NEW.reserved_for_so_id IS NULL THEN
    RAISE EXCEPTION 'Cannot mark serial % as reserved without reserved_for_so_id', NEW.id;
  END IF;

  -- A serial assigned to a sales order must be in reserved status.
  IF NEW.reserved_for_so_id IS NOT NULL AND NEW.stock_status <> 'reserved' THEN
    RAISE EXCEPTION 'Cannot reserve serial % unless stock_status is reserved (is %)', NEW.id, NEW.stock_status;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Setting or changing a reservation is only legal when the previous row was truly available.
  -- This allows reserve_serials to atomically change available/null -> reserved/<so_id>, while
  -- still blocking double-reservation of rows that were already reserved or otherwise unavailable.
  IF NEW.reserved_for_so_id IS NOT NULL
     AND NEW.reserved_for_so_id IS DISTINCT FROM OLD.reserved_for_so_id THEN
    IF OLD.reserved_for_so_id IS NOT NULL OR OLD.stock_status <> 'available' THEN
      RAISE EXCEPTION 'Cannot reserve serial %: stock_status must be available (is %)',
        NEW.id, OLD.stock_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;