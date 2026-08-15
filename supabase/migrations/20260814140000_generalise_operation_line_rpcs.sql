-- =====================================================================
-- INTERNAL TRANSFERS — the line RPCs, generalised over kind
--
-- NOT YET APPLIED. Awaiting approval (CLAUDE.md Rule 2).
--
-- WHY THIS IS NEEDED. Commit 2/4 generalised CREATE and COMPLETE, so a
-- transfer can be raised and validated. It cannot be given a LINE:
--
--   inv_add_receipt_line     IF v_kind <> 'receipt' THEN RAISE ...
--   inv_remove_receipt_line  IF v_kind <> 'receipt' THEN RAISE ...
--
-- Both raise the same sentence — 'Operation % is a % operation, not a
-- receipt.' — so a transfer can never acquire an inv_move, and with no move
-- there is no p_move_id for inv_transfer_stock_item and nothing for the scan
-- screen to scan onto. The transfer path is create → (wall) → nothing.
--
-- SCOPE: functions only. NO table, column, constraint, trigger, policy,
-- index, view, enum or grant is touched. Two functions are ADDED; the two
-- receipt functions are REWRITTEN AS THIN WRAPPERS keeping their exact
-- signatures, their permission message, their kind guard and its wording
-- (Rule 4 — neither is dropped, every existing caller keeps working).
--
-- Expected fingerprint effect: pg_proc 213 -> 215. Constraints, triggers,
-- policies, views and schema unchanged.
--
-- DELIBERATELY NOT IN THIS MIGRATION: inv_cancel_receipt. Cancelling is not
-- a mechanical generalisation. Its refusal reads 'Cancelling would leave
-- those units on hand with no live document accounting for them' — true of a
-- receipt, where the units were CREATED by the document. On a transfer the
-- units already existed and have physically MOVED, so cancelling raises a
-- different question (does it move them back? that is a reversal, which does
-- not exist) that deserves its own decision rather than being smuggled in
-- under a refactor.
-- =====================================================================

-- --------------------------------------------------------- ADD A LINE ---

-- NO default on p_demand_qty here, unlike the receipt wrapper. This function is
-- new and has no callers to protect, and a demand quantity that silently
-- defaults to 1 is a quantity nobody chose. The wrapper keeps its DEFAULT 1
-- because removing it would change an existing signature.
CREATE OR REPLACE FUNCTION public.inv_add_operation_line(
  p_operation_id uuid,
  p_product_id   uuid,
  p_demand_qty   integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op      public.inv_operation%ROWTYPE;
  v_kind    public.inv_operation_kind;
  v_noun    text;
  v_move_id uuid;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to edit an inventory operation.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_op FROM public.inv_operation WHERE id = p_operation_id FOR UPDATE;
  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Operation % not found.', p_operation_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT ot.kind INTO v_kind
    FROM public.inv_operation_type ot WHERE ot.id = v_op.operation_type_id;

  -- The document's name in operator-facing sentences. Chosen so the receipt
  -- path's existing messages come out BYTE-IDENTICAL to what it raises today
  -- ('Receipt RCP/2627/0006 is done and can no longer be edited.') while a
  -- transfer reads correctly instead of calling itself a receipt.
  v_noun := CASE v_kind
              WHEN 'receipt'    THEN 'Receipt'
              WHEN 'internal'   THEN 'Transfer'
              WHEN 'outgoing'   THEN 'Delivery'
              WHEN 'adjustment' THEN 'Adjustment'
            END;

  -- Closes the gap found in Part A #4: nothing in the schema stopped a line
  -- being added to a finished document.
  IF v_op.state IN ('done', 'cancelled') THEN
    RAISE EXCEPTION
      '% % is % and can no longer be edited.', v_noun, v_op.number, v_op.state
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

COMMENT ON FUNCTION public.inv_add_operation_line(uuid,uuid,integer) IS
  'Adds or updates a product line on an inv_operation of ANY kind. Upserts by product. inv_add_receipt_line is a thin wrapper over this.';


-- The receipt entry point, kept (Rule 4) with its EXACT original signature.
-- It performs its OWN permission check and kind guard first, so BOTH of those
-- messages stay verbatim for existing callers, then delegates.
--
-- `p_demand_qty integer DEFAULT 1` — the DEFAULT is part of the signature and
-- is preserved deliberately. A first attempt at this migration omitted it and
-- Postgres refused the whole file:
--
--   ERROR: 42P13: cannot remove parameter defaults from existing function
--   HINT:  Use DROP FUNCTION inv_add_receipt_line(uuid,uuid,integer) first.
--
-- Taking that hint would have been the wrong move twice over: DROP is a Rule 4
-- deletion, and dropping the default silently breaks any caller that omits the
-- third argument. The refusal was correct and the signature is restored.
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
  v_op   public.inv_operation%ROWTYPE;
  v_kind public.inv_operation_kind;
BEGIN
  -- Wording preserved verbatim from the pre-generalisation function.
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to edit a receipt.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_op FROM public.inv_operation WHERE id = p_operation_id;
  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Operation % not found.', p_operation_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT ot.kind INTO v_kind
    FROM public.inv_operation_type ot WHERE ot.id = v_op.operation_type_id;

  -- Wording preserved verbatim from the pre-generalisation function.
  IF v_kind <> 'receipt'::public.inv_operation_kind THEN
    RAISE EXCEPTION 'Operation % is a % operation, not a receipt.', v_op.number, v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN public.inv_add_operation_line(p_operation_id, p_product_id, p_demand_qty);
END $function$;

COMMENT ON FUNCTION public.inv_add_receipt_line(uuid,uuid,integer) IS
  'Receipt-only entry point. Thin wrapper over inv_add_operation_line, kept for existing callers (Rule 4).';


-- ------------------------------------------------------ REMOVE A LINE ---

CREATE OR REPLACE FUNCTION public.inv_remove_operation_line(p_move_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op    public.inv_operation%ROWTYPE;
  v_kind  public.inv_operation_kind;
  v_noun  text;
  v_verb  text;
  v_units integer;
  v_state public.inv_operation_state;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to edit an inventory operation.'
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

  v_noun := CASE v_kind
              WHEN 'receipt'    THEN 'Receipt'
              WHEN 'internal'   THEN 'Transfer'
              WHEN 'outgoing'   THEN 'Delivery'
              WHEN 'adjustment' THEN 'Adjustment'
            END;

  -- What the units on this line HAD done to them. Chosen so the receipt path
  -- still raises 'already received' / 'Received units leave the document ...'
  -- exactly as today.
  v_verb := CASE v_kind
              WHEN 'receipt'    THEN 'received'
              WHEN 'internal'   THEN 'moved'
              WHEN 'outgoing'   THEN 'shipped'
              WHEN 'adjustment' THEN 'adjusted'
            END;

  IF v_op.state IN ('done', 'cancelled') THEN
    RAISE EXCEPTION
      '% % is % and can no longer be edited.', v_noun, v_op.number, v_op.state
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_units
    FROM public.inv_move_line WHERE move_id = p_move_id;

  IF v_units > 0 THEN
    RAISE EXCEPTION
      'This line has % unit(s) already % and cannot be removed. % units leave the document only by reversal, which is not implemented yet.',
      v_units, v_verb, initcap(v_verb)
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.inv_move WHERE id = p_move_id;

  v_state := public.inv_derive_operation_state(v_op.id);

  RETURN jsonb_build_object(
    'operation',       v_op.number,
    'kind',            v_kind,
    'removed_move_id', p_move_id,
    'operation_state', v_state);
END $function$;

COMMENT ON FUNCTION public.inv_remove_operation_line(uuid) IS
  'Removes an unprocessed line from an inv_operation of ANY kind. inv_remove_receipt_line is a thin wrapper over this.';


-- The receipt entry point, kept (Rule 4) with its exact signature, its
-- permission message and its kind guard's exact wording.
CREATE OR REPLACE FUNCTION public.inv_remove_receipt_line(p_move_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op   public.inv_operation%ROWTYPE;
  v_kind public.inv_operation_kind;
BEGIN
  -- Wording preserved verbatim from the pre-generalisation function.
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

  -- Wording preserved verbatim from the pre-generalisation function.
  IF v_kind <> 'receipt'::public.inv_operation_kind THEN
    RAISE EXCEPTION 'Operation % is a % operation, not a receipt.', v_op.number, v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN public.inv_remove_operation_line(p_move_id);
END $function$;

COMMENT ON FUNCTION public.inv_remove_receipt_line(uuid) IS
  'Receipt-only entry point. Thin wrapper over inv_remove_operation_line, kept for existing callers (Rule 4).';
