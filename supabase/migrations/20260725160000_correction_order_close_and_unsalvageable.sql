-- Correction Order lifecycle polish (§3.4)
--
-- 1) Restore close_correction_order to its guarded, jsonb-returning form.
--    A later migration (20260614083901) had replaced it with a void version
--    that dropped the "unresolved items" guard AND silently broke the UI:
--    the client reads data.success, which is always undefined for a void RPC,
--    so a successful close was reported to the user as a failure.
--
-- 2) The third §3.4 resolution — "unsalvageable" — is routed to a write-off
--    draft entirely from the service layer (createWriteOffDraft +
--    addItemsToWriteOff), so it needs no new RPC. Once an item is routed it is
--    marked 'closed' on the CO, which the close guard below treats as resolved.
--
-- Idempotent: DROP FUNCTION first because the return type changes (void -> jsonb),
-- which CREATE OR REPLACE cannot do.

DROP FUNCTION IF EXISTS public.close_correction_order(uuid);
CREATE FUNCTION public.close_correction_order(p_co_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending int;
BEGIN
  IF NOT (public.is_admin() OR public.can_write_inventory()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- An item is "resolved" once it has passed re-QC, been refunded by the
  -- vendor, or been routed to a write-off (marked closed). Anything else still
  -- needs a decision, so the order cannot close yet.
  SELECT COUNT(*) INTO v_pending
    FROM public.correction_order_items
   WHERE correction_order_id = p_co_id
     AND current_status NOT IN ('qc_passed', 'refunded_by_vendor', 'closed');

  IF v_pending > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', v_pending || ' item(s) are not yet resolved'
    );
  END IF;

  UPDATE public.correction_orders
     SET status = 'closed', closed_at = now(), closed_by = auth.uid(), updated_at = now()
   WHERE id = p_co_id;

  RETURN jsonb_build_object('success', true);
END $$;

REVOKE EXECUTE ON FUNCTION public.close_correction_order(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.close_correction_order(uuid) TO authenticated;
