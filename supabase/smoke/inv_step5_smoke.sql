-- =====================================================================
-- INVENTORY RESET — STEP 5 SMOKE SUITE
-- =====================================================================
--
-- NON-DESTRUCTIVE. The whole run is one transaction that ends in ROLLBACK.
-- Nothing it creates survives. It bumps number sequences during the run and
-- those roll back too — which is itself one of the things under test.
--
-- Run AFTER the Step 5 migration is applied:
--   supabase db query --linked --file supabase/smoke/inv_step5_smoke.sql
--
-- Reads as a table: one row per test, with PASS/FAIL and what actually
-- happened. A FAIL is a fact, not an opinion — read the `actual` column.
--
-- Impersonation note: run via psql the connection is superuser and
-- auth.uid() is NULL, so can_write_inventory() would be false and every RPC
-- would refuse. The suite sets request.jwt.claims to the super_admin, exactly
-- as supabase/seed/inv_seed_step4.sql does.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE smoke (
  id       int,
  name     text,
  expected text,
  actual   text,
  pass     boolean
) ON COMMIT DROP;

DO $smoke$
DECLARE
  v_admin   uuid := '02fb2319-d5e3-4fb8-894e-40bacf614f3c';
  v_wh_user uuid;
  v_prod    uuid;
  v_prod2   uuid;
  v_ot_rcp  uuid;
  v_ot_int  uuid;
  v_seq_id  uuid;
  v_before  integer;
  v_after   integer;
  v_gdn     uuid;
  v_stk     uuid;
  v_res     jsonb;
  v_op      uuid;
  v_op2     uuid;
  v_move    uuid;
  v_po      uuid;
  v_rq      integer;
  v_state   text;
  v_actual  text;
  v_deleted integer;
BEGIN
  PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_admin::text)::text, true);

  SELECT id INTO v_prod FROM public.products ORDER BY created_at LIMIT 1;
  SELECT id INTO v_prod2 FROM public.products ORDER BY created_at OFFSET 1 LIMIT 1;
  SELECT id INTO v_ot_rcp FROM public.inv_operation_type WHERE kind='receipt' LIMIT 1;
  SELECT id INTO v_ot_int FROM public.inv_operation_type WHERE kind='internal' LIMIT 1;
  SELECT id INTO v_gdn FROM public.inv_location WHERE code='GDN110';
  SELECT id INTO v_stk FROM public.inv_location WHERE code='STK103';
  SELECT sequence_id INTO v_seq_id FROM public.inv_operation_type WHERE id=v_ot_rcp;

  ---------------------------------------------------------------- 1
  -- create receipt: number allocated, dest forced to the type default,
  -- client-supplied dest ignored.
  v_res := public.inv_create_receipt(
             p_operation_type_id => v_ot_rcp,
             p_source_document   => 'SMOKE-1',
             p_dest_location_id  => v_stk);      -- deliberately WRONG dest
  v_op := (v_res->>'id')::uuid;

  INSERT INTO smoke VALUES (1, 'create: number allocated',
    'matches RCP/<fy>/nnnn', v_res->>'number',
    (v_res->>'number') ~ '^RCP/[0-9]{4}/[0-9]{4}$');

  INSERT INTO smoke VALUES (2, 'create: dest forced to type default (GDN110), client value ignored',
    v_gdn::text, v_res->>'dest_location_id',
    (v_res->>'dest_location_id')::uuid = v_gdn);

  INSERT INTO smoke VALUES (3, 'create: reports that it ignored the client destination',
    'destination_locked=true, client_destination_ignored=true',
    format('destination_locked=%s, client_destination_ignored=%s',
           v_res->>'destination_locked', v_res->>'client_destination_ignored'),
    (v_res->>'destination_locked')::boolean
      AND (v_res->>'client_destination_ignored')::boolean);

  ---------------------------------------------------------------- 2
  -- number not burnt when the insert fails.
  SELECT current_number INTO v_before FROM public.inv_number_sequence WHERE id=v_seq_id;
  BEGIN
    -- non-existent PO -> FK violation on the INSERT, i.e. AFTER allocation
    PERFORM public.inv_create_receipt(
              p_operation_type_id => v_ot_rcp,
              p_purchase_order_id => '00000000-0000-0000-0000-000000000000'::uuid);
    v_actual := 'no error raised';
  EXCEPTION WHEN OTHERS THEN
    v_actual := 'raised: ' || SQLERRM;
  END;
  SELECT current_number INTO v_after FROM public.inv_number_sequence WHERE id=v_seq_id;

  INSERT INTO smoke VALUES (4, 'create: failed insert does not burn the number',
    format('counter stays at %s', v_before),
    format('counter=%s (%s)', v_after, v_actual),
    v_after = v_before);

  ---------------------------------------------------------------- 3
  -- non-receipt operation type rejected.
  BEGIN
    PERFORM public.inv_create_receipt(p_operation_type_id => v_ot_int);
    v_actual := 'no error raised';
  EXCEPTION WHEN OTHERS THEN
    v_actual := SQLERRM;
  END;
  INSERT INTO smoke VALUES (5, 'create: non-receipt operation type rejected',
    'raises "creates receipts only"', v_actual,
    v_actual ILIKE '%receipts only%');

  ---------------------------------------------------------------- 4
  -- add line, then remove it.
  v_move := public.inv_add_receipt_line(v_op, v_prod, 5);
  SELECT state::text INTO v_state FROM public.inv_operation WHERE id=v_op;
  INSERT INTO smoke VALUES (6, 'add line: operation moves draft -> ready',
    'ready', v_state, v_state = 'ready');

  -- upsert semantics: same product again updates demand, no duplicate line
  PERFORM public.inv_add_receipt_line(v_op, v_prod, 9);
  SELECT count(*)::int INTO v_deleted FROM public.inv_move
   WHERE operation_id=v_op AND state <> 'cancelled';
  SELECT demand_qty INTO v_before FROM public.inv_move WHERE id=v_move;
  INSERT INTO smoke VALUES (7, 'add line: same product upserts (1 line, demand 9)',
    '1 line / demand 9', format('%s line(s) / demand %s', v_deleted, v_before),
    v_deleted = 1 AND v_before = 9);

  ---------------------------------------------------------------- 5
  -- remove line refused when the move already has units.
  PERFORM public.inv_receive_serial(v_move, 'SMOKE-SERIAL-0001', 100);
  BEGIN
    PERFORM public.inv_remove_receipt_line(v_move);
    v_actual := 'no error raised';
  EXCEPTION WHEN OTHERS THEN
    v_actual := SQLERRM;
  END;
  INSERT INTO smoke VALUES (8, 'remove line: refused once units received',
    'raises "cannot be removed"', v_actual,
    v_actual ILIKE '%cannot be removed%');

  ---------------------------------------------------------------- 6
  -- cancel refused when units exist (this op now has 1 unit).
  BEGIN
    PERFORM public.inv_cancel_receipt(v_op);
    v_actual := 'no error raised';
  EXCEPTION WHEN OTHERS THEN
    v_actual := SQLERRM;
  END;
  INSERT INTO smoke VALUES (9, 'cancel: refused when units received (full message)',
    'raises, names the count and the alternative', v_actual,
    v_actual ILIKE '%cannot be cancelled%'
      AND v_actual ILIKE '%1 unit(s)%'
      AND v_actual ILIKE '%stock adjustment%');

  ---------------------------------------------------------------- 7
  -- add/remove refused on a DONE operation.
  PERFORM public.inv_complete_receipt(v_op);
  SELECT state::text INTO v_state FROM public.inv_operation WHERE id=v_op;

  BEGIN
    PERFORM public.inv_add_receipt_line(v_op, v_prod, 1);
    v_actual := 'no error raised';
  EXCEPTION WHEN OTHERS THEN
    v_actual := SQLERRM;
  END;
  INSERT INTO smoke VALUES (10, format('add line: refused on done op (state=%s)', v_state),
    'raises "can no longer be edited"', v_actual,
    v_actual ILIKE '%no longer be edited%');

  BEGIN
    PERFORM public.inv_remove_receipt_line(v_move);
    v_actual := 'no error raised';
  EXCEPTION WHEN OTHERS THEN
    v_actual := SQLERRM;
  END;
  INSERT INTO smoke VALUES (11, 'remove line: refused on done op',
    'raises "can no longer be edited"', v_actual,
    v_actual ILIKE '%no longer be edited%');

  -- cancel refused on done
  BEGIN
    PERFORM public.inv_cancel_receipt(v_op);
    v_actual := 'no error raised';
  EXCEPTION WHEN OTHERS THEN
    v_actual := SQLERRM;
  END;
  INSERT INTO smoke VALUES (12, 'cancel: refused on done op',
    'raises "is done and cannot be cancelled"', v_actual,
    v_actual ILIKE '%cannot be cancelled%');

  ---------------------------------------------------------------- 8
  -- cancel succeeds with no units; moves cancelled; then edits refused.
  v_res := public.inv_create_receipt(
             p_operation_type_id => v_ot_rcp, p_source_document => 'SMOKE-2');
  v_op2 := (v_res->>'id')::uuid;
  v_move := public.inv_add_receipt_line(v_op2, v_prod, 3);

  v_res := public.inv_cancel_receipt(v_op2);
  SELECT state::text INTO v_state FROM public.inv_operation WHERE id=v_op2;
  SELECT count(*)::int INTO v_deleted FROM public.inv_move
   WHERE operation_id=v_op2 AND state='cancelled';

  INSERT INTO smoke VALUES (13, 'cancel: succeeds with no units, op + moves cancelled',
    'op=cancelled, 1 move cancelled',
    format('op=%s, %s move(s) cancelled', v_state, v_deleted),
    v_state='cancelled' AND v_deleted=1);

  BEGIN
    PERFORM public.inv_add_receipt_line(v_op2, v_prod, 1);
    v_actual := 'no error raised';
  EXCEPTION WHEN OTHERS THEN
    v_actual := SQLERRM;
  END;
  INSERT INTO smoke VALUES (14, 'add line: refused on cancelled op',
    'raises "can no longer be edited"', v_actual,
    v_actual ILIKE '%no longer be edited%');

  ---------------------------------------------------------------- 9
  -- the received_qty leak: a cancelled operation's units stop counting.
  INSERT INTO public.inv_purchase_order (number, state, ordered_at, created_by, notes)
  VALUES ('SMOKE-PO-1', 'confirmed', now(), v_admin, 'smoke fixture')
  RETURNING id INTO v_po;

  INSERT INTO public.inv_purchase_order_line (order_id, product_id, ordered_qty)
  VALUES (v_po, v_prod, 5);

  v_res := public.inv_create_receipt(
             p_operation_type_id => v_ot_rcp,
             p_purchase_order_id => v_po,
             p_source_document   => 'SMOKE-PO-1');
  v_op2 := (v_res->>'id')::uuid;
  v_move := public.inv_add_receipt_line(v_op2, v_prod, 5);

  PERFORM public.inv_receive_serial(v_move, 'SMOKE-SERIAL-1001', 10);
  PERFORM public.inv_receive_serial(v_move, 'SMOKE-SERIAL-1002', 10);

  PERFORM public.inv_sync_purchase_order_progress(v_po);
  SELECT received_qty INTO v_rq FROM public.inv_purchase_order_line WHERE order_id=v_po;
  INSERT INTO smoke VALUES (15, 'PO sync: live receipt units DO count',
    '2', v_rq::text, v_rq = 2);

  -- Cancel the operation directly. The RPC would refuse (units exist), and
  -- that refusal is exactly what test 9 proves; here we construct the bad
  -- state deliberately to prove the sync filter is what excludes it.
  UPDATE public.inv_operation SET state='cancelled' WHERE id=v_op2;

  PERFORM public.inv_sync_purchase_order_progress(v_po);
  SELECT received_qty INTO v_rq FROM public.inv_purchase_order_line WHERE order_id=v_po;
  INSERT INTO smoke VALUES (16, 'PO sync: CANCELLED operation units EXCLUDED (the fix)',
    '0', v_rq::text, v_rq = 0);

  ---------------------------------------------------------------- 10
  -- the DELETE-policy blocker, in two parts.
  --
  -- (a) Prove the blocker is real: as a non-admin authenticated caller, a
  --     direct DELETE on inv_move is filtered out by the is_admin() policy.
  v_res := public.inv_create_receipt(
             p_operation_type_id => v_ot_rcp, p_source_document => 'SMOKE-3');
  v_op2 := (v_res->>'id')::uuid;
  v_move := public.inv_add_receipt_line(v_op2, v_prod, 1);

  SELECT user_id INTO v_wh_user
    FROM public.user_roles WHERE role='warehouse_operator'::app_role LIMIT 1;

  BEGIN
    PERFORM set_config('request.jwt.claims',
            json_build_object('sub', gen_random_uuid()::text)::text, true);
    SET LOCAL ROLE authenticated;
    DELETE FROM public.inv_move WHERE id = v_move;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RESET ROLE;
    v_actual := format('%s row(s) deleted', v_deleted);
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_actual := 'raised: ' || SQLERRM;
    v_deleted := -1;
  END;
  PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_admin::text)::text, true);

  INSERT INTO smoke VALUES (17, 'RLS: direct DELETE on inv_move blocked for non-admin',
    '0 rows deleted', v_actual, v_deleted = 0);

  -- (b) Prove the RPC gets through it as a real warehouse_operator.
  IF v_wh_user IS NULL THEN
    INSERT INTO smoke VALUES (18,
      'RPC: remove line works for a warehouse_operator',
      'line removed',
      'SKIPPED — no user holds warehouse_operator; see header note',
      NULL);
  ELSE
    BEGIN
      PERFORM set_config('request.jwt.claims',
              json_build_object('sub', v_wh_user::text)::text, true);
      SET LOCAL ROLE authenticated;
      PERFORM public.inv_remove_receipt_line(v_move);
      RESET ROLE;
      v_actual := 'removed';
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_actual := 'raised: ' || SQLERRM;
    END;
    PERFORM set_config('request.jwt.claims',
            json_build_object('sub', v_admin::text)::text, true);

    SELECT count(*)::int INTO v_deleted FROM public.inv_move WHERE id=v_move;
    INSERT INTO smoke VALUES (18,
      'RPC: remove line works for a warehouse_operator (bypasses is_admin DELETE policy)',
      'line removed', format('%s (%s row(s) remain)', v_actual, v_deleted),
      v_actual='removed' AND v_deleted=0);
  END IF;

END $smoke$;

SELECT id,
       CASE WHEN pass IS NULL THEN 'SKIP' WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result,
       name, expected, actual
  FROM smoke ORDER BY id;

SELECT count(*) FILTER (WHERE pass)            AS passed,
       count(*) FILTER (WHERE pass IS FALSE)   AS failed,
       count(*) FILTER (WHERE pass IS NULL)    AS skipped
  FROM smoke;

ROLLBACK;
