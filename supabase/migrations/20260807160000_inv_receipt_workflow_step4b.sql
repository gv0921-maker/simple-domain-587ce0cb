-- =====================================================================
-- INVENTORY RESET - STEP 4, MIGRATION B: receipt workflow + QC gate
-- =====================================================================
--
-- Builds:
--   0. state walkers (legal-path hopping)
--   1. receipt completion - units created and moved by the sanctioned path
--   2. received_qty maintenance + purchase order state
--   3. inv_operation.state derived from its moves, now including in_progress
--   4. THE QC GATE - the only way a unit leaves quarantine
--
-- THIS MIGRATION DOES NOT:
--   * drop, alter or rename ANY existing object
--   * touch `products`, CRM, or the old inventory module
--   * reuse the four legacy names (inv_approve_adjustment,
--     inv_validate_stock_move, inv_save_stock_move, inv_delete_stock_move)
--
-- Nothing here writes inv_stock_tracking, inv_move_line, or
-- inv_stock_item.location_id directly - all movement goes through
-- inv_transfer_stock_item, so every Step 3 guarantee still holds.
--
-- Depends on: step2, step3, and 20260807150000_inv_state_and_constraints_step4a.sql
-- =====================================================================

BEGIN;

-- =====================================================================
-- 0. STATE WALKERS
-- =====================================================================
-- The Step 3 / Migration A guards permit only single legal hops, so reaching
-- 'done' from 'draft' must pass through 'ready'. These walk hop by hop rather
-- than forcing an illegal jump. The path depends on where the row currently
-- is, so nothing takes a needless detour.

CREATE OR REPLACE FUNCTION public.inv_apply_move_state(
  p_move_id uuid,
  p_target  public.inv_move_state
) RETURNS public.inv_move_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cur  public.inv_move_state;
  v_path public.inv_move_state[];
  v_step public.inv_move_state;
BEGIN
  SELECT state INTO v_cur FROM public.inv_move WHERE id = p_move_id;
  IF v_cur IS NULL THEN
    RAISE EXCEPTION 'Move % not found.', p_move_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_cur = p_target THEN
    RETURN v_cur;                                     -- idempotent
  END IF;

  v_path := CASE
    WHEN p_target = 'done' AND v_cur = 'draft'
      THEN ARRAY['confirmed','assigned','done']::public.inv_move_state[]
    WHEN p_target = 'done' AND v_cur = 'confirmed'
      THEN ARRAY['assigned','done']::public.inv_move_state[]
    WHEN p_target = 'assigned' AND v_cur = 'draft'
      THEN ARRAY['confirmed','assigned']::public.inv_move_state[]
    ELSE ARRAY[p_target]
  END;

  FOREACH v_step IN ARRAY v_path LOOP
    SELECT state INTO v_cur FROM public.inv_move WHERE id = p_move_id;
    CONTINUE WHEN v_cur = v_step;
    IF NOT public.inv_move_state_allowed(v_cur, v_step) THEN
      RAISE EXCEPTION
        'Cannot take move % from % to %: that hop is not legal.',
        p_move_id, v_cur, v_step
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.inv_move SET state = v_step WHERE id = p_move_id;
  END LOOP;

  SELECT state INTO v_cur FROM public.inv_move WHERE id = p_move_id;
  RETURN v_cur;
END $$;


CREATE OR REPLACE FUNCTION public.inv_apply_operation_state(
  p_operation_id uuid,
  p_target       public.inv_operation_state
) RETURNS public.inv_operation_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cur  public.inv_operation_state;
  v_path public.inv_operation_state[];
  v_step public.inv_operation_state;
BEGIN
  SELECT state INTO v_cur FROM public.inv_operation WHERE id = p_operation_id;
  IF v_cur IS NULL THEN
    RAISE EXCEPTION 'Operation % not found.', p_operation_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_cur = p_target THEN
    RETURN v_cur;
  END IF;

  v_path := CASE
    -- draft/waiting cannot reach done or in_progress directly; go via ready.
    WHEN p_target IN ('done','in_progress') AND v_cur IN ('draft','waiting')
      THEN ARRAY['ready', p_target]::public.inv_operation_state[]
    ELSE ARRAY[p_target]
  END;

  FOREACH v_step IN ARRAY v_path LOOP
    SELECT state INTO v_cur FROM public.inv_operation WHERE id = p_operation_id;
    CONTINUE WHEN v_cur = v_step;
    IF NOT public.inv_operation_state_allowed(v_cur, v_step) THEN
      RAISE EXCEPTION
        'Cannot take operation % from % to %: that hop is not legal.',
        p_operation_id, v_cur, v_step
        USING ERRCODE = 'check_violation';
    END IF;
    -- state='done' requires done_at (Step 2 CHECK inv_operation_done_has_timestamp)
    IF v_step = 'done' THEN
      UPDATE public.inv_operation
         SET state = v_step, done_at = COALESCE(done_at, now())
       WHERE id = p_operation_id;
    ELSE
      UPDATE public.inv_operation SET state = v_step WHERE id = p_operation_id;
    END IF;
  END LOOP;

  SELECT state INTO v_cur FROM public.inv_operation WHERE id = p_operation_id;
  RETURN v_cur;
END $$;


-- =====================================================================
-- 1. RECEIPT COMPLETION - create units, move them the sanctioned way
-- =====================================================================
-- RULE: a serial arriving on a receipt becomes a unit that exists at the
-- supplier and is then moved into the destination, leaving a ledger row and a
-- move line behind. Receiving the same serial twice is a no-op, not a duplicate.
--
-- The unit is created AT THE SOURCE and then transferred rather than conjured
-- into stock. That is what makes the ledger honest: every unit in stock has a
-- tracking row showing it came from outside.
--
-- STATUS: units land QUARANTINED. They are not sellable until the QC gate
-- (section 4) promotes them. inv_available_qty counts only status 'ok', so a
-- freshly received unit contributes nothing to available stock - which is the
-- entire point of having QC checklists.

CREATE OR REPLACE FUNCTION public.inv_receive_serial(
  p_move_id     uuid,
  p_serial      text,
  p_cost        numeric                 DEFAULT 0,
  p_status      public.inv_stock_status DEFAULT 'quarantined',
  p_batch_code  text                    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_op        public.inv_operation%ROWTYPE;
  v_kind      public.inv_operation_kind;
  v_product   uuid;
  v_existing  public.inv_stock_item%ROWTYPE;
  v_item_id   uuid;
  v_serial    text := trim(p_serial);
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to receive inventory.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_serial IS NULL OR v_serial = '' THEN
    RAISE EXCEPTION 'A serial number is required to receive a unit.'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Two lookups, not one. plpgsql will not accept a scalar and a %ROWTYPE in
  -- the same INTO list ("v_op is not a scalar variable"); a row variable must
  -- be the sole target. Both are primary-key lookups, so the cost is nil.
  SELECT o.* INTO v_op
    FROM public.inv_move m
    JOIN public.inv_operation o ON o.id = m.operation_id
   WHERE m.id = p_move_id;

  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Move % not found.', p_move_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT m.product_id INTO v_product
    FROM public.inv_move m WHERE m.id = p_move_id;

  SELECT ot.kind INTO v_kind
    FROM public.inv_operation_type ot WHERE ot.id = v_op.operation_type_id;

  IF v_kind <> 'receipt'::public.inv_operation_kind THEN
    RAISE EXCEPTION
      'Operation % is a % operation, not a receipt. Units are received only on receipts.',
      v_op.number, v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_op.state IN ('done','cancelled') THEN
    RAISE EXCEPTION
      'Receipt % is already % and cannot take further units.', v_op.number, v_op.state
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_op.source_location_id IS NULL OR v_op.dest_location_id IS NULL THEN
    RAISE EXCEPTION
      'Receipt % needs both a source and a destination location before units can be received.',
      v_op.number
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  ------------------------------------------------------------ idempotency
  SELECT * INTO v_existing FROM public.inv_stock_item WHERE serial = v_serial;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.origin_operation_id IS DISTINCT FROM v_op.id THEN
      RAISE EXCEPTION
        'Serial % already exists and was received on a different document. Serials are globally unique.',
        v_serial
        USING ERRCODE = 'unique_violation';
    END IF;

    IF EXISTS (SELECT 1 FROM public.inv_move_line
                WHERE move_id = p_move_id AND stock_item_id = v_existing.id) THEN
      RETURN v_existing.id;                            -- clean re-run
    END IF;

    -- Unit exists but was never transferred (an interrupted earlier run).
    -- Finish the job rather than leaving it stranded at the supplier.
    PERFORM public.inv_transfer_stock_item(
      v_existing.id, p_move_id, v_existing.location_id, v_op.dest_location_id,
      'inv_operation', v_op.id, 'receipt',
      jsonb_build_object('resumed', true));
    RETURN v_existing.id;
  END IF;

  --------------------------------------------------------------- create
  INSERT INTO public.inv_stock_item (
    product_id, serial, location_id, status,
    origin_operation_id, batch_code, cost, received_at
  ) VALUES (
    v_product, v_serial, v_op.source_location_id, p_status,
    v_op.id, p_batch_code, COALESCE(p_cost, 0), now()
  ) RETURNING id INTO v_item_id;

  --------------------------------------------------------------- move it
  PERFORM public.inv_transfer_stock_item(
    v_item_id, p_move_id, v_op.source_location_id, v_op.dest_location_id,
    'inv_operation', v_op.id, 'receipt',
    jsonb_build_object('cost', COALESCE(p_cost, 0), 'status', p_status));

  RETURN v_item_id;
END $$;

COMMENT ON FUNCTION public.inv_receive_serial IS
  'Receives one serial: creates the unit at the supplier location, then moves it into the destination via inv_transfer_stock_item. Units land quarantined and are not sellable until the QC gate promotes them. Idempotent per serial.';


CREATE OR REPLACE FUNCTION public.inv_receive_serials(
  p_move_id uuid,
  p_serials text[],
  p_cost    numeric                 DEFAULT 0,
  p_status  public.inv_stock_status DEFAULT 'quarantined'
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s       text;
  v_count integer := 0;
BEGIN
  FOREACH s IN ARRAY COALESCE(p_serials, ARRAY[]::text[]) LOOP
    IF trim(COALESCE(s,'')) <> '' THEN
      PERFORM public.inv_receive_serial(p_move_id, s, p_cost, p_status);
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;


-- =====================================================================
-- 2. OPERATION STATE DERIVATION  (before the PO sync, which calls it)
-- =====================================================================
-- RULE: a document's state is a fact about its moves, not something a user
-- types. Derived, then applied through the transition guards.
--
--   no moves                        -> draft
--   every non-cancelled move done   -> done
--   SOME moves done, some not       -> in_progress
--   none done, something assigned   -> ready
--   otherwise                       -> waiting
--   all moves cancelled             -> left alone (cancelling is a human act)
--
-- Never reverses out of done or cancelled.

CREATE OR REPLACE FUNCTION public.inv_derive_operation_state(
  p_operation_id uuid
) RETURNS public.inv_operation_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cur       public.inv_operation_state;
  v_target    public.inv_operation_state;
  v_total     integer;
  v_live      integer;
  v_done      integer;
  v_assigned  integer;
BEGIN
  SELECT state INTO v_cur FROM public.inv_operation WHERE id = p_operation_id;
  IF v_cur IS NULL THEN
    RAISE EXCEPTION 'Operation % not found.', p_operation_id USING ERRCODE = 'no_data_found';
  END IF;

  -- Terminal states are facts, not opinions. Nothing derives them away.
  IF v_cur IN ('cancelled','done') THEN
    RETURN v_cur;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE state <> 'cancelled'),
         count(*) FILTER (WHERE state =  'done'),
         count(*) FILTER (WHERE state =  'assigned')
    INTO v_total, v_live, v_done, v_assigned
    FROM public.inv_move WHERE operation_id = p_operation_id;

  v_target :=
    CASE
      WHEN v_total = 0        THEN 'draft'
      WHEN v_live  = 0        THEN v_cur::text        -- every move cancelled
      WHEN v_done  = v_live   THEN 'done'
      WHEN v_done  > 0        THEN 'in_progress'      -- partial
      WHEN v_assigned > 0     THEN 'ready'
      ELSE                         'waiting'
    END::public.inv_operation_state;

  IF v_target = v_cur THEN
    RETURN v_cur;
  END IF;

  RETURN public.inv_apply_operation_state(p_operation_id, v_target);
END $$;

COMMENT ON FUNCTION public.inv_derive_operation_state IS
  'Derives inv_operation.state from its moves and applies it through the transition guards. Some moves done -> in_progress; all done -> done. Never reverses out of done or cancelled.';


-- =====================================================================
-- 3. received_qty MAINTENANCE + PURCHASE ORDER STATE
-- =====================================================================
-- RULE: what has been received against an order is counted from the units that
-- actually arrived, never incremented by hand. Over-receipt is recorded, not
-- rejected - receiving 12 against an order for 10 is a real event the
-- discrepancy flow needs to see.
--
-- One statement recomputes every line from scratch, so this is idempotent and
-- self-healing. The correlated subquery is unambiguous because Migration A
-- forbids two lines for the same product on one order.

CREATE OR REPLACE FUNCTION public.inv_sync_purchase_order_progress(
  p_order_id uuid
) RETURNS public.inv_order_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
              AND m.product_id = pol.product_id), 0),
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
END $$;

COMMENT ON FUNCTION public.inv_sync_purchase_order_progress IS
  'Recomputes received_qty per order line by counting units that actually arrived, then derives the order state. Over-receipt recorded, never rejected. Idempotent.';


-- =====================================================================
-- 4. THE QC GATE - the only way a unit leaves quarantine
-- =====================================================================
-- RULE: a received unit is quarantined and unsellable. It becomes sellable
-- only when every REQUIRED test on its product's checklist has passed.
--
-- Outcome mapping:
--   every required test passed, no advisory failures  -> ok        (sellable)
--   every required test passed, an advisory failed    -> attention (sellable, flagged)
--   any required test failed                          -> rejected  (not sellable)
--   a required test has no result yet                 -> quarantined (unchanged)
--
-- Applicable templates are the active ones for this product plus the active
-- global ones (product_id IS NULL). Retesting appends a new inv_test_result
-- row; the newest row per template is the one that counts, so QC history
-- survives intact.

CREATE OR REPLACE FUNCTION public.inv_record_qc_results(
  p_stock_item_id uuid,
  p_results       jsonb
) RETURNS public.inv_stock_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item        public.inv_stock_item%ROWTYPE;
  v_res         jsonb;
  v_template    public.inv_test_template%ROWTYPE;
  v_required    integer;
  v_req_passed  integer;
  v_req_failed  integer;
  v_adv_failed  integer;
  v_target      public.inv_stock_status;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to record QC results.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_item FROM public.inv_stock_item WHERE id = p_stock_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Stock item % not found.', p_stock_item_id USING ERRCODE = 'no_data_found';
  END IF;

  ------------------------------------------------------- record each result
  FOR v_res IN SELECT * FROM jsonb_array_elements(COALESCE(p_results, '[]'::jsonb))
  LOOP
    SELECT * INTO v_template
      FROM public.inv_test_template
     WHERE id = (v_res->>'template_id')::uuid;

    IF v_template.id IS NULL THEN
      RAISE EXCEPTION 'QC template % does not exist.', v_res->>'template_id'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NOT v_template.is_active THEN
      RAISE EXCEPTION 'QC template "%" is not active.', v_template.name
        USING ERRCODE = 'check_violation';
    END IF;

    -- The test must belong to this product's checklist, or be a global test.
    IF v_template.product_id IS NOT NULL
       AND v_template.product_id <> v_item.product_id THEN
      RAISE EXCEPTION
        'QC template "%" belongs to a different product and does not apply to serial %.',
        v_template.name, v_item.serial
        USING ERRCODE = 'check_violation';
    END IF;

    IF (v_res->>'result') IS NULL THEN
      RAISE EXCEPTION 'QC result for "%" must say pass or fail.', v_template.name
        USING ERRCODE = 'null_value_not_allowed';
    END IF;

    IF v_template.requires_value
       AND COALESCE(trim(v_res->>'value'), '') = '' THEN
      RAISE EXCEPTION 'QC test "%" requires a measured value.', v_template.name
        USING ERRCODE = 'null_value_not_allowed';
    END IF;

    IF v_template.requires_attachment
       AND COALESCE(jsonb_array_length(COALESCE(v_res->'attachments', '[]'::jsonb)), 0) = 0 THEN
      RAISE EXCEPTION 'QC test "%" requires at least one attachment.', v_template.name
        USING ERRCODE = 'null_value_not_allowed';
    END IF;

    INSERT INTO public.inv_test_result (
      stock_item_id, template_id, result, value, notes, attachments, tested_by
    ) VALUES (
      p_stock_item_id, v_template.id, (v_res->>'result')::boolean,
      v_res->>'value', v_res->>'notes',
      COALESCE(v_res->'attachments', '[]'::jsonb), auth.uid()
    );
  END LOOP;

  ------------------------------------------------- evaluate the whole checklist
  -- Latest result per applicable template.
  WITH applicable AS (
    SELECT t.id, t.is_required
      FROM public.inv_test_template t
     WHERE t.is_active
       AND (t.product_id = v_item.product_id OR t.product_id IS NULL)
  ),
  latest AS (
    SELECT DISTINCT ON (r.template_id) r.template_id, r.result
      FROM public.inv_test_result r
     WHERE r.stock_item_id = p_stock_item_id
     ORDER BY r.template_id, r.tested_at DESC, r.id DESC
  )
  SELECT
    count(*) FILTER (WHERE a.is_required),
    count(*) FILTER (WHERE a.is_required     AND l.result IS TRUE),
    count(*) FILTER (WHERE a.is_required     AND l.result IS FALSE),
    count(*) FILTER (WHERE NOT a.is_required AND l.result IS FALSE)
    INTO v_required, v_req_passed, v_req_failed, v_adv_failed
    FROM applicable a
    LEFT JOIN latest l ON l.template_id = a.id;

  v_target :=
    CASE
      WHEN v_req_failed > 0            THEN 'rejected'
      WHEN v_req_passed < v_required   THEN 'quarantined'   -- incomplete
      WHEN v_adv_failed > 0            THEN 'attention'
      ELSE                                  'ok'
    END::public.inv_stock_status;

  -- Do not resurrect a unit that has already been destroyed or lost.
  IF v_item.status IN ('destroyed','lost') THEN
    RETURN v_item.status;
  END IF;

  IF v_target <> v_item.status THEN
    UPDATE public.inv_stock_item
       SET status = v_target, updated_at = now()
     WHERE id = p_stock_item_id;
  END IF;

  RETURN v_target;
END $$;

COMMENT ON FUNCTION public.inv_record_qc_results IS
  'The QC gate. Records results against the product checklist and sets the unit status: ok when every required test passed, attention when an advisory test failed, rejected when a required test failed, quarantined while the checklist is incomplete. Only this promotes a unit out of quarantine.';


-- =====================================================================
-- ORCHESTRATOR - complete a receipt
-- =====================================================================

CREATE OR REPLACE FUNCTION public.inv_complete_receipt(
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_op       public.inv_operation%ROWTYPE;
  v_kind     public.inv_operation_kind;
  v_move     record;
  v_units    integer;
  v_quar     integer;
  v_state    public.inv_operation_state;
  v_po_state public.inv_order_state;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to complete a receipt.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_op FROM public.inv_operation WHERE id = p_operation_id FOR UPDATE;
  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Operation % not found.', p_operation_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT ot.kind INTO v_kind
    FROM public.inv_operation_type ot WHERE ot.id = v_op.operation_type_id;

  IF v_kind <> 'receipt'::public.inv_operation_kind THEN
    RAISE EXCEPTION 'Operation % is a % operation, not a receipt.', v_op.number, v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_op.state = 'cancelled' THEN
    RAISE EXCEPTION 'Receipt % is cancelled and cannot be completed.', v_op.number
      USING ERRCODE = 'check_violation';
  END IF;

  FOR v_move IN
    SELECT m.id,
           (SELECT count(*) FROM public.inv_move_line ml WHERE ml.move_id = m.id) AS lines
      FROM public.inv_move m
     WHERE m.operation_id = p_operation_id
       AND m.state NOT IN ('done','cancelled')
  LOOP
    IF v_move.lines > 0 THEN
      PERFORM public.inv_apply_move_state(v_move.id, 'done'::public.inv_move_state);
    END IF;
  END LOOP;

  v_state := public.inv_derive_operation_state(p_operation_id);

  IF v_op.source_purchase_order_id IS NOT NULL THEN
    v_po_state := public.inv_sync_purchase_order_progress(v_op.source_purchase_order_id);
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE si.status = 'quarantined')
    INTO v_units, v_quar
    FROM public.inv_move_line ml
    JOIN public.inv_move       m  ON m.id  = ml.move_id
    JOIN public.inv_stock_item si ON si.id = ml.stock_item_id
   WHERE m.operation_id = p_operation_id;

  RETURN jsonb_build_object(
    'operation',            v_op.number,
    'operation_state',      v_state,
    'units_received',       v_units,
    'units_awaiting_qc',    v_quar,
    'purchase_order_state', v_po_state);
END $$;

COMMENT ON FUNCTION public.inv_complete_receipt IS
  'Completes a receipt: marks moves with units done, derives the document state, syncs the purchase order. Reports how many units are still awaiting QC. Idempotent.';


-- =====================================================================
-- GRANTS
-- =====================================================================

GRANT EXECUTE ON FUNCTION public.inv_receive_serial(uuid, text, numeric, public.inv_stock_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_receive_serials(uuid, text[], numeric, public.inv_stock_status)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_record_qc_results(uuid, jsonb)                                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_complete_receipt(uuid)                                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_derive_operation_state(uuid)                                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_sync_purchase_order_progress(uuid)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_apply_move_state(uuid, public.inv_move_state)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_apply_operation_state(uuid, public.inv_operation_state)             TO authenticated;


-- =====================================================================
-- NOT IN THIS STEP
-- =====================================================================
-- * Delivery, internal transfer and adjustment workflows.
-- * Re-quarantining a unit after it has been promoted (a recall path).
-- * Any frontend - Part 2.

COMMIT;
