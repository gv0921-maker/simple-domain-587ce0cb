-- ============================================================================
-- inv_remove_operation_line — SAY IT, DO NOT JUST REFUSE IT
--
-- THE DEFECT. 20260822090000 gave inv_pending_serial.move_id an ON DELETE
-- RESTRICT foreign key, so removing a line that carries generated labels is
-- now refused. That is correct and intended: the labels exist physically and
-- must be voided deliberately first. But the function ends in a bare
-- `DELETE FROM inv_move`, so the operator is shown
--
--   update or delete on table "inv_move" violates foreign key constraint
--   "inv_pending_serial_move_id_fkey" on table "inv_pending_serial"
--
-- A correct refusal nobody can read is half a fix. This is the standing
-- failure of smoke test 26 in supabase/smoke/serial_generation_smoke.sql.
--
-- WHAT CHANGES. One guard, added immediately before the DELETE, composing a
-- sentence in exactly the register the function already uses for its sibling
-- case ("This line has N unit(s) already received and cannot be removed.").
-- Nothing else in the function is touched: the permission check, the
-- not-found check, the done/cancelled check, the already-received check and
-- the returned jsonb are byte-identical.
--
-- THE GUARD COUNTS EVERY ROW, NOT JUST THE OUTSTANDING ONES, because that is
-- what the FK does. Counting only unvoided labels would let a line whose
-- labels were all voided sail past this sentence and hit the raw FK anyway --
-- reintroducing the exact bug being fixed, in a narrower case that is harder
-- to notice.
--
-- Blast radius: 1 function replaced. No schema, policy, trigger, constraint or
-- view change. No row is written.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.inv_remove_operation_line(p_move_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op       public.inv_operation%ROWTYPE;
  v_kind     public.inv_operation_kind;
  v_noun     text;
  v_verb     text;
  v_units    integer;
  v_state    public.inv_operation_state;
  v_lbl_all  integer;
  v_lbl_open integer;
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

  -- ==================== NEW: say why, before the FK does ==================
  -- COUNT EVERY ROW. inv_pending_serial_move_id_fkey restricts on the move id
  -- regardless of whether a number is outstanding, voided or consumed, so a
  -- guard that looked only at outstanding ones would pass a line whose labels
  -- were all voided straight through to the raw constraint violation this
  -- exists to replace.
  SELECT count(*),
         count(*) FILTER (WHERE consumed_at IS NULL AND voided_at IS NULL)
    INTO v_lbl_all, v_lbl_open
    FROM public.inv_pending_serial WHERE move_id = p_move_id;

  IF v_lbl_all > 0 THEN
    IF v_lbl_open > 0 THEN
      -- The actionable case: labels are still live, and voiding them is a
      -- thing the operator can do from this screen right now.
      RAISE EXCEPTION
        'This line has % generated serial number(s), % still waiting for goods. Removing the line would orphan labels that may already be printed and stuck to stock. Void the % outstanding number(s) first, then remove the line.',
        v_lbl_all, v_lbl_open, v_lbl_open
        USING ERRCODE = 'check_violation';
    ELSE
      -- Everything is already voided. There is no way to remove the line, so
      -- the message must offer the alternative rather than a dead end: the
      -- demand field is editable, and setting it to zero says "we expected
      -- nothing here" without erasing that numbers were once issued.
      RAISE EXCEPTION
        'This line has % generated serial number(s), all of them already voided. Those numbers were issued against this line and are never reissued, so the line is part of the record and cannot be removed. Set its demand to 0 instead.',
        v_lbl_all
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- ========================================================================

  DELETE FROM public.inv_move WHERE id = p_move_id;

  v_state := public.inv_derive_operation_state(v_op.id);

  RETURN jsonb_build_object(
    'operation',       v_op.number,
    'kind',            v_kind,
    'removed_move_id', p_move_id,
    'operation_state', v_state);
END
$function$;

COMMIT;
