-- Keep sales_orders.paid_amount in sync with the payment ledger.
--
-- Background: sales_orders.paid_amount has a DEFAULT 0 and nothing in the
-- live code path ever wrote it. The only writer was a Record Payment dialog
-- that is no longer mounted anywhere. Meanwhile complete_delivery_with_qc
-- and the client-side canCreateDeliveryForSO both gate delivery on that
-- column, so it evaluated as "nothing has been paid" for every order and
-- delivery completion could never pass the gate.
--
-- The payment ledger itself (sales_order_payments) is correct and is also
-- where redeem_credit_note records credit applied to an order, so a trigger
-- there covers both cash payments and credit-note redemptions.
--
-- The summing rule mirrors get_sales_order_payment_summary (see migration
-- 20260613050226) so the denormalised column and the summary RPC cannot
-- disagree: non-voided rows only.

CREATE OR REPLACE FUNCTION public.sync_sales_order_paid_amount(p_so_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_so_id IS NULL THEN RETURN; END IF;

  UPDATE public.sales_orders so
     SET paid_amount = COALESCE((
           SELECT SUM(p.amount)
             FROM public.sales_order_payments p
            WHERE p.sales_order_id = p_so_id
              AND p.is_voided = false
         ), 0),
         updated_at = now()
   WHERE so.id = p_so_id;
END $$;

COMMENT ON FUNCTION public.sync_sales_order_paid_amount(uuid) IS
  'Recomputes sales_orders.paid_amount from non-voided sales_order_payments. Kept consistent with get_sales_order_payment_summary.';

CREATE OR REPLACE FUNCTION public.trg_sync_sales_order_paid_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Voiding a payment is an UPDATE, not a DELETE, and an update could in
  -- principle move a payment between orders, so refresh both sides.
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.sales_order_id IS NOT NULL THEN
    PERFORM public.sync_sales_order_paid_amount(OLD.sales_order_id);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.sales_order_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id) THEN
    PERFORM public.sync_sales_order_paid_amount(NEW.sales_order_id);
  END IF;

  RETURN NULL; -- AFTER trigger; return value is ignored
END $$;

DROP TRIGGER IF EXISTS trg_sales_order_payments_sync_paid ON public.sales_order_payments;

CREATE TRIGGER trg_sales_order_payments_sync_paid
AFTER INSERT OR UPDATE OF amount, is_voided, sales_order_id OR DELETE
ON public.sales_order_payments
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_sales_order_paid_amount();

-- One-time backfill. Every existing order is currently wrong: those with
-- payments read 0, and any left over from the removed dialog hold only the
-- most recent payment rather than the running total.
UPDATE public.sales_orders so
   SET paid_amount = COALESCE(agg.total_paid, 0)
  FROM (
    SELECT s.id AS so_id,
           COALESCE(SUM(p.amount) FILTER (WHERE p.is_voided = false), 0) AS total_paid
      FROM public.sales_orders s
      LEFT JOIN public.sales_order_payments p ON p.sales_order_id = s.id
     GROUP BY s.id
  ) agg
 WHERE so.id = agg.so_id
   AND so.paid_amount IS DISTINCT FROM COALESCE(agg.total_paid, 0);
