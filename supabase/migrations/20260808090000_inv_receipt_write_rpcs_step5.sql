-- =====================================================================
-- INVENTORY RESET — STEP 5: receipt write layer (RPCs)
-- =====================================================================
--
-- NOT YET APPLIED. For review.
--
-- Makes the receipt writable from the UI without putting business rules in
-- the browser. Four new functions, plus one corrective change to a proven
-- function (Section 5, called out separately).
--
--   inv_create_receipt        allocate number + insert operation, atomically
--   inv_add_receipt_line      add/update a product line while editable
--   inv_remove_receipt_line   remove a line that has no units
--   inv_cancel_receipt        cancel, refusing when units exist
--
-- WHY RPCs AND NOT DIRECT INSERTS
-- Three reasons, all load-bearing:
--   1. inv_allocate_document_number commits its sequence increment. Called
--      from the client as a separate round trip, a failed follow-up INSERT
--      burns the number permanently — inv_operation.number is UNIQUE, so the
--      gap is silent and unrecoverable. Inside one function it is one
--      transaction: the increment rolls back with the failure.
--   2. locks_destination had NO database enforcement. Nothing read it —
--      inv_receive_serial takes its destination from inv_operation.dest_
--      location_id, never from the type. It was decorative. Section 1 makes
--      it real.
--   3. Every other write path in this layer is already a sanctioned SECURITY
--      DEFINER function. Direct inserts would be the only exception.
--
-- ⚠ HAZARD — LEGACY NAMESAKES, DO NOT CALL
-- These three carry the inv_ prefix but are NOT part of this layer. They read
-- and write the OLD module's tables, and inv_validate_stock_move writes
-- products.stock_on_hand:
--
--   inv_save_stock_move       -> public.stock_moves / stock_move_lines
--   inv_validate_stock_move   -> public.stock_moves + products.stock_on_hand
--   inv_delete_stock_move     -> public.stock_moves / stock_move_lines
--
-- Nothing in the inv_ layer may call them. Of the 23 inv_-prefixed functions
-- in the database, 20 belong to this layer and these 3 are legacy.
--
-- Touches inv_* only. `products` and `vendors` are read for validation, never
-- written. No CRM. No legacy module.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. inv_create_receipt
-- ---------------------------------------------------------------------
-- Number allocation, operation-type defaults and the locked-destination rule
-- all resolved server-side, in one transaction with the INSERT.
--
-- When the type locks its destination the client's p_dest_location_id is
-- IGNORED rather than rejected — but the return value reports that it was
-- ignored (client_destination_ignored), so the UI can say so instead of
-- silently showing the user something other than what they picked.

CREATE OR REPLACE FUNCTION public.inv_create_receipt(
  p_operation_type_id  uuid,
  p_vendor_id          uuid        DEFAULT NULL,
  p_purchase_order_id  uuid        DEFAULT NULL,
  p_source_document    text        DEFAULT NULL,
  p_scheduled_at       timestamptz DEFAULT NULL,
  p_notes              text        DEFAULT NULL,
  p_dest_location_id   uuid        DEFAULT NULL,
  p_source_location_id uuid        DEFAULT NULL,
  p_fy_label           text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ot      public.inv_operation_type%ROWTYPE;
  v_seq     public.inv_number_sequence%ROWTYPE;
  v_doc     text;
  v_fy      text;
  v_source  uuid;
  v_dest    uuid;
  v_locked  boolean := false;
  v_ignored boolean := false;
  v_number  text;
  v_id      uuid;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to create a receipt.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_ot FROM public.inv_operation_type WHERE id = p_operation_type_id;
  IF v_ot.id IS NULL THEN
    RAISE EXCEPTION 'Operation type % not found.', p_operation_type_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT v_ot.is_active THEN
    RAISE EXCEPTION 'Operation type % is not active.', v_ot.name
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_ot.kind <> 'receipt'::public.inv_operation_kind THEN
    RAISE EXCEPTION
      'Operation type % is a % operation. inv_create_receipt creates receipts only.',
      v_ot.name, v_ot.kind
      USING ERRCODE = 'check_violation';
  END IF;

  -- Numbering. The type points at its sequence, and the sequence knows both
  -- its document type and its financial year, so the UI invents neither.
  IF v_ot.sequence_id IS NOT NULL THEN
    SELECT * INTO v_seq FROM public.inv_number_sequence WHERE id = v_ot.sequence_id;
  END IF;

  v_doc := COALESCE(v_seq.document_type, 'receipt');
  v_fy  := COALESCE(p_fy_label, v_seq.fy_label);

  IF v_fy IS NULL THEN
    RAISE EXCEPTION
      'Cannot determine the financial year for %: the type has no number sequence and no fy_label was supplied.',
      v_ot.name
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Locations.
  v_source := COALESCE(p_source_location_id, v_ot.default_source_location_id);

  IF v_ot.locks_destination THEN
    v_dest    := v_ot.default_dest_location_id;
    v_locked  := true;
    v_ignored := p_dest_location_id IS NOT NULL
             AND p_dest_location_id IS DISTINCT FROM v_dest;

    IF v_dest IS NULL THEN
      RAISE EXCEPTION
        'Operation type % locks its destination but has no default destination configured.',
        v_ot.name
        USING ERRCODE = 'null_value_not_allowed';
    END IF;
  ELSE
    v_dest := COALESCE(p_dest_location_id, v_ot.default_dest_location_id);
  END IF;

  IF v_source IS NULL OR v_dest IS NULL THEN
    RAISE EXCEPTION
      'A receipt needs both a source and a destination location. Configure them on operation type % or pass them in.',
      v_ot.name
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  IF p_vendor_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.vendors WHERE id = p_vendor_id) THEN
    RAISE EXCEPTION 'Vendor % not found.', p_vendor_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Everything that can fail has failed by now. Allocating last keeps the
  -- window between "number taken" and "row written" as small as possible;
  -- either way both are in this transaction, so a later failure rolls the
  -- counter back with the insert.
  v_number := public.inv_allocate_document_number(v_doc, v_fy);

  INSERT INTO public.inv_operation (
    number, operation_type_id, state,
    source_location_id, dest_location_id,
    partner_vendor_id, source_purchase_order_id, source_document,
    scheduled_at, created_by, notes
  ) VALUES (
    v_number, v_ot.id, 'draft'::public.inv_operation_state,
    v_source, v_dest,
    p_vendor_id, p_purchase_order_id, p_source_document,
    p_scheduled_at, auth.uid(), p_notes
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id',                         v_id,
    'number',                     v_number,
    'state',                      'draft',
    'source_location_id',         v_source,
    'dest_location_id',           v_dest,
    'destination_locked',         v_locked,
    'client_destination_ignored', v_ignored);
END $function$;

-- ---------------------------------------------------------------------
-- 2. inv_add_receipt_line
-- ---------------------------------------------------------------------
-- Upserts by product: adding a product that already has a live line updates
-- that line's demand rather than creating a duplicate. One call serves both
-- "add line" and "change quantity".
--
-- Moves are created 'assigned', matching the seeded receipt. A receipt does
-- not reserve stock — the goods are arriving — so 'assigned' is the honest
-- starting state, and it makes inv_derive_operation_state settle on 'ready'.
-- That is what gives the UI ribbon draft -> ready when the first line lands,
-- with no 'waiting' detour to explain.

CREATE OR REPLACE FUNCTION public.inv_add_receipt_line(
  p_operation_id uuid,
  p_product_id   uuid,
  p_demand_qty   integer DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op      public.inv_operation%ROWTYPE;
  v_kind    public.inv_operation_kind;
  v_move_id uuid;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to edit a receipt.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_op FROM public.inv_operation WHERE id = p_operation_id FOR UPDATE;
  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Operation % not found.', p_operation_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT ot.kind INTO v_kind
    FROM public.inv_operation_type ot WHERE ot.id = v_op.operation_type_id;

  IF v_kind <> 'receipt'::public.inv_operation_kind THEN
    RAISE EXCEPTION 'Operation % is a % operation, not a receipt.', v_op.number, v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  -- Closes the gap found in Part A #4: nothing in the schema stopped a line
  -- being added to a finished document.
  IF v_op.state IN ('done', 'cancelled') THEN
    RAISE EXCEPTION
      'Receipt % is % and can no longer be edited.', v_op.number, v_op.state
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_demand_qty IS NULL OR p_demand_qty < 0 THEN
    RAISE EXCEPTION 'Demand quantity must be zero or more, got %.', p_demand_qty
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Product % not found.', p_product_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT id INTO v_move_id
    FROM public.inv_move
   WHERE operation_id = p_operation_id
     AND product_id   = p_product_id
     AND state <> 'cancelled'
   ORDER BY created_at
   LIMIT 1;

  IF v_move_id IS NOT NULL THEN
    UPDATE public.inv_move
       SET demand_qty = p_demand_qty, updated_at = now()
     WHERE id = v_move_id;
  ELSE
    INSERT INTO public.inv_move (operation_id, product_id, demand_qty, state)
    VALUES (p_operation_id, p_product_id, p_demand_qty,
            'assigned'::public.inv_move_state)
    RETURNING id INTO v_move_id;
  END IF;

  PERFORM public.inv_derive_operation_state(p_operation_id);

  RETURN v_move_id;
END $function$;

-- ---------------------------------------------------------------------
-- 3. inv_remove_receipt_line
-- ---------------------------------------------------------------------
-- SECURITY DEFINER matters here for a specific reason: the DELETE policy on
-- inv_move is is_admin(), so a warehouse_operator cannot delete a line
-- directly no matter how legitimate the removal. Running as owner bypasses
-- that, and the permission that actually applies is can_write_inventory()
-- plus the checks below.

CREATE OR REPLACE FUNCTION public.inv_remove_receipt_line(p_move_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op    public.inv_operation%ROWTYPE;
  v_kind  public.inv_operation_kind;
  v_units integer;
  v_state public.inv_operation_state;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to edit a receipt.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT o.* INTO v_op
    FROM public.inv_move m
    JOIN public.inv_operation o ON o.id = m.operation_id
   WHERE m.id = p_move_id;

  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Move % not found.', p_move_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT ot.kind INTO v_kind
    FROM public.inv_operation_type ot WHERE ot.id = v_op.operation_type_id;

  IF v_kind <> 'receipt'::public.inv_operation_kind THEN
    RAISE EXCEPTION 'Operation % is a % operation, not a receipt.', v_op.number, v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_op.state IN ('done', 'cancelled') THEN
    RAISE EXCEPTION
      'Receipt % is % and can no longer be edited.', v_op.number, v_op.state
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_units
    FROM public.inv_move_line WHERE move_id = p_move_id;

  IF v_units > 0 THEN
    RAISE EXCEPTION
      'This line has % unit(s) already received and cannot be removed. Received units leave the document only by reversal, which is not implemented yet.',
      v_units
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.inv_move WHERE id = p_move_id;

  v_state := public.inv_derive_operation_state(v_op.id);

  RETURN jsonb_build_object(
    'operation',       v_op.number,
    'removed_move_id', p_move_id,
    'operation_state', v_state);
END $function$;

-- ---------------------------------------------------------------------
-- 4. inv_cancel_receipt
-- ---------------------------------------------------------------------
-- Refuses outright once any unit has been received. Nothing in this layer
-- reverses stock: inv_stock_tracking is append-only by design, so a reversal
-- has to be a compensating entry, and that is a design piece of its own.
-- Until it exists, cancelling a receipt with units would leave stock on hand
-- that no live document accounts for — precisely the silent divergence this
-- rebuild was done to eliminate. Refusing is the honest answer.

CREATE OR REPLACE FUNCTION public.inv_cancel_receipt(p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op       public.inv_operation%ROWTYPE;
  v_kind     public.inv_operation_kind;
  v_units    integer;
  v_move     record;
  v_cancelled integer := 0;
  v_po_state public.inv_order_state;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to cancel a receipt.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_op FROM public.inv_operation WHERE id = p_operation_id FOR UPDATE;
  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Operation % not found.', p_operation_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT ot.kind INTO v_kind
    FROM public.inv_operation_type ot WHERE ot.id = v_op.operation_type_id;

  IF v_kind <> 'receipt'::public.inv_operation_kind THEN
    RAISE EXCEPTION 'Operation % is a % operation, not a receipt.', v_op.number, v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_op.state = 'cancelled' THEN
    RETURN jsonb_build_object(
      'operation', v_op.number, 'operation_state', 'cancelled',
      'moves_cancelled', 0, 'already_cancelled', true);
  END IF;

  IF v_op.state = 'done' THEN
    RAISE EXCEPTION
      'Receipt % is done and cannot be cancelled. A completed receipt is a record of goods that physically arrived; undoing it means reversing those units, not deleting the document.',
      v_op.number
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_units
    FROM public.inv_move_line ml
    JOIN public.inv_move m ON m.id = ml.move_id
   WHERE m.operation_id = p_operation_id;

  IF v_units > 0 THEN
    RAISE EXCEPTION
      'Receipt % cannot be cancelled: % unit(s) have already been received into stock. Cancelling would leave those units on hand with no live document accounting for them. Complete the receipt instead, then raise a stock adjustment to move the units out — direct reversal of received units is not implemented yet.',
      v_op.number, v_units
      USING ERRCODE = 'check_violation';
  END IF;

  FOR v_move IN
    SELECT id FROM public.inv_move
     WHERE operation_id = p_operation_id
       AND state NOT IN ('done', 'cancelled')
  LOOP
    PERFORM public.inv_apply_move_state(v_move.id, 'cancelled'::public.inv_move_state);
    v_cancelled := v_cancelled + 1;
  END LOOP;

  PERFORM public.inv_apply_operation_state(
            p_operation_id, 'cancelled'::public.inv_operation_state);

  -- Re-sync the order so the cancelled document stops counting. Section 5
  -- is what makes this correction actually take effect.
  IF v_op.source_purchase_order_id IS NOT NULL THEN
    v_po_state := public.inv_sync_purchase_order_progress(v_op.source_purchase_order_id);
  END IF;

  RETURN jsonb_build_object(
    'operation',            v_op.number,
    'operation_state',      'cancelled',
    'moves_cancelled',      v_cancelled,
    'purchase_order_state', v_po_state);
END $function$;

-- ---------------------------------------------------------------------
-- 5. inv_sync_purchase_order_progress — CORRECTIVE CHANGE
-- ---------------------------------------------------------------------
-- ⚠ THIS REPLACES A PROVEN FUNCTION. Read this section before approving.
--
-- THE DEFECT: received_qty counted every move line reachable from the order,
-- with no filter on the operation's state. A cancelled receipt's units kept
-- counting toward received_qty, and the order could sit at 'received' on the
-- strength of a document that had been cancelled.
--
-- It is pre-existing, not introduced by Step 5. It is fixed here because
-- Step 5 is what makes cancel reachable from the UI: the moment this ships,
-- the divergence becomes triggerable by an ordinary user action.
--
-- THE ENTIRE DIFF is one predicate in the UPDATE subquery:
--
--     WHERE o.source_purchase_order_id = p_order_id
--       AND m.product_id = pol.product_id
--  +    AND o.state <> 'cancelled'
--
-- Nothing else changes: same signature, same return type, same state-derivation
-- rules, same early-out on a cancelled order. The previous body is preserved
-- verbatim in git history at 20260807160000_inv_receipt_workflow_step4b.sql
-- (Rule 4 — recoverable, not deleted).
--
-- Deliberately NOT changed: cancelled *moves* are still counted. A move cannot
-- hold units and be cancelled under these RPCs, and widening the filter beyond
-- what was approved is how scope creep gets into a proven function.

CREATE OR REPLACE FUNCTION public.inv_sync_purchase_order_progress(p_order_id uuid)
RETURNS inv_order_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cur    public.inv_order_state;
  v_target public.inv_order_state;
  v_lines  integer;
  v_met    integer;
  v_any    integer;
BEGIN
  SELECT state INTO v_cur FROM public.inv_purchase_order WHERE id = p_order_id;
  IF v_cur IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found.', p_order_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_cur = 'cancelled' THEN
    RETURN v_cur;
  END IF;

  UPDATE public.inv_purchase_order_line pol
     SET received_qty = COALESCE((
           SELECT count(*)
             FROM public.inv_move_line ml
             JOIN public.inv_move      m ON m.id = ml.move_id
             JOIN public.inv_operation o ON o.id = m.operation_id
            WHERE o.source_purchase_order_id = p_order_id
              AND m.product_id = pol.product_id
              AND o.state <> 'cancelled'), 0),   -- <-- the fix
         updated_at = now()
   WHERE pol.order_id = p_order_id;

  SELECT count(*),
         count(*) FILTER (WHERE received_qty >= ordered_qty),
         count(*) FILTER (WHERE received_qty > 0)
    INTO v_lines, v_met, v_any
    FROM public.inv_purchase_order_line WHERE order_id = p_order_id;

  v_target :=
    CASE
      WHEN v_lines = 0       THEN v_cur::text
      WHEN v_met   = v_lines THEN 'received'
      WHEN v_any   > 0       THEN 'partially_received'
      ELSE                        v_cur::text
    END::public.inv_order_state;

  IF v_target <> v_cur THEN
    UPDATE public.inv_purchase_order
       SET state = v_target, updated_at = now()
     WHERE id = p_order_id;
  END IF;

  RETURN v_target;
END $function$;

-- ---------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.inv_create_receipt(
  uuid, uuid, uuid, text, timestamptz, text, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_add_receipt_line(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_remove_receipt_line(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_cancel_receipt(uuid) TO authenticated;

COMMIT;
