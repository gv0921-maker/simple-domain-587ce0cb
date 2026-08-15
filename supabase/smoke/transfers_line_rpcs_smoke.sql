-- =====================================================================
-- INTERNAL TRANSFERS — smoke suite for inv_add_operation_line /
-- inv_remove_operation_line and the two receipt wrappers.
--
-- Runs against the APPLIED functions, then ROLLS BACK.
--
-- WHY THE JWT CLAIM IS SET FIRST, AND WHY TEST 0 EXISTS:
-- every RPC here opens with `IF NOT can_write_inventory()`, which reads
-- auth.uid(). Run as postgres that is NULL, so EVERY call would be refused at
-- the permission gate and no guard under test would ever be reached —
-- CLAUDE.md TESTING, failure mode 2, exactly. Test 0 proves the permission is
-- satisfied, so every refusal below is attributable to the guard under test.
--
-- EVERY REFUSAL ASSERTS ITS OWN FULL MESSAGE TEXT, not a SQLSTATE. Both
-- functions can refuse for four different reasons (permission, not found,
-- kind, state, units-exist) and several share SQLSTATE 'check_violation', so
-- a bare "it was refused" would prove nothing — CLAUDE.md TESTING, the Pass A
-- failure. Each refusal is also paired with a POSITIVE CONTROL that differs in
-- exactly one respect, so the refusal is attributable to that one thing.
--
-- Fixtures are PASSLT-* and referenced by nothing else.
-- Every assertion records the ACTUAL value it saw.
-- =====================================================================
BEGIN;

SELECT set_config('request.jwt.claims',
                  '{"sub":"02fb2319-d5e3-4fb8-894e-40bacf614f3c"}', true);

CREATE TEMP TABLE plt(n int, test text, passed boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  v_t_internal   uuid;
  v_int_id       uuid;  v_int_num text;
  v_rcp_ready    uuid;  v_rcp_ready_num text;   v_rcp_ready_move uuid;
  v_rcp_done     uuid;  v_rcp_done_num  text;
  v_product      uuid;
  v_move         uuid;  v_move2 uuid;
  v_unit         uuid;  v_unit_loc uuid;  v_unit_status text;
  v_res          jsonb;
  v_msg          text;
  v_ok           boolean;
  v_qty          integer;
  v_cnt          integer;
BEGIN
  ------------------------------------------------------------------ 0. control
  SELECT public.can_write_inventory() INTO v_ok;
  INSERT INTO plt VALUES (0,
    'CONTROL: can_write_inventory() is TRUE, so every refusal below is the guard under test and not the permission gate',
    v_ok IS TRUE, format('can_write_inventory=%s', v_ok));

  ------------------------------------------------------------------ fixtures
  SELECT id INTO v_t_internal FROM public.inv_operation_type WHERE name = 'ITEM ESTIMATE';

  SELECT id, number INTO v_rcp_ready, v_rcp_ready_num
    FROM public.inv_operation WHERE number = 'RCP/2627/0006';
  SELECT id INTO v_rcp_ready_move
    FROM public.inv_move WHERE operation_id = v_rcp_ready LIMIT 1;

  SELECT id, number INTO v_rcp_done, v_rcp_done_num
    FROM public.inv_operation WHERE number = 'RCP/2627/0001';

  SELECT product_id INTO v_product FROM public.inv_move WHERE id = v_rcp_ready_move;

  -- A quarantined unit ON PURPOSE. Moving one is not an error and the transfer
  -- adapter deliberately does not filter by status (CLAUDE.md) — test 9 proves
  -- the database agrees.
  SELECT id, location_id, status::text INTO v_unit, v_unit_loc, v_unit_status
    FROM public.inv_stock_item WHERE serial = 'PASS7-PREVIEW-0004';

  ------------------------------------------------- 1. an internal op exists
  v_res := public.inv_create_operation(
             p_operation_type_id => v_t_internal,
             p_source_document   => 'PASSLT-FIXTURE');
  v_int_id  := (v_res->>'id')::uuid;
  v_int_num := v_res->>'number';
  INSERT INTO plt VALUES (1,
    'FIXTURE: inv_create_operation raises an internal document',
    v_int_id IS NOT NULL, format('number=%s', v_int_num));

  ------------------------------------ 2. THE THING THAT WAS IMPOSSIBLE BEFORE
  -- Also the positive control for test 3: same document, same product, same
  -- quantity — the ONLY difference in 3 is which entry point is called.
  v_move := public.inv_add_operation_line(v_int_id, v_product, 2);
  INSERT INTO plt VALUES (2,
    'inv_add_operation_line ADDS A LINE TO AN INTERNAL DOCUMENT (this was impossible before: inv_add_receipt_line refused it, so a transfer could never get an inv_move)',
    v_move IS NOT NULL, format('move_id=%s', v_move));

  ------------------------------------------------ 3. the wrapper still refuses
  BEGIN
    PERFORM public.inv_add_receipt_line(v_int_id, v_product, 2);
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO plt VALUES (3,
    'inv_add_receipt_line still refuses the internal document, with its wording VERBATIM (positive control: test 2 added a line to this very document)',
    v_msg = format('Operation %s is a internal operation, not a receipt.', v_int_num),
    format('got: %s', v_msg));

  ------------------------------------------- 4. the wrapper still WORKS
  v_move2 := public.inv_add_receipt_line(v_rcp_ready, v_product, 5);
  INSERT INTO plt VALUES (4,
    'inv_add_receipt_line still adds a line to a receipt (upserts by product, so this updates RCP/2627/0006''s existing move)',
    v_move2 = v_rcp_ready_move, format('move_id=%s expected=%s', v_move2, v_rcp_ready_move));

  --------------------------------------------- 5. DEFAULT 1 preserved
  -- The first attempt at this migration dropped `p_demand_qty integer DEFAULT 1`
  -- and Postgres refused the whole file. This asserts the default is back:
  -- called with TWO arguments, the third must resolve to 1.
  PERFORM public.inv_add_receipt_line(v_rcp_ready, v_product);
  SELECT demand_qty INTO v_qty FROM public.inv_move WHERE id = v_rcp_ready_move;
  INSERT INTO plt VALUES (5,
    'inv_add_receipt_line''s DEFAULT 1 on p_demand_qty survives: a two-argument call sets demand to 1',
    v_qty = 1, format('demand_qty=%s', v_qty));

  ------------------------------------------- 6. generic remove works
  -- Positive control for test 7: same move, only the entry point differs.
  v_move := public.inv_add_operation_line(v_int_id, v_product, 2);
  v_res  := public.inv_remove_operation_line(v_move);
  SELECT count(*) INTO v_cnt FROM public.inv_move WHERE id = v_move;
  INSERT INTO plt VALUES (6,
    'inv_remove_operation_line removes an unprocessed line from an INTERNAL document',
    v_cnt = 0 AND v_res->>'kind' = 'internal',
    format('rows_left=%s kind=%s', v_cnt, v_res->>'kind'));

  ------------------------------------------ 7. remove wrapper still refuses
  v_move := public.inv_add_operation_line(v_int_id, v_product, 2);
  BEGIN
    PERFORM public.inv_remove_receipt_line(v_move);
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO plt VALUES (7,
    'inv_remove_receipt_line still refuses an internal line, wording VERBATIM (positive control: test 6 removed exactly this kind of line through the generic function)',
    v_msg = format('Operation %s is a internal operation, not a receipt.', v_int_num),
    format('got: %s', v_msg));

  ----------------------------- 8. RECEIPT WORDING IS BYTE-IDENTICAL, from the
  -----------------------------    GENERIC function, on the done-state guard
  BEGIN
    PERFORM public.inv_add_operation_line(v_rcp_done, v_product, 1);
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO plt VALUES (8,
    'The GENERIC function still calls a receipt a "Receipt": the done-state refusal is byte-identical to what inv_add_receipt_line raised before this migration',
    v_msg = format('Receipt %s is done and can no longer be edited.', v_rcp_done_num),
    format('got: %s', v_msg));

  ------------------------ 8b. positive control for 8, isolating the STATE guard
  -- Same function, same kind, same product. ONLY the document's state differs,
  -- so test 8's refusal cannot have come from anything but the state guard.
  v_move2 := public.inv_add_operation_line(v_rcp_ready, v_product, 1);
  INSERT INTO plt VALUES (81,
    'CONTROL for 8: the same generic function accepts a receipt that is NOT done, so 8''s refusal is the state guard and not the kind or the function',
    v_move2 IS NOT NULL, format('move_id=%s state=ready', v_move2));

  --------------------- 9. units-exist guard, INTERNAL verb — and a real move
  v_move := public.inv_add_operation_line(v_int_id, v_product, 2);
  PERFORM public.inv_transfer_stock_item(
            p_stock_item_id             => v_unit,
            p_move_id                   => v_move,
            -- The unit's OWN location, never the document's source. See the
            -- rule at the top of scan.ts.
            p_expected_from_location_id => v_unit_loc,
            p_to_location_id            => (SELECT dest_location_id FROM public.inv_operation WHERE id = v_int_id),
            p_document_type             => 'inv_operation',
            p_document_id               => v_int_id,
            p_entry_type                => 'internal');
  INSERT INTO plt VALUES (9,
    format('A QUARANTINED unit (%s) moves onto a transfer without complaint — status is not a barrier to relocation, which is what the transfer adapter assumes', v_unit_status),
    true, format('unit=%s status=%s', v_unit, v_unit_status));

  BEGIN
    PERFORM public.inv_remove_operation_line(v_move);
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO plt VALUES (10,
    'units-exist guard on an INTERNAL line says "moved", not "received" (positive control: test 6 removed an internal line with NO units through this same function, so this refusal is the units guard)',
    v_msg = 'This line has 1 unit(s) already moved and cannot be removed. Moved units leave the document only by reversal, which is not implemented yet.',
    format('got: %s', v_msg));

  ------------- 11. units-exist guard, RECEIPT verb — byte-identical to before
  BEGIN
    PERFORM public.inv_remove_operation_line(v_rcp_ready_move);
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO plt VALUES (11,
    'units-exist guard on a RECEIPT line still says "received" / "Received units" — byte-identical to what inv_remove_receipt_line raised before this migration',
    v_msg = 'This line has 1 unit(s) already received and cannot be removed. Received units leave the document only by reversal, which is not implemented yet.',
    format('got: %s', v_msg));
END $$;

-- Detail and summary in ONE result set: the CLI returns only the last one, and
-- a bare pass count is not evidence — each row records the value it actually
-- saw, which is what makes a green run checkable.
SELECT n::text AS n,
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,
       test,
       detail
  FROM plt
UNION ALL
SELECT 'ZZ',
       CASE WHEN count(*) FILTER (WHERE NOT passed) = 0 THEN 'ALL PASS' ELSE 'FAILURES' END,
       format('%s passed, %s failed, %s total',
              count(*) FILTER (WHERE passed),
              count(*) FILTER (WHERE NOT passed),
              count(*)),
       ''
  FROM plt
 ORDER BY 1;

ROLLBACK;
