-- =====================================================================
-- SERIAL GENERATION — smoke suite for 20260822090000.
--
-- Runs against the APPLIED objects, then ROLLS BACK.
--
-- WHY THE JWT CLAIM IS SET FIRST: every RPC here opens with
-- `IF NOT can_write_inventory()`, which reads auth.uid(). Run as postgres that
-- is NULL, so every call would be refused at the permission gate and no guard
-- under test would ever be reached — CLAUDE.md TESTING, failure mode 2.
-- Test 0 proves the permission is satisfied before anything else runs.
--
-- THE SUITE'S REAL JOB IS TESTS 1-4. The new behaviour is the easy half; the
-- risk in this migration is the REPLACEMENT of inv_receive_serial, whose four
-- pre-existing branches must be byte-identical:
--     B1 serial exists on another document          -> refuse, ORIGINAL text
--     B2 same document, already on this move        -> clean re-run, no writes
--     B3 same document, not on this move            -> resume the transfer
--     B4 unknown serial                             -> create + transfer
-- If any of those four has shifted, that is a STOP, not a test to adjust.
--
-- EVERY REFUSAL ASSERTS ITS OWN MESSAGE IDENTITY, never a bare SQLSTATE.
-- inv_receive_serial can now refuse for TWELVE distinct reasons and SEVEN of
-- them share ERRCODE 'check_violation' (not a receipt / already done / no
-- locations / voided / consumed-anomaly / another document / another line),
-- so "it was refused" proves nothing — CLAUDE.md TESTING, the Pass A failure
-- verbatim. Each refusal below matches its own sentence.
--
-- Fixtures are PASSSG-* on a product created here and referenced by nothing
-- else, so the serial namespace under test is clean and no other constraint
-- can produce the refusals being attributed to the guards.
-- Every assertion records the ACTUAL value it saw.
-- =====================================================================
BEGIN;

SELECT set_config('request.jwt.claims',
                  '{"sub":"02fb2319-d5e3-4fb8-894e-40bacf614f3c"}', true);

CREATE TEMP TABLE rt(n int, test text, passed boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  -- reference data
  l_vendors uuid; l_godown uuid;
  t_rcp uuid; t_int uuid;
  origin_rcp uuid;
  -- fixture products
  p_sg uuid; p_sg2 uuid;
  -- documents
  d_a uuid; d_b uuid; d_c uuid; d_d uuid; d_int uuid;
  m_a uuid; m_a2 uuid; m_b uuid; m_c uuid; m_d uuid; m_int uuid;
  -- scratch
  v_msg text; v_ok boolean; v_cnt int; v_cnt2 int;
  v_id uuid; v_id2 uuid; v_uuid uuid;
  v_txt text; v_txt2 text; v_txt3 text;
  v_ser text[]; v_n int;
  v_ml_before int; v_tr_before int; v_ml_after int; v_tr_after int;
  v_ts timestamptz; v_ts2 timestamptz;
  v_pid uuid; v_pid2 uuid;
BEGIN
  ------------------------------------------------------------------ 0. control
  SELECT public.can_write_inventory() INTO v_ok;
  INSERT INTO rt VALUES (0,
    'CONTROL: can_write_inventory() is TRUE, so every refusal below is a guard under test and not the permission gate',
    v_ok IS TRUE, format('can_write_inventory=%s', v_ok));

  ------------------------------------------------------------------ fixtures
  SELECT id INTO l_vendors FROM public.inv_location WHERE name='VENDORS';
  SELECT id INTO l_godown  FROM public.inv_location WHERE name='GODOWN';
  SELECT id INTO t_rcp FROM public.inv_operation_type WHERE name='GOODS RECEIVED';
  SELECT id INTO t_int FROM public.inv_operation_type WHERE name='ITEM ESTIMATE';
  SELECT id INTO origin_rcp FROM public.inv_operation WHERE number='RCP/2627/0001';

  INSERT INTO public.products (sku, name) VALUES ('PASSSG','PASSSG serial fixture')
    RETURNING id INTO p_sg;
  INSERT INTO public.products (sku, name) VALUES ('PASSSG2','PASSSG second-line fixture')
    RETURNING id INTO p_sg2;

  d_a   := (public.inv_create_operation(p_operation_type_id => t_rcp))->>'id';
  d_b   := (public.inv_create_operation(p_operation_type_id => t_rcp))->>'id';
  d_c   := (public.inv_create_operation(p_operation_type_id => t_rcp))->>'id';
  d_d   := (public.inv_create_operation(p_operation_type_id => t_rcp))->>'id';
  d_int := (public.inv_create_operation(p_operation_type_id => t_int))->>'id';

  m_a   := public.inv_add_operation_line(d_a,   p_sg,  50);
  m_a2  := public.inv_add_operation_line(d_a,   p_sg2, 10);
  m_b   := public.inv_add_operation_line(d_b,   p_sg,  10);
  m_c   := public.inv_add_operation_line(d_c,   p_sg,  10);
  m_d   := public.inv_add_operation_line(d_d,   p_sg,  10);
  m_int := public.inv_add_operation_line(d_int, p_sg,  10);

  -- =================================================================
  -- TESTS 1-4 : THE FOUR PRE-EXISTING inv_receive_serial BRANCHES.
  -- These are the point of the suite.
  -- =================================================================

  ---------------------------------------------------------------- 1. B1
  -- A unit that exists and was received on ANOTHER document. The message must
  -- come back byte-identical to the pre-migration text, including its
  -- 'unique_violation' errcode which no other refusal here uses.
  INSERT INTO public.inv_stock_item (product_id, serial, location_id, status, origin_operation_id, cost)
  VALUES (p_sg,'PASSSG-B1-OTHERDOC',l_godown,'ok',origin_rcp,0);

  BEGIN
    PERFORM public.inv_receive_serial(m_a, 'PASSSG-B1-OTHERDOC');
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (1,
    'B1 UNCHANGED: serial on another document refuses with the ORIGINAL sentence',
    v_msg = 'Serial PASSSG-B1-OTHERDOC already exists and was received on a different document. Serials are globally unique.',
    v_msg);

  ---------------------------------------------------------------- 2. B2
  -- Clean re-run. Receive once, then again: same id back, and NOTHING written
  -- the second time. Counting move lines AND ledger rows is the assertion —
  -- returning the right id while writing a duplicate would still be a bug.
  v_id := public.inv_receive_serial(m_a, 'PASSSG-B2-RERUN');
  SELECT count(*) INTO v_ml_before FROM public.inv_move_line WHERE move_id = m_a;
  SELECT count(*) INTO v_tr_before FROM public.inv_stock_tracking st
    JOIN public.inv_stock_item si ON si.id = st.stock_item_id WHERE si.serial='PASSSG-B2-RERUN';

  v_id2 := public.inv_receive_serial(m_a, 'PASSSG-B2-RERUN');
  SELECT count(*) INTO v_ml_after FROM public.inv_move_line WHERE move_id = m_a;
  SELECT count(*) INTO v_tr_after FROM public.inv_stock_tracking st
    JOIN public.inv_stock_item si ON si.id = st.stock_item_id WHERE si.serial='PASSSG-B2-RERUN';

  INSERT INTO rt VALUES (2,
    'B2 UNCHANGED: clean re-run returns the same stock item and writes NOTHING',
    v_id2 = v_id AND v_ml_after = v_ml_before AND v_tr_after = v_tr_before,
    format('same_id=%s move_lines %s->%s ledger %s->%s',
           v_id2 = v_id, v_ml_before, v_ml_after, v_tr_before, v_tr_after));

  ---------------------------------------------------------------- 3. B3
  -- Interrupted earlier run: the unit exists on THIS document but was never
  -- transferred. It must be finished — one move line and one ledger row — and
  -- the unit must end at the document's destination.
  INSERT INTO public.inv_stock_item (product_id, serial, location_id, status, origin_operation_id, cost)
  VALUES (p_sg,'PASSSG-B3-RESUME',l_vendors,'quarantined',d_a,0) RETURNING id INTO v_uuid;

  v_id := public.inv_receive_serial(m_a, 'PASSSG-B3-RESUME');
  SELECT count(*) INTO v_cnt FROM public.inv_move_line
   WHERE move_id = m_a AND stock_item_id = v_uuid;
  SELECT count(*) INTO v_cnt2 FROM public.inv_stock_tracking
   WHERE stock_item_id = v_uuid AND detail->>'resumed' = 'true';
  SELECT location_id INTO v_id2 FROM public.inv_stock_item WHERE id = v_uuid;

  INSERT INTO rt VALUES (3,
    'B3 UNCHANGED: an interrupted run resumes — one move line, one ledger row marked resumed, unit lands at the destination',
    v_id = v_uuid AND v_cnt = 1 AND v_cnt2 = 1 AND v_id2 = l_godown,
    format('returned_same=%s move_lines=%s resumed_ledger_rows=%s at_godown=%s',
           v_id = v_uuid, v_cnt, v_cnt2, v_id2 = l_godown));

  ---------------------------------------------------------------- 4. B4
  -- Unknown serial, no pending row anywhere. This was the ONLY meaning of
  -- "unknown" before the migration, and after it this is the VENDOR SERIAL
  -- path. It must behave exactly as it always did: create and transfer.
  v_id := public.inv_receive_serial(m_a, 'PASSSG-B4-VENDOR');
  SELECT count(*) INTO v_cnt FROM public.inv_stock_item
   WHERE serial='PASSSG-B4-VENDOR' AND origin_operation_id = d_a AND location_id = l_godown;
  SELECT count(*) INTO v_cnt2 FROM public.inv_move_line
   WHERE move_id = m_a AND stock_item_id = v_id;
  SELECT count(*) INTO v_n FROM public.inv_pending_serial WHERE serial='PASSSG-B4-VENDOR';

  INSERT INTO rt VALUES (4,
    'B4 UNCHANGED / VENDOR SERIAL: an unknown serial with no pending row is created and transferred, silently',
    v_cnt = 1 AND v_cnt2 = 1 AND v_n = 0,
    format('stock_items=%s move_lines=%s pending_rows=%s', v_cnt, v_cnt2, v_n));

  -- =================================================================
  -- TESTS 5-9 : the new pending/vendor discrimination
  -- =================================================================

  -- Generate on receipt B so its labels belong to a DIFFERENT document than d_a.
  SELECT array_agg(g.serial_number ORDER BY g.serial_number) INTO v_ser
    FROM public.inv_generate_serials(m_b, 2) g;

  ---------------------------------------------------------------- 5.
  BEGIN
    PERFORM public.inv_receive_serial(m_a, v_ser[1]);
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (5,
    'A label generated for ANOTHER document is refused, naming that document and the remedy',
    v_msg LIKE '%belongs to another document%' AND v_msg LIKE '%void it there first%',
    v_msg);

  ---------------------------------------------------------------- 6.
  -- Same operation, different LINE. Distinguished from test 5 by the sentence,
  -- not by the errcode — both are check_violation.
  SELECT g.serial_number INTO v_txt FROM public.inv_generate_serials(m_a2, 1) g;
  BEGIN
    PERFORM public.inv_receive_serial(m_a, v_txt);
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (6,
    'A label generated for a DIFFERENT LINE of the SAME receipt is refused with its own sentence, not the another-document one',
    v_msg LIKE '%different line of this receipt%'
      AND v_msg NOT LIKE '%belongs to another document%',
    v_msg);

  ---------------------------------------------------------------- 7.
  SELECT g.pending_id, g.serial_number INTO v_pid, v_txt
    FROM public.inv_generate_serials(m_a, 1) g;
  PERFORM public.inv_void_pending_serials(ARRAY[v_pid], 'smoke: deliberate void for test 7');
  BEGIN
    PERFORM public.inv_receive_serial(m_a, v_txt);
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (7,
    'A VOIDED label is refused, quoting the recorded reason and saying a voided number is never reissued',
    v_msg LIKE '%was voided on%' AND v_msg LIKE '%deliberate void for test 7%'
      AND v_msg LIKE '%never reissued%',
    v_msg);

  ---------------------------------------------------------------- 8.
  -- THE CONSUMED-ANOMALY BRANCH IS UNREACHABLE WHILE THE FK STANDS, and that
  -- is the finding, not a gap. inv_pending_serial.stock_item_id is ON DELETE
  -- RESTRICT, so the precondition for the branch — a consumed pending row whose
  -- stock item has been deleted — cannot be constructed. What is asserted is
  -- the protection that actually operates: the delete is refused. The branch
  -- in inv_receive_serial is defence in depth against the FK being dropped.
  -- ISOLATED, because the first attempt at this test was refused by a
  -- DIFFERENT constraint and would have "passed" on a bare SQLSTATE — the
  -- CLAUDE.md Pass A failure verbatim. A RECEIVED unit carries an
  -- inv_move_line and inv_stock_tracking rows, and inv_move_line_stock_item_id_fkey
  -- fires FIRST, so that route never reaches the constraint under test.
  -- The fixture below is a stock item nothing else references: no move line,
  -- no ledger row, cited only by a hand-made consumed pending row. Now the
  -- pending FK is the only thing that can refuse.
  INSERT INTO public.inv_stock_item (product_id, serial, location_id, status, origin_operation_id, cost)
  VALUES (p_sg,'PASSSG-FKISO-1',l_godown,'ok',origin_rcp,0) RETURNING id INTO v_uuid;
  INSERT INTO public.inv_pending_serial (move_id, serial, consumed_at, stock_item_id)
  VALUES (m_a, 'PASSSG-FKISO-PENDING', now(), v_uuid);

  BEGIN
    DELETE FROM public.inv_stock_item WHERE id = v_uuid;
    v_msg := '(no exception raised — the FK did NOT protect the consumed row)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (8,
    'The consumed-anomaly precondition CANNOT be built: deleting a stock item cited by a consumed pending row is refused by inv_pending_serial_stock_item_id_fkey specifically',
    v_msg LIKE '%inv_pending_serial_stock_item_id_fkey%',
    v_msg);

  -- The companion fact, recorded because it changes how the branch should be
  -- read: a genuinely RECEIVED unit is protected even earlier, by the move-line
  -- FK. So the consumed-anomaly branch inside inv_receive_serial is defence in
  -- depth behind TWO independent constraints, not a live code path.
  SELECT g.pending_id, g.serial_number INTO v_pid, v_txt
    FROM public.inv_generate_serials(m_a, 1) g;
  v_id := public.inv_receive_serial(m_a, v_txt);
  BEGIN
    DELETE FROM public.inv_stock_item WHERE id = v_id;
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (81,
    'A RECEIVED unit is protected even earlier: the move-line FK refuses the delete before the pending FK is reached, so the anomaly branch is defence in depth',
    v_msg LIKE '%inv_move_line_stock_item_id_fkey%',
    v_msg);

  ---------------------------------------------------------------- 9.
  SELECT g.pending_id, g.serial_number INTO v_pid, v_txt
    FROM public.inv_generate_serials(m_a, 1) g;
  v_id := public.inv_receive_serial(m_a, v_txt);
  SELECT count(*) INTO v_cnt FROM public.inv_stock_item WHERE serial = v_txt;
  SELECT consumed_at IS NOT NULL AND stock_item_id = v_id INTO v_ok
    FROM public.inv_pending_serial WHERE id = v_pid;
  INSERT INTO rt VALUES (9,
    'A label generated for THIS line is consumed on receipt: linked to the stock item, and exactly ONE unit created',
    v_ok IS TRUE AND v_cnt = 1,
    format('consumed_and_linked=%s stock_items_with_that_serial=%s', v_ok, v_cnt));

  -- =================================================================
  -- TESTS 10-14 : the generator
  -- =================================================================

  ---------------------------------------------------------------- 10.
  -- Decision 1: per (product, FY) and CONTINUES across receipts. d_a and d_b
  -- are different documents for the same product; the numbers must not restart.
  -- THE ASSERTION IS THE COMPARISON BETWEEN THE TWO DOCUMENTS, not a count.
  -- Receipt B generated first and holds the low numbers; receipt A generated
  -- afterwards. If the counter were per-document, A would have restarted at
  -- 0001 and its minimum would sit BELOW B's maximum. Continuation is
  -- precisely "A's lowest number is above B's highest".
  SELECT min(serial), max(serial) INTO v_txt, v_txt2
    FROM public.inv_pending_serial WHERE move_id = m_b;      -- receipt B
  SELECT min(serial) INTO v_txt3
    FROM public.inv_pending_serial WHERE move_id = m_a;      -- receipt A
  SELECT current_number INTO v_n FROM public.inv_serial_sequence
   WHERE product_id = p_sg AND fy_label = '2627';

  INSERT INTO rt VALUES (10,
    'DECISION 1: the counter is per (product, FY) and CONTINUES — the second document''s lowest serial is above the first document''s highest, so nothing restarted at 0001',
    v_txt = 'PASSSG-2627-0001' AND v_txt3 > v_txt2 AND v_n > 0,
    format('receiptB=%s..%s receiptA_min=%s counter=%s', v_txt, v_txt2, v_txt3, v_n));

  ---------------------------------------------------------------- 11.
  -- THE DIRTY NAMESPACE. Occupy the next number with a hand-typed stock item
  -- (as SUPPLIER-ALT-99 and 1234 already do on live data), then generate: the
  -- taken number must be skipped, not collided with and not failed on.
  SELECT current_number INTO v_n FROM public.inv_serial_sequence
   WHERE product_id = p_sg AND fy_label = '2627';
  v_txt := format('PASSSG-2627-%s', lpad((v_n + 1)::text, 4, '0'));
  INSERT INTO public.inv_stock_item (product_id, serial, location_id, status, origin_operation_id, cost)
  VALUES (p_sg, v_txt, l_godown, 'ok', origin_rcp, 0);

  SELECT g.serial_number INTO v_txt2 FROM public.inv_generate_serials(m_a, 1) g;
  INSERT INTO rt VALUES (11,
    'DIRTY NAMESPACE: a number already taken by a hand-typed serial is SKIPPED, not collided with',
    v_txt2 <> v_txt AND v_txt2 = format('PASSSG-2627-%s', lpad((v_n + 2)::text, 4, '0')),
    format('occupied=%s generated=%s', v_txt, v_txt2));

  ---------------------------------------------------------------- 12.
  BEGIN
    PERFORM public.inv_generate_serials(m_int, 1);
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (12,
    'Generation on a NON-RECEIPT is refused, naming the kind and saying why only a receipt may mint numbers',
    v_msg LIKE '%is a internal operation, not a receipt%'
      AND v_msg LIKE '%brings a new unit into existence%',
    v_msg);

  ---------------------------------------------------------------- 13/19.
  -- Cancel receipt C, which is carrying two unused labels. One action, two
  -- assertions: the trigger voids them (19), and generation is then refused (13).
  SELECT array_agg(g.serial_number) INTO v_ser FROM public.inv_generate_serials(m_c, 2) g;
  PERFORM public.inv_apply_operation_state(d_c, 'cancelled'::public.inv_operation_state);

  SELECT count(*) FILTER (WHERE ps.voided_at IS NOT NULL),
         max(ps.void_reason)
    INTO v_cnt, v_txt
    FROM public.inv_pending_serial ps WHERE ps.move_id = m_c;
  INSERT INTO rt VALUES (19,
    'CANCELLING a receipt voids its outstanding labels through the trigger, with a reason that says cancelled',
    v_cnt = 2 AND v_txt LIKE '%was cancelled; these labels were never used.%',
    format('voided=%s reason=%s', v_cnt, v_txt));

  BEGIN
    PERFORM public.inv_generate_serials(m_c, 1);
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (13,
    'Generation on a cancelled receipt is refused',
    v_msg LIKE '%is already cancelled and cannot have further serials generated%',
    v_msg);

  ---------------------------------------------------------------- 14.
  BEGIN
    PERFORM public.inv_generate_serials(m_a, 501);
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (14,
    'The 500 cap is enforced, and the message says why it cannot be taken back',
    v_msg LIKE '%the cap is 500%' AND v_msg LIKE '%never recycled%',
    v_msg);

  -- =================================================================
  -- TESTS 15-17, 21 : voiding
  -- =================================================================

  ---------------------------------------------------------------- 15.
  SELECT g.pending_id INTO v_pid FROM public.inv_generate_serials(m_a, 1) g;
  BEGIN
    PERFORM public.inv_void_pending_serials(ARRAY[v_pid], '   ');
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (15,
    'Voiding without a reason is refused — a number retired without one is indistinguishable from one that was lost',
    v_msg LIKE '%A reason is required%' AND v_msg LIKE '%indistinguishable%',
    v_msg);

  ---------------------------------------------------------------- 16.
  -- A CONSUMED number cannot be voided. Uses the row from test 9, which names
  -- a real unit.
  SELECT ps.id, ps.serial INTO v_pid2, v_txt
    FROM public.inv_pending_serial ps
   WHERE ps.move_id = m_a AND ps.consumed_at IS NOT NULL LIMIT 1;
  BEGIN
    PERFORM public.inv_void_pending_serials(ARRAY[v_pid2], 'smoke: should be refused');
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (16,
    'Voiding an already-RECEIVED number is refused and the message names the serial',
    v_msg LIKE '%already received into stock%' AND v_msg LIKE '%' || v_txt || '%',
    v_msg);

  ---------------------------------------------------------------- 17.
  PERFORM public.inv_void_pending_serials(ARRAY[v_pid], 'smoke: the FIRST reason');
  v_n := public.inv_void_pending_serials(ARRAY[v_pid], 'smoke: the SECOND reason');
  SELECT void_reason INTO v_txt FROM public.inv_pending_serial WHERE id = v_pid;
  INSERT INTO rt VALUES (17,
    'Voiding is idempotent: the second call changes nothing and the FIRST reason survives',
    v_n = 0 AND v_txt = 'smoke: the FIRST reason',
    format('second_call_rows=%s reason_kept=%s', v_n, v_txt));

  ---------------------------------------------------------------- 21.
  -- NEVER RECYCLE. v_pid was voided just above; its number must never come
  -- back out of the generator. This is the assertion the whole
  -- unique-across-voided-rows design exists for.
  SELECT serial INTO v_txt FROM public.inv_pending_serial WHERE id = v_pid;
  SELECT array_agg(g.serial_number) INTO v_ser FROM public.inv_generate_serials(m_a, 5) g;
  INSERT INTO rt VALUES (21,
    'NEVER RECYCLE: a voided number is not reissued by a later generation — the gap is permanent and correct',
    NOT (v_txt = ANY (v_ser)),
    format('voided=%s next_five=%s', v_txt, array_to_string(v_ser, ',')));

  -- =================================================================
  -- TESTS 18, 20 : completion trigger
  -- =================================================================

  -- Receipt D: one label received, two left outstanding. Completing it must
  -- void ONLY the outstanding two and leave the consumed one alone.
  SELECT array_agg(g.serial_number ORDER BY g.serial_number) INTO v_ser
    FROM public.inv_generate_serials(m_d, 3) g;
  PERFORM public.inv_receive_serial(m_d, v_ser[1]);
  PERFORM public.inv_apply_operation_state(d_d, 'done'::public.inv_operation_state);

  SELECT count(*) FILTER (WHERE voided_at IS NOT NULL),
         count(*) FILTER (WHERE consumed_at IS NOT NULL),
         max(void_reason)
    INTO v_cnt, v_cnt2, v_txt
    FROM public.inv_pending_serial WHERE move_id = m_d;

  INSERT INTO rt VALUES (18,
    'COMPLETING a receipt voids the unused labels, and the reason offers the vendor-serial explanation rather than reading as a failure',
    v_cnt = 2 AND v_txt LIKE '%may have arrived under vendor serials%',
    format('voided=%s reason=%s', v_cnt, v_txt));

  SELECT voided_at IS NULL AND consumed_at IS NOT NULL INTO v_ok
    FROM public.inv_pending_serial WHERE move_id = m_d AND serial = v_ser[1];
  INSERT INTO rt VALUES (20,
    'The completion trigger SPARES a consumed label — a received unit is not retired by closing its document',
    v_ok IS TRUE AND v_cnt2 = 1,
    format('consumed_row_untouched=%s consumed_count=%s', v_ok, v_cnt2));

  -- =================================================================
  -- TESTS 22-24 : printing and uniqueness
  -- =================================================================

  ---------------------------------------------------------------- 22.
  BEGIN
    PERFORM public.inv_record_serial_print(ARRAY[v_pid]);   -- v_pid is voided
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (22,
    'Printing a VOIDED number is refused — it would put a serial in the warehouse that nothing can receive',
    v_msg LIKE '%Cannot print%' AND v_msg LIKE '%nothing can receive%',
    v_msg);

  ---------------------------------------------------------------- 23.
  -- DECISION 2: a misprint is REPRINTED under the same number. Two prints must
  -- increment the count and move last_printed_at while first_printed_at stays.
  -- WHAT THIS TEST CANNOT PROVE, STATED RATHER THAN FAKED.
  -- now() is TRANSACTION-scoped in Postgres, so inside this rolled-back
  -- transaction first_printed_at and last_printed_at are equal BY
  -- CONSTRUCTION, whatever the function does. `last > first` is therefore
  -- untestable here and asserting it would be the CLAUDE.md failure mode: a
  -- claim whose outcome is decided by the harness, not by the code.
  -- pg_sleep does not help; only a second transaction would, and this suite
  -- must roll back. In production each print is its own HTTP call and so its
  -- own transaction, where the two timestamps do differ.
  -- What IS proved below: the count rises, first_printed_at is NOT overwritten
  -- by the reprint, and last_printed_at is set. Those are the properties that
  -- make a reprint visible; the ordering is not proved by this suite.
  PERFORM public.inv_record_serial_print(ARRAY[v_pid2]);    -- v_pid2 is consumed
  SELECT print_count, first_printed_at INTO v_n, v_ts
    FROM public.inv_pending_serial WHERE id = v_pid2;
  PERFORM public.inv_record_serial_print(ARRAY[v_pid2]);
  SELECT print_count, first_printed_at, last_printed_at INTO v_cnt, v_ts2, v_ts
    FROM public.inv_pending_serial WHERE id = v_pid2;

  INSERT INTO rt VALUES (23,
    'DECISION 2: a consumed number may be REPRINTED; the count rises and first_printed_at survives the reprint (ordering NOT proved here — see comment)',
    v_n = 1 AND v_cnt = 2 AND v_ts2 IS NOT NULL AND v_ts2 = v_ts AND v_ts IS NOT NULL,
    format('first_call_count=%s second_call_count=%s first_printed_preserved=%s last_printed_set=%s',
           v_n, v_cnt, v_ts2 = v_ts, v_ts IS NOT NULL));

  ---------------------------------------------------------------- 24.
  SELECT serial INTO v_txt FROM public.inv_pending_serial WHERE id = v_pid2;
  BEGIN
    INSERT INTO public.inv_pending_serial (move_id, serial) VALUES (m_a, v_txt);
    v_msg := '(no exception raised)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (24,
    'UNIQUENESS within the pending table is a real constraint, and it names itself',
    v_msg LIKE '%inv_pending_serial_serial_key%',
    v_msg);

  ---------------------------------------------------------------- 28.
  -- WHAT THE UNIQUE-INCLUDING-VOIDED-ROWS DESIGN ACTUALLY BUYS, and it was
  -- untested until the mutation plan was written. Test 21 proves a voided
  -- number is not REISSUED, but the mechanism there is the monotonic counter,
  -- which never revisits a number at all — so 21 would still pass with a
  -- weaker constraint. THIS is the assertion the constraint owns: the voided
  -- number remains OCCUPIED, so nothing can put it back into circulation by
  -- another route. A partial index over live rows only would let this through.
  SELECT serial INTO v_txt FROM public.inv_pending_serial WHERE id = v_pid;  -- voided
  BEGIN
    INSERT INTO public.inv_pending_serial (move_id, serial) VALUES (m_a, v_txt);
    v_msg := '(no exception raised — a VOIDED number was re-occupied)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (28,
    'A VOIDED number stays OCCUPIED: it cannot be re-taken by a new pending row, which is what makes never-recycle a constraint and not just a side effect of the counter',
    v_msg LIKE '%inv_pending_serial_serial_key%',
    v_msg);

  -- =================================================================
  -- TEST 25 : the inv_remove_operation_line consequence
  -- =================================================================
  -- Flagged during design and asserted here at V's instruction. Removing a
  -- line that carries generated labels MUST now be refused, because those
  -- labels exist physically. inv_remove_operation_line does a bare
  -- `DELETE FROM inv_move`, so the refusal comes from the FK, NOT from a
  -- sentence the function composes. Both halves are recorded: that it fires,
  -- and whether an operator could read it.
  d_int := (public.inv_create_operation(p_operation_type_id => t_rcp))->>'id';
  m_int := public.inv_add_operation_line(d_int, p_sg, 5);
  PERFORM public.inv_generate_serials(m_int, 1);

  BEGIN
    PERFORM public.inv_remove_operation_line(m_int);
    v_msg := '(no exception raised — the line was removed with labels outstanding)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (25,
    'REMOVING a line that carries generated labels is refused by inv_pending_serial_move_id_fkey',
    v_msg LIKE '%inv_pending_serial_move_id_fkey%',
    v_msg);

  -- LEGIBILITY, asserted separately from correctness. A refusal nobody can
  -- read is half a fix. This test is EXPECTED TO FAIL until
  -- inv_remove_operation_line composes its own sentence; its failure is the
  -- marker for that follow-up, not a defect in this migration.
  INSERT INTO rt VALUES (26,
    'LEGIBILITY (expected FAIL until inv_remove_operation_line is taught to say it): the refusal reads as a sentence, not a raw FK violation',
    v_msg NOT LIKE '%violates foreign key constraint%',
    v_msg);

  -- A control for 25: a line with NO labels still removes cleanly, so the
  -- refusal above is attributable to the pending rows and nothing else.
  d_int := (public.inv_create_operation(p_operation_type_id => t_rcp))->>'id';
  m_int := public.inv_add_operation_line(d_int, p_sg, 5);
  BEGIN
    PERFORM public.inv_remove_operation_line(m_int);
    v_msg := '(removed)';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (27,
    'CONTROL for 25: the same call on a line with NO generated labels still succeeds, so the refusal is the pending rows and not the line',
    v_msg = '(removed)', v_msg);

END $$;

-- Summary first, detail LAST: the CLI prints only the final result set.
SELECT count(*) FILTER (WHERE NOT passed) AS failures, count(*) AS total FROM rt;

SELECT n, CASE WHEN passed THEN 'PASS' ELSE '*** FAIL ***' END AS result, test, detail
  FROM rt ORDER BY n;

ROLLBACK;
