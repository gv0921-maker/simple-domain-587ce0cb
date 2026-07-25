
-- ============================================================
-- 1. Atomic serial number allocator (per-prefix counter)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.serial_counters (
  prefix TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.serial_counters TO authenticated;
GRANT ALL ON public.serial_counters TO service_role;
ALTER TABLE public.serial_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "counters read auth" ON public.serial_counters FOR SELECT TO authenticated USING (true);
-- writes are performed via SECURITY DEFINER RPC only; no direct INSERT/UPDATE policy.

-- Seed from existing label_prints: extract prefix (everything up to last '-') and last numeric segment
INSERT INTO public.serial_counters (prefix, last_number)
SELECT
  regexp_replace(serial_number, '-[0-9]+$', '-') AS prefix,
  MAX((regexp_match(serial_number, '-([0-9]+)$'))[1]::int) AS last_number
FROM public.label_prints
WHERE serial_number ~ '-[0-9]+$'
GROUP BY 1
ON CONFLICT (prefix) DO UPDATE
  SET last_number = GREATEST(public.serial_counters.last_number, EXCLUDED.last_number),
      updated_at = now();

-- Atomic batch allocation
CREATE OR REPLACE FUNCTION public.allocate_serial_numbers(p_prefix TEXT, p_count INT)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start INT;
  v_end INT;
  v_out TEXT[] := ARRAY[]::TEXT[];
  i INT;
BEGIN
  IF p_prefix IS NULL OR length(p_prefix) = 0 THEN
    RAISE EXCEPTION 'prefix required';
  END IF;
  IF p_count IS NULL OR p_count < 1 THEN
    RAISE EXCEPTION 'count must be >= 1';
  END IF;

  INSERT INTO public.serial_counters (prefix, last_number)
  VALUES (p_prefix, p_count)
  ON CONFLICT (prefix) DO UPDATE
    SET last_number = public.serial_counters.last_number + p_count,
        updated_at = now()
  RETURNING last_number INTO v_end;

  v_start := v_end - p_count + 1;
  FOR i IN v_start..v_end LOOP
    v_out := array_append(v_out, p_prefix || lpad(i::text, 4, '0'));
  END LOOP;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_serial_numbers(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_serial_numbers(TEXT, INT) TO authenticated, service_role;

-- ============================================================
-- 2. Atomic scan recording
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_scan(
  p_queue_id UUID,
  p_barcode TEXT,
  p_serial TEXT DEFAULT NULL,
  p_product_id UUID DEFAULT NULL,
  p_expected TEXT[] DEFAULT NULL,
  p_already_scanned TEXT[] DEFAULT NULL
)
RETURNS public.scan_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT := btrim(coalesce(p_barcode, ''));
  v_result TEXT := 'valid';
  v_rec public.scan_records;
  v_queue public.scan_queue;
BEGIN
  SELECT * INTO v_queue FROM public.scan_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scan_queue % not found', p_queue_id;
  END IF;
  IF v_queue.scan_status = 'completed' THEN
    RAISE EXCEPTION 'scan queue already completed';
  END IF;

  IF v_code = '' THEN
    v_result := 'invalid';
  ELSIF p_already_scanned IS NOT NULL AND v_code = ANY(p_already_scanned) THEN
    v_result := 'duplicate';
  ELSIF EXISTS (SELECT 1 FROM public.scan_records WHERE scan_queue_id = p_queue_id AND barcode = v_code AND scan_result = 'valid') THEN
    v_result := 'duplicate';
  ELSIF p_expected IS NOT NULL AND array_length(p_expected, 1) > 0 AND NOT (v_code = ANY(p_expected)) THEN
    v_result := 'not_expected';
  END IF;

  INSERT INTO public.scan_records (scan_queue_id, barcode, serial_number, product_id, scanned_by, scan_result)
  VALUES (p_queue_id, v_code, p_serial, p_product_id, auth.uid(), v_result)
  RETURNING * INTO v_rec;

  IF v_result = 'valid' THEN
    UPDATE public.scan_queue
    SET scanned_items_count = scanned_items_count + 1,
        scan_status = CASE WHEN scan_status = 'pending' THEN 'in_progress' ELSE scan_status END,
        updated_at = now()
    WHERE id = p_queue_id;
  END IF;

  RETURN v_rec;
END;
$$;

REVOKE ALL ON FUNCTION public.record_scan(UUID, TEXT, TEXT, UUID, TEXT[], TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_scan(UUID, TEXT, TEXT, UUID, TEXT[], TEXT[]) TO authenticated, service_role;

-- ============================================================
-- 3. Completion validation
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_scan_queue(
  p_queue_id UUID,
  p_force BOOLEAN DEFAULT FALSE,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.scan_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue public.scan_queue;
BEGIN
  SELECT * INTO v_queue FROM public.scan_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scan_queue % not found', p_queue_id;
  END IF;
  IF v_queue.scan_status = 'completed' THEN
    RAISE EXCEPTION 'scan queue already completed';
  END IF;
  IF v_queue.scanned_items_count = 0 THEN
    RAISE EXCEPTION 'cannot complete a scan queue with zero scans';
  END IF;
  IF v_queue.scanned_items_count < v_queue.expected_items_count AND NOT p_force THEN
    RAISE EXCEPTION 'expected % but only % scanned; pass force=true with a reason to override', v_queue.expected_items_count, v_queue.scanned_items_count;
  END IF;
  IF p_force AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'reason required when forcing completion';
  END IF;

  UPDATE public.scan_queue
  SET scan_status = 'completed',
      notes = CASE WHEN p_force THEN coalesce(notes || E'\n', '') || 'FORCED: ' || p_reason ELSE notes END,
      updated_at = now()
  WHERE id = p_queue_id
  RETURNING * INTO v_queue;
  RETURN v_queue;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_scan_queue(UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_scan_queue(UUID, BOOLEAN, TEXT) TO authenticated, service_role;

-- ============================================================
-- 4. Server-side super-admin enforcement for GR discrepancy approval
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_gr_discrepancy_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.discrepancy_approved_by IS DISTINCT FROM OLD.discrepancy_approved_by
     AND NEW.discrepancy_approved_by IS NOT NULL THEN
    IF NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'only super admins can approve goods receipt discrepancies';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_gr_discrepancy_approval ON public.goods_receipts;
CREATE TRIGGER trg_enforce_gr_discrepancy_approval
BEFORE UPDATE ON public.goods_receipts
FOR EACH ROW EXECUTE FUNCTION public.enforce_gr_discrepancy_approval();
