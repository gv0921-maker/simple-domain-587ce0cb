-- =====================================================================
-- DELIVERY PAYMENT GATE — smoke suite for 20260817120000.
--
-- Runs against the APPLIED objects, then ROLLS BACK.
--
-- WHY THE JWT CLAIM IS SET FIRST: inv_create_operation opens with
-- `IF NOT can_write_inventory()`, which reads auth.uid(). Run as postgres that
-- is NULL, so the fixture build would be refused at the permission gate and
-- nothing under test would ever be reached — CLAUDE.md TESTING, failure mode
-- 2. Test 0 proves the permission is satisfied first.
--
-- EVERY REFUSAL ASSERTS ITS OWN MESSAGE TEXT, not a bare SQLSTATE.
-- inv_assert_delivery_paid can refuse for THREE different reasons:
--     no_data_found       operation does not exist
--     feature_not_supported   THE SWITCH — payment cannot be verified
--     check_violation     outgoing delivery with no sales order
-- so "it was refused" would prove nothing. Tests 5, 6 and 9 separate them,
-- and test 6 exists specifically to prove test 5's refusal came from THE
-- SWITCH and not from the null-sales-order branch behind it.
--
-- Fixtures are PASSGATE-* and referenced by nothing else.
-- Every assertion records the ACTUAL value it saw.
-- =====================================================================
BEGIN;

SELECT set_config('request.jwt.claims',
                  '{"sub":"02fb2319-d5e3-4fb8-894e-40bacf614f3c"}', true);

CREATE TEMP TABLE pgt(n int, test text, passed boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  v_type_out   uuid;
  v_op_null    uuid;  v_op_null_num text;
  v_op_withso  uuid;
  v_op_intern  uuid;
  v_op_receipt uuid;
  v_so         uuid;
  v_ok         boolean;
  v_msg        text;
  v_state      text;
  v_cnt        integer;
  v_txt        text;
  v_res        jsonb;
BEGIN
  ------------------------------------------------------------------ 0. control
  SELECT public.can_write_inventory() INTO v_ok;
  INSERT INTO pgt VALUES (0,
    'CONTROL: can_write_inventory() is TRUE, so fixtures build and every refusal below is the gate, not the permission check',
    v_ok IS TRUE, format('can_write_inventory=%s', v_ok));

  ------------------------------------------------------------------ fixtures
  SELECT id INTO v_type_out
    FROM public.inv_operation_type WHERE kind = 'outgoing' AND name = 'DELIVERY NOTE';
  SELECT id INTO v_so FROM public.sales_orders ORDER BY created_at LIMIT 1;

  PERFORM public.inv_create_operation(
    p_operation_type_id => v_type_out,
    p_source_document   => 'PASSGATE-NULL');
  SELECT id, number INTO v_op_null, v_op_null_num
    FROM public.inv_operation WHERE source_document = 'PASSGATE-NULL';

  PERFORM public.inv_create_operation(
    p_operation_type_id => v_type_out,
    p_source_document   => 'PASSGATE-WITHSO');
  SELECT id INTO v_op_withso
    FROM public.inv_operation WHERE source_document = 'PASSGATE-WITHSO';
  UPDATE public.inv_operation SET sales_order_id = v_so WHERE id = v_op_withso;

  SELECT o.id INTO v_op_intern FROM public.inv_operation o
    JOIN public.inv_operation_type t ON t.id = o.operation_type_id
   WHERE t.kind = 'internal' LIMIT 1;
  SELECT o.id INTO v_op_receipt FROM public.inv_operation o
    JOIN public.inv_operation_type t ON t.id = o.operation_type_id
   WHERE t.kind = 'receipt' LIMIT 1;

  ------------------------------------------------------- 1. the column exists
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='inv_operation'
     AND column_name='sales_order_id' AND data_type='uuid' AND is_nullable='YES';
  INSERT INTO pgt VALUES (1,
    'inv_operation.sales_order_id exists, uuid, NULLABLE (receipts/transfers/adjustments carry none)',
    v_cnt = 1, format('matching columns=%s', v_cnt));

  ------------------------------------------------------- 2. the index exists
  SELECT count(*) INTO v_cnt FROM pg_indexes
   WHERE schemaname='public' AND tablename='inv_operation'
     AND indexname='inv_operation_sales_order_id_idx'
     AND indexdef ILIKE '%WHERE (sales_order_id IS NOT NULL)%';
  INSERT INTO pgt VALUES (2,
    'inv_operation_sales_order_id_idx exists AND is the partial index (WHERE sales_order_id IS NOT NULL)',
    v_cnt = 1, format('matching partial indexes=%s', v_cnt));

  --------------------------------------------- 3. the FK is SET NULL, not RESTRICT
  -- confdeltype: 'n' = SET NULL, 'r' = RESTRICT, 'a' = NO ACTION, 'c' = CASCADE.
  -- Asserted on the catalogue code, not on the rendered text, so a wording
  -- change in pg_get_constraintdef cannot make this pass by accident.
  SELECT con.confdeltype::text INTO v_txt
    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
   WHERE n.nspname='public' AND rel.relname='inv_operation'
     AND con.conname='inv_operation_sales_order_id_fkey';
  INSERT INTO pgt VALUES (3,
    'FK inv_operation_sales_order_id_fkey is ON DELETE SET NULL (confdeltype=n), NOT RESTRICT — Inventory must not veto a Sales delete',
    v_txt = 'n', format('confdeltype=%s (n=SET NULL, r=RESTRICT)', COALESCE(v_txt,'<none>')));

  ------------------------------------- 4. it targets sales_orders specifically
  SELECT count(*) INTO v_cnt
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_class frel ON frel.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
   WHERE n.nspname='public' AND rel.relname='inv_operation'
     AND con.conname='inv_operation_sales_order_id_fkey' AND frel.relname='sales_orders';
  INSERT INTO pgt VALUES (4,
    'the FK references public.sales_orders',
    v_cnt = 1, format('matching FKs=%s', v_cnt));

  --------------------------- 5. THE GATE REFUSES for outgoing — does NOT pass
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_assert_delivery_paid(v_op_null);
    v_msg := '<<RETURNED SUCCESSFULLY — THE GATE SILENTLY PASSED>>';
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO pgt VALUES (5,
    'outgoing delivery: gate RAISES feature_not_supported (0A000) naming payment verification as NOT ACTIVE — it does not return success',
    v_state = '0A000'
      AND v_msg ILIKE '%Payment verification is NOT ACTIVE%'
      AND v_msg ILIKE '%REFUSAL, NOT AN APPROVAL%',
    format('sqlstate=%s msg=%s', COALESCE(v_state,'<none>'), left(v_msg, 90)));

  ------------- 6. THE SWITCH fires BEFORE the null branch (attribution control)
  -- Same call, but this operation HAS a sales_order_id. If test 5's refusal had
  -- come from the null-sales-order branch, this one would refuse differently
  -- (or not at all). Identical feature_not_supported here proves both refusals
  -- are THE SWITCH — CLAUDE.md TESTING: prove the other causes are absent.
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_assert_delivery_paid(v_op_withso);
    v_msg := '<<RETURNED SUCCESSFULLY>>';
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO pgt VALUES (6,
    'ATTRIBUTION: an outgoing delivery WITH a sales order refuses identically (0A000), proving test 5 was THE SWITCH and not the null-sales-order branch behind it',
    v_state = '0A000' AND v_msg ILIKE '%Payment verification is NOT ACTIVE%',
    format('sqlstate=%s msg=%s', COALESCE(v_state,'<none>'), left(v_msg, 70)));

  ------------------------------- 7. non-outgoing kinds return early, no error
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_assert_delivery_paid(v_op_intern);
    v_msg := 'returned';
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO pgt VALUES (7,
    'kind=internal: gate RETURNS EARLY with no exception — a transfer is not gated on payment',
    v_state IS NULL AND v_msg = 'returned',
    format('sqlstate=%s result=%s', COALESCE(v_state,'<none>'), left(v_msg,60)));

  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_assert_delivery_paid(v_op_receipt);
    v_msg := 'returned';
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO pgt VALUES (8,
    'kind=receipt: gate RETURNS EARLY with no exception',
    v_state IS NULL AND v_msg = 'returned',
    format('sqlstate=%s result=%s', COALESCE(v_state,'<none>'), left(v_msg,60)));

  ------------------------- 9. the not-found branch is a DIFFERENT refusal
  -- Proves tests 5 and 6 were not simply "the id was rubbish".
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_assert_delivery_paid('00000000-0000-0000-0000-000000000000'::uuid);
    v_msg := '<<RETURNED SUCCESSFULLY>>';
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO pgt VALUES (9,
    'ATTRIBUTION: an unknown operation refuses with no_data_found (P0002), a DIFFERENT sqlstate from the switch — so 5 and 6 were not not-found',
    v_state = 'P0002' AND v_msg ILIKE '%not found%',
    format('sqlstate=%s msg=%s', COALESCE(v_state,'<none>'), left(v_msg,60)));

  ------------------ 10. inv_complete_operation does NOT reference the gate
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='inv_complete_operation'
     AND p.prosrc ILIKE '%inv_assert_delivery_paid%';
  INSERT INTO pgt VALUES (10,
    'inv_complete_operation source does NOT mention inv_assert_delivery_paid — the gate is NOT wired',
    v_cnt = 0, format('references found=%s (want 0)', v_cnt));

  ------- 11. THE REGRESSION TEST: completing an outgoing delivery is NOT blocked
  -- This is the one that matters. A gate accidentally wired into the completion
  -- path would block EVERY delivery. Static test 10 proves the text is absent;
  -- this proves the behaviour, which is what would actually bite.
  v_state := NULL; v_msg := NULL;
  BEGIN
    v_res := public.inv_complete_operation(v_op_null);
    v_msg := 'completed: ' || COALESCE(v_res::text, '<null>');
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO pgt VALUES (11,
    'REGRESSION: inv_complete_operation on an outgoing delivery does NOT raise the payment gate (not 0A000, no payment wording) — deliveries are not blocked',
    COALESCE(v_state,'') <> '0A000'
      AND COALESCE(v_msg,'') NOT ILIKE '%Payment verification%',
    format('sqlstate=%s outcome=%s', COALESCE(v_state,'<none>'), left(v_msg, 80)));

END $$;

-- Summary first, detail LAST: the CLI prints only the final result set, and
-- the per-test detail is the part worth reading.
SELECT count(*) FILTER (WHERE NOT passed) AS failures,
       count(*)                          AS total
  FROM pgt;

SELECT n, CASE WHEN passed THEN 'PASS' ELSE '*** FAIL ***' END AS result, test, detail
  FROM pgt ORDER BY n;

ROLLBACK;
