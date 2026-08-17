-- ============================================================================
-- Delivery payment gate — THE HOOK, BUILT INERT
--
-- Payment status lives in the Sales module, which is not rebuilt. The gate
-- therefore CANNOT be enforced yet, and that is accepted. What is not accepted
-- is a gate that silently passes, so this builds the hook and leaves it
-- unwired: inv_complete_operation is NOT modified by this migration.
--
-- Blast radius: 1 new nullable column, 1 index, 1 new function.
--   - no existing function is altered
--   - no existing row is written
--   - no policy, trigger, view or constraint on an existing object changes
--   - public.sales_orders is REFERENCED, never modified
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------- 1. column

-- Nullable at the COLUMN level, and it must stay that way: a receipt, transfer
-- or adjustment has no sales order, and this column lives on the table that
-- carries all four kinds. CLAUDE.md: the sales-order link is a REFERENCE on
-- the document, not the document's identity. Legacy internal_transfer_orders
-- made it NOT NULL and thereby made it impossible to record a movement that is
-- not picking for an order.
--
-- The REFUSAL of a null on an outgoing delivery is enforced in the gate below,
-- not by a NOT NULL here — see the reasoning there.
--
-- Added now, while kind='outgoing' holds ZERO documents, so there is no
-- backfill question and no window where a delivery exists without the column.
--
-- ON DELETE SET NULL matches source_purchase_order_id, the existing upstream
-- document reference on this table. RESTRICT was considered and rejected: it
-- would let Inventory veto a Sales delete, which is the coupling the reference
-- model exists to avoid.
ALTER TABLE public.inv_operation
  ADD COLUMN sales_order_id uuid NULL
  REFERENCES public.sales_orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.inv_operation.sales_order_id IS
  'The sales order this document is for, when there is one. A REFERENCE, not '
  'the identity of the document. Nullable because receipts, transfers and '
  'adjustments have none — but an outgoing DELIVERY with a null here is '
  'REFUSED by inv_assert_delivery_paid, which is INERT until the Sales module '
  'is rebuilt. See CLAUDE.md, "The delivery payment gate".';

-- Supports both "which deliveries are for this order" and the SET NULL above.
CREATE INDEX inv_operation_sales_order_id_idx
  ON public.inv_operation (sales_order_id)
  WHERE sales_order_id IS NOT NULL;

-- -------------------------------------------------------------- 2. the gate

-- A REAL, NAMED CODE PATH THAT REFUSES. Not a TODO comment.
--
-- The discipline is copied from product_variant_auto_archive: when a function
-- cannot do the thing it is named for, it raises rather than returning a
-- reassuring value. A gate that returns "paid" because it could not check is
-- indistinguishable from a gate that checked and approved — and it is the
-- second one everybody assumes. An inert gate must be loud.
--
-- NOTE THE PRECONDITION IS HARD-CODED, and that is deliberate. The obvious
-- capability probe — do sales_orders.paid_amount / grand_total / total exist —
-- would PASS today: all three columns already exist. They are simply not
-- maintained, because Sales has not been rebuilt. "Not maintained" is not
-- visible in the catalogue, so it cannot be detected; it has to be asserted.
-- Turning this on is therefore a reviewed migration, not a settings row
-- somebody can UPDATE at 2am.
CREATE OR REPLACE FUNCTION public.inv_assert_delivery_paid(p_operation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op    public.inv_operation%ROWTYPE;
  v_kind  public.inv_operation_kind;
  v_paid  numeric;
  v_total numeric;
BEGIN
  SELECT * INTO v_op FROM public.inv_operation WHERE id = p_operation_id;
  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Operation % not found.', p_operation_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT ot.kind INTO v_kind
    FROM public.inv_operation_type ot WHERE ot.id = v_op.operation_type_id;

  -- The gate is about deliveries. A receipt, transfer or adjustment is not
  -- gated on payment and returning here is a correct answer, not a silent one.
  IF v_kind <> 'outgoing' THEN
    RETURN;
  END IF;

  -- ---- THE SWITCH ---------------------------------------------------------
  -- Remove this RAISE to switch the gate on. Everything below it is the real
  -- predicate and is already written and decided.
  RAISE EXCEPTION
    'Payment verification is NOT ACTIVE, so delivery % cannot be cleared for '
    'payment. The Sales module has not been rebuilt, which means '
    'sales_orders.paid_amount is not maintained and this order''s payment '
    'status cannot be verified by anything. THIS IS A REFUSAL, NOT AN '
    'APPROVAL — the gate is deliberately not wired into '
    'inv_complete_operation, so completing a delivery does not consult it. '
    'See CLAUDE.md, "The delivery payment gate".',
    v_op.number
    USING ERRCODE = 'feature_not_supported';

  -- ---- UNREACHABLE UNTIL THE RAISE ABOVE IS REMOVED -----------------------
  -- Left explicit, as product_variant_auto_archive does, so the intended
  -- behaviour is reviewable NOW rather than invented later under pressure.

  -- DECIDED 2026-08-17 (V): an outgoing delivery with NO sales order is
  -- REFUSED. Legacy complete_delivery_with_qc passes trivially here and calls
  -- itself an interface stub; that is not carried forward, and the deciding
  -- argument is the FK above.
  --
  -- sales_order_id is ON DELETE SET NULL. If a null passed trivially, deleting
  -- a sales order would SILENTLY CONVERT AN ALREADY-GATED DELIVERY INTO AN
  -- UNGATED ONE — a Sales-side delete would become a way to bypass a payment
  -- gate, with nothing on either screen saying so, and every value involved
  -- still structurally valid. Same class of failure as a stale destination on
  -- a move: correct-looking data, wrong meaning.
  --
  -- The exemption that trivial-pass was reaching for is real — samples,
  -- warranty replacements — but it belongs where return-to-vendor put it: in
  -- its OWN outgoing operation type, configured and visible on the document,
  -- not inferred from an absence. An exemption you can see is auditable; an
  -- exemption that is a missing value is not.
  IF v_op.sales_order_id IS NULL THEN
    RAISE EXCEPTION
      'Delivery % has no sales order, so there is no payment to verify. A '
      'delivery that is not against an order — a sample or a warranty '
      'replacement — needs its own outgoing operation type, which records the '
      'exemption on the document instead of leaving it to be inferred from a '
      'missing value.',
      v_op.number
      USING ERRCODE = 'check_violation';
  END IF;

  -- Byte-for-byte the legacy predicate, so the two paths cannot drift into
  -- different answers for the same order. FOR UPDATE locks the order row so a
  -- payment cannot land between this read and the delivery completing. The
  -- 0.005 absorbs rounding on a 2dp currency. v_total <= 0 REFUSES rather than
  -- passes: a zero-total order has not been paid, it has not been priced.
  SELECT COALESCE(paid_amount, 0), COALESCE(grand_total, total, 0)
    INTO v_paid, v_total
    FROM public.sales_orders WHERE id = v_op.sales_order_id FOR UPDATE;

  IF v_total <= 0 OR v_paid + 0.005 < v_total THEN
    RAISE EXCEPTION 'Delivery available after full payment. Current: ₹% paid of ₹%',
      v_paid, v_total
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

COMMENT ON FUNCTION public.inv_assert_delivery_paid(uuid) IS
  'INERT payment gate for outgoing deliveries. Raises feature_not_supported '
  'because Sales is not rebuilt and payment cannot be verified. NOT called by '
  'inv_complete_operation. To switch on: delete the RAISE marked THE SWITCH, '
  'then add the call to inv_complete_operation under a kind test for outgoing. '
  'The sales_order_id IS NULL case is already DECIDED — it refuses.';

REVOKE ALL ON FUNCTION public.inv_assert_delivery_paid(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inv_assert_delivery_paid(uuid) TO authenticated;

COMMIT;
