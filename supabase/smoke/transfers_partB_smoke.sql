-- =====================================================================
-- INTERNAL TRANSFERS Pass B — smoke suite for inv_create_operation /
-- inv_complete_operation and the two receipt wrappers.
--
-- Runs against the APPLIED functions, then ROLLS BACK.
--
-- WHY THE JWT CLAIM IS SET FIRST, AND WHY TEST 0 EXISTS:
-- every one of these RPCs opens with `IF NOT can_write_inventory()`, which
-- reads auth.uid(). Run as postgres that is NULL, so EVERY call would be
-- refused at the permission check and no guard under test would ever be
-- reached — CLAUDE.md TESTING, failure mode 2, exactly. Test 0 proves the
-- permission is satisfied, so a refusal below is attributable to the guard
-- being tested rather than to the permission gate.
--
-- Fixtures are PASSBT-* and referenced by nothing else.
-- Every assertion records the ACTUAL value it saw.
--
-- NOT COVERED, deliberately: inv_operation_adjustment_counterparty is a
-- DEFERRABLE INITIALLY DEFERRED constraint trigger that only fires at
-- COMMIT. This suite rolls back, so it is not exercised. It is not under
-- test here — inv_create_operation does its work immediately — but a
-- passing adjustment creation below is NOT evidence about that trigger.
-- =====================================================================
BEGIN;

SELECT set_config('request.jwt.claims',
                  '{"sub":"02fb2319-d5e3-4fb8-894e-40bacf614f3c"}', true);

CREATE TEMP TABLE pbt(n int, test text, passed boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  v_loc_a uuid; v_loc_b uuid;
  v_t_lockedsrc uuid; v_t_samesrc uuid; v_t_noseq uuid; v_t_internal uuid;
  v_seq_internal uuid;
  v_res jsonb; v_msg text; v_num text; v_id uuid;
  v_ok boolean; v_state text;
  v_po uuid; v_cust uuid; v_vend uuid;
  v_before int; v_after int;
BEGIN
  ------------------------------------------------------------------ 0. control
  SELECT public.can_write_inventory() INTO v_ok;
  INSERT INTO pbt VALUES (0,
    'CONTROL: can_write_inventory() is TRUE, so every refusal below is the guard under test and not the permission gate',
    v_ok IS TRUE, format('can_write_inventory=%s', v_ok));

  ------------------------------------------------------------------ fixtures
  SELECT id INTO v_loc_a FROM public.inv_location WHERE name = 'STOCK';
  SELECT id INTO v_loc_b FROM public.inv_location WHERE name = 'GODOWN';
  SELECT id INTO v_seq_internal FROM public.inv_number_sequence
   WHERE document_type = 'internal' AND fy_label = '2627';
  SELECT id INTO v_t_internal FROM public.inv_operation_type WHERE name = 'ITEM ESTIMATE';
  SELECT id INTO v_cust FROM public.customers LIMIT 1;
  SELECT id INTO v_po FROM public.inv_purchase_order LIMIT 1;

  -- The vendors table is EMPTY on this database, so the first run of this
  -- suite skipped tests 12/13 entirely and reported it as a FAIL rather than
  -- a pass. A fixture vendor is created instead of reaching for whatever
  -- happens to exist — nothing else references it, so a refusal below cannot
  -- have come from another row's constraints.
  INSERT INTO public.vendors (name) VALUES ('PASSBT-VENDOR') RETURNING id INTO v_vend;

  -- a type that LOCKS ITS SOURCE
  INSERT INTO public.inv_operation_type
    (name, kind, sequence_id, default_source_location_id, default_dest_location_id,
     locks_source, locks_destination)
  VALUES ('PASSBT-LOCKED-SRC', 'internal', v_seq_internal, v_loc_a, v_loc_b, true, false)
  RETURNING id INTO v_t_lockedsrc;

  -- a type whose source and destination RESOLVE THE SAME
  INSERT INTO public.inv_operation_type
    (name, kind, sequence_id, default_source_location_id, default_dest_location_id,
     locks_source, locks_destination)
  VALUES ('PASSBT-SAME-ENDS', 'internal', v_seq_internal, v_loc_a, v_loc_a, false, false)
  RETURNING id INTO v_t_samesrc;

  -- a type with NO SEQUENCE, to exercise the numbering fallback
  INSERT INTO public.inv_operation_type
    (name, kind, sequence_id, default_source_location_id, default_dest_location_id,
     locks_source, locks_destination)
  VALUES ('PASSBT-NO-SEQ', 'internal', NULL, v_loc_a, v_loc_b, false, false)
  RETURNING id INTO v_t_noseq;

  ------------------------------------------------- 1. all four kinds create
  v_res := public.inv_create_operation(
             p_operation_type_id => (SELECT id FROM public.inv_operation_type WHERE name='GOODS RECEIVED'));
  INSERT INTO pbt VALUES (1,
    'RECEIPT creates and draws an RCP number',
    (v_res->>'number') LIKE 'RCP/%' AND (v_res->>'kind') = 'receipt',
    format('number=%s kind=%s', v_res->>'number', v_res->>'kind'));

  v_res := public.inv_create_operation(p_operation_type_id => v_t_internal);
  INSERT INTO pbt VALUES (2,
    'INTERNAL creates and draws an INT number — the kind that did not exist before this pass',
    (v_res->>'number') LIKE 'INT/%' AND (v_res->>'kind') = 'internal',
    format('number=%s kind=%s', v_res->>'number', v_res->>'kind'));

  v_res := public.inv_create_operation(
             p_operation_type_id => (SELECT id FROM public.inv_operation_type WHERE name='DELIVERY NOTE'));
  INSERT INTO pbt VALUES (3,
    'OUTGOING creates and draws a DEL number',
    (v_res->>'number') LIKE 'DEL/%' AND (v_res->>'kind') = 'outgoing',
    format('number=%s kind=%s', v_res->>'number', v_res->>'kind'));

  v_res := public.inv_create_operation(
             p_operation_type_id => (SELECT id FROM public.inv_operation_type WHERE name='STOCK ADJUSTMENT'));
  INSERT INTO pbt VALUES (4,
    'ADJUSTMENT creates and draws an ADJ number (its deferred counterparty trigger is NOT exercised — see header)',
    (v_res->>'number') LIKE 'ADJ/%' AND (v_res->>'kind') = 'adjustment',
    format('number=%s kind=%s', v_res->>'number', v_res->>'kind'));

  --------------------------------------------------- 5-6. locks_source
  v_res := public.inv_create_operation(
             p_operation_type_id  => v_t_lockedsrc,
             p_source_location_id => v_loc_b);   -- deliberately NOT the default
  INSERT INTO pbt VALUES (5,
    'locks_source HONOURED: the type default wins over the caller value',
    (v_res->>'source_location_id')::uuid = v_loc_a,
    format('source=%s expected=%s (caller sent %s)',
           v_res->>'source_location_id', v_loc_a, v_loc_b));

  INSERT INTO pbt VALUES (6,
    'locks_source REPORTED: source_locked true and client_source_ignored true, so the form can say so',
    (v_res->>'source_locked') = 'true' AND (v_res->>'client_source_ignored') = 'true',
    format('source_locked=%s client_source_ignored=%s',
           v_res->>'source_locked', v_res->>'client_source_ignored'));

  -- negative control: same type, caller sends the SAME value as the default
  v_res := public.inv_create_operation(
             p_operation_type_id  => v_t_lockedsrc,
             p_source_location_id => v_loc_a);
  INSERT INTO pbt VALUES (7,
    'CONTROL for 6: sending the value the type already fixes reports client_source_ignored FALSE, so the flag tracks a real disagreement',
    (v_res->>'client_source_ignored') = 'false',
    format('client_source_ignored=%s', v_res->>'client_source_ignored'));

  ----------------------------------------- 8. numbering fallback per kind
  v_res := public.inv_create_operation(
             p_operation_type_id => v_t_noseq,
             p_fy_label          => '2627');
  INSERT INTO pbt VALUES (8,
    'NUMBERING FALLBACK resolves to the KIND: a sequence-less internal type draws INT/, not the RCP/ the old hardcoded fallback would have taken',
    (v_res->>'number') LIKE 'INT/%',
    format('number=%s (old behaviour would have been RCP/...)', v_res->>'number'));

  ------------------------------------------- 9. same source and destination
  BEGIN
    v_res := public.inv_create_operation(p_operation_type_id => v_t_samesrc);
    INSERT INTO pbt VALUES (9,
      'same source and destination is REFUSED', false,
      format('NO ERROR — it returned %s', v_res));
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    INSERT INTO pbt VALUES (9,
      'same source and destination REFUSED by ITS OWN message (not a generic failure)',
      v_msg LIKE '%resolves to the same source and destination location%'
        AND v_msg LIKE '%PASSBT-SAME-ENDS%',
      format('SQLSTATE=%s msg=%s', SQLSTATE, v_msg));
  END;

  ---------------------------------------- 10. PO refused on a non-receipt
  IF v_po IS NULL THEN
    INSERT INTO pbt VALUES (10,
      'purchase order refused on a non-receipt', false,
      'SKIPPED — no inv_purchase_order row exists to reference');
  ELSE
    BEGIN
      v_res := public.inv_create_operation(
                 p_operation_type_id => v_t_internal,
                 p_purchase_order_id => v_po);
      INSERT INTO pbt VALUES (10,
        'purchase order refused on a non-receipt', false,
        format('NO ERROR — it returned %s', v_res));
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
      INSERT INTO pbt VALUES (10,
        'PURCHASE ORDER on a non-receipt refused by ITS OWN message',
        v_msg LIKE '%cannot cite a purchase order%' AND v_msg LIKE '%internal%',
        format('SQLSTATE=%s msg=%s', SQLSTATE, v_msg));
    END;

    -- control: the SAME purchase order on a RECEIPT type is accepted
    v_res := public.inv_create_operation(
               p_operation_type_id => (SELECT id FROM public.inv_operation_type WHERE name='GOODS RECEIVED'),
               p_purchase_order_id => v_po);
    INSERT INTO pbt VALUES (11,
      'CONTROL for 10: the same purchase order on a RECEIPT is accepted, so 10 refused the KIND and not the PO itself',
      (v_res->>'id') IS NOT NULL,
      format('number=%s', v_res->>'number'));
  END IF;

  ------------------------------------------------- 12. both partners refused
  IF v_vend IS NULL OR v_cust IS NULL THEN
    INSERT INTO pbt VALUES (12, 'both partners refused', false,
      format('SKIPPED — vendor=%s customer=%s', v_vend, v_cust));
  ELSE
    BEGIN
      v_res := public.inv_create_operation(
                 p_operation_type_id   => v_t_internal,
                 p_partner_vendor_id   => v_vend,
                 p_partner_customer_id => v_cust);
      INSERT INTO pbt VALUES (12,
        'vendor AND customer together refused', false,
        format('NO ERROR — it returned %s', v_res));
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
      INSERT INTO pbt VALUES (12,
        'VENDOR AND CUSTOMER together refused by the RPC''s own message, not by inv_operation_single_partner',
        v_msg LIKE '%may cite a vendor or a customer, not both%',
        format('SQLSTATE=%s msg=%s', SQLSTATE, v_msg));
    END;

    -- control: one partner alone is fine
    v_res := public.inv_create_operation(
               p_operation_type_id => v_t_internal,
               p_partner_vendor_id => v_vend);
    INSERT INTO pbt VALUES (13,
      'CONTROL for 12: a vendor ALONE is accepted, so 12 refused the combination and not the vendor',
      (v_res->>'id') IS NOT NULL, format('number=%s', v_res->>'number'));
  END IF;

  -- ==================================================================
  -- THE REGRESSION SURFACE: the receipt wrappers must behave EXACTLY as
  -- they did before generalisation. This is the part that can break the
  -- live receipt flow.
  -- ==================================================================

  --------------------------------- 14-16. inv_create_receipt happy path
  v_res := public.inv_create_receipt(
             p_operation_type_id => (SELECT id FROM public.inv_operation_type WHERE name='GOODS RECEIVED'));
  INSERT INTO pbt VALUES (14,
    'WRAPPER inv_create_receipt still returns the original key set with the original values',
    (v_res->>'number') LIKE 'RCP/%'
      AND (v_res->>'state') = 'draft'
      AND (v_res->>'destination_locked') = 'true'
      AND (v_res->>'dest_location_id')::uuid = v_loc_b
      AND (v_res->>'client_destination_ignored') = 'false',
    format('number=%s state=%s destination_locked=%s dest=%s ignored=%s',
           v_res->>'number', v_res->>'state', v_res->>'destination_locked',
           v_res->>'dest_location_id', v_res->>'client_destination_ignored'));

  v_res := public.inv_create_receipt(
             p_operation_type_id => (SELECT id FROM public.inv_operation_type WHERE name='GOODS RECEIVED'),
             p_dest_location_id  => v_loc_a);   -- differs from the locked default
  INSERT INTO pbt VALUES (15,
    'WRAPPER locks_destination behaviour UNCHANGED: caller value ignored, not rejected, and reported',
    (v_res->>'dest_location_id')::uuid = v_loc_b
      AND (v_res->>'client_destination_ignored') = 'true',
    format('dest=%s expected=%s ignored=%s',
           v_res->>'dest_location_id', v_loc_b, v_res->>'client_destination_ignored'));

  BEGIN
    v_res := public.inv_create_receipt(p_operation_type_id => v_t_internal);
    INSERT INTO pbt VALUES (16,
      'inv_create_receipt refuses a non-receipt type', false,
      format('NO ERROR — it returned %s', v_res));
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    INSERT INTO pbt VALUES (16,
      'WRAPPER kind guard wording preserved VERBATIM: "inv_create_receipt creates receipts only."',
      v_msg LIKE '%inv_create_receipt creates receipts only.%'
        AND v_msg LIKE '%ITEM ESTIMATE%' AND v_msg LIKE '%internal%',
      format('SQLSTATE=%s msg=%s', SQLSTATE, v_msg));
  END;

  ------------------------------- 17-19. completion, generic and wrapper
  v_res := public.inv_create_operation(p_operation_type_id => v_t_internal);
  v_id  := (v_res->>'id')::uuid;
  v_num := v_res->>'number';

  BEGIN
    v_res := public.inv_complete_receipt(v_id);
    INSERT INTO pbt VALUES (17,
      'inv_complete_receipt refuses a non-receipt operation', false,
      format('NO ERROR — it returned %s', v_res));
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    INSERT INTO pbt VALUES (17,
      'WRAPPER completion guard wording preserved VERBATIM: "is a % operation, not a receipt."',
      v_msg LIKE '%is a internal operation, not a receipt.%' AND v_msg LIKE '%'||v_num||'%',
      format('SQLSTATE=%s msg=%s', SQLSTATE, v_msg));
  END;

  v_res := public.inv_complete_operation(v_id);
  INSERT INTO pbt VALUES (18,
    'GENERIC completion accepts the SAME internal operation the wrapper just refused — the kind gate is in the wrapper, not the engine',
    (v_res->>'operation') = v_num AND (v_res->>'kind') = 'internal',
    format('operation=%s kind=%s state=%s',
           v_res->>'operation', v_res->>'kind', v_res->>'operation_state'));

  INSERT INTO pbt VALUES (19,
    'a transfer with no units carries no purchase_order_state — the PO sync is self-selecting, not kind-tested',
    (v_res->>'purchase_order_state') IS NULL,
    format('purchase_order_state=%s', COALESCE(v_res->>'purchase_order_state','<null>')));

  ------------------------------------- 20. locks_source is genuinely NEW
  SELECT count(*) INTO v_before FROM public.inv_operation_type WHERE locks_source;
  INSERT INTO pbt VALUES (20,
    'CONTEXT: no PRE-EXISTING type sets locks_source, so tests 5-7 exercised a flag that had never been read in production',
    v_before = 1,   -- only the PASSBT fixture created above
    format('types with locks_source=true: %s (expected 1, the fixture)', v_before));
END $$;

SELECT n,
       CASE WHEN passed THEN 'PASS' ELSE '*** FAIL ***' END AS result,
       test, detail
  FROM pbt ORDER BY n;

ROLLBACK;
