-- =====================================================================
-- ROUTE ENFORCEMENT — smoke suite for 20260818090000.
--
-- Runs against the APPLIED objects, then ROLLS BACK.
--
-- WHY THE JWT CLAIM IS SET FIRST: every RPC here opens with
-- `IF NOT can_write_inventory()`, which reads auth.uid(). Run as postgres that
-- is NULL, so every call would be refused at the permission gate and no guard
-- under test would ever be reached — CLAUDE.md TESTING, failure mode 2.
-- Test 0 proves the permission is satisfied first.
--
-- EVERY REFUSAL ASSERTS ITS OWN MESSAGE IDENTITY, never a bare SQLSTATE.
-- inv_transfer_stock_item can now refuse for TEN distinct reasons, and SIX of
-- them share ERRCODE 'check_violation':
--     permission / null ends / item not found / NOT WHERE EXPECTED /
--     dest missing / dest inactive / move not found / PRODUCT MISMATCH /
--     ROUTE NOT PERMITTED / CITATION MISMATCH / already processed
-- so "it was refused" would prove nothing whatsoever — CLAUDE.md TESTING, the
-- Pass A failure verbatim. Each refusal below matches its own sentence, and
-- each is paired with a control differing in exactly ONE respect.
--
-- Fixtures are PASSRT-* and referenced by nothing else.
-- Every assertion records the ACTUAL value it saw.
-- =====================================================================
BEGIN;

SELECT set_config('request.jwt.claims',
                  '{"sub":"02fb2319-d5e3-4fb8-894e-40bacf614f3c"}', true);

CREATE TEMP TABLE rt(n int, test text, passed boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  -- locations
  l_godown uuid; l_stock uuid; l_dlvord uuid; l_cust uuid; l_loss uuid; l_scrap uuid;
  -- types
  t_out uuid; t_int uuid; t_adj uuid;
  -- documents
  d_out uuid; d_int_stock uuid; d_int_godown uuid; d_adj uuid; d_other uuid;
  m_out uuid; m_int_stock uuid; m_int_godown uuid; m_adj uuid; m_out_other_prod uuid;
  -- products
  p_main uuid; p_alt uuid;
  -- fixture units
  u_god1 uuid; u_god2 uuid; u_god3 uuid; u_dlv1 uuid; u_dlv2 uuid; u_stk1 uuid; u_loss1 uuid;
  origin_rcp uuid;
  -- scratch
  v_state text; v_msg text; v_ok boolean; v_cnt int; v_res jsonb;
BEGIN
  ------------------------------------------------------------------ 0. control
  SELECT public.can_write_inventory() INTO v_ok;
  INSERT INTO rt VALUES (0,
    'CONTROL: can_write_inventory() is TRUE, so every refusal below is a guard under test and not the permission gate',
    v_ok IS TRUE, format('can_write_inventory=%s', v_ok));

  ------------------------------------------------------------------ fixtures
  SELECT id INTO l_godown FROM public.inv_location WHERE name='GODOWN';
  SELECT id INTO l_stock  FROM public.inv_location WHERE name='STOCK';
  SELECT id INTO l_dlvord FROM public.inv_location WHERE name='DELIVERY ORDER';
  SELECT id INTO l_cust   FROM public.inv_location WHERE name='CUSTOMERS';
  SELECT id INTO l_loss   FROM public.inv_location WHERE name='INVENTORY LOSS';
  SELECT id INTO l_scrap  FROM public.inv_location WHERE name='SCRAP';

  SELECT id INTO t_out FROM public.inv_operation_type WHERE name='DELIVERY NOTE';
  SELECT id INTO t_int FROM public.inv_operation_type WHERE name='ITEM ESTIMATE';
  SELECT id INTO t_adj FROM public.inv_operation_type WHERE name='STOCK ADJUSTMENT';

  SELECT id INTO p_main FROM public.products WHERE sku='101205';
  SELECT id INTO p_alt  FROM public.products WHERE sku='PASS9-PREVIEW-001';
  SELECT id INTO origin_rcp FROM public.inv_operation WHERE number='RCP/2627/0001';

  -- Units nothing else references, each placed deliberately.
  INSERT INTO public.inv_stock_item (product_id, serial, location_id, status, origin_operation_id, cost)
  VALUES (p_main,'PASSRT-GODOWN-1',l_godown,'ok',origin_rcp,0) RETURNING id INTO u_god1;
  INSERT INTO public.inv_stock_item (product_id, serial, location_id, status, origin_operation_id, cost)
  VALUES (p_main,'PASSRT-GODOWN-2',l_godown,'ok',origin_rcp,0) RETURNING id INTO u_god2;
  INSERT INTO public.inv_stock_item (product_id, serial, location_id, status, origin_operation_id, cost)
  VALUES (p_main,'PASSRT-GODOWN-3',l_godown,'ok',origin_rcp,0) RETURNING id INTO u_god3;
  INSERT INTO public.inv_stock_item (product_id, serial, location_id, status, origin_operation_id, cost)
  VALUES (p_main,'PASSRT-DLVORD-1',l_dlvord,'ok',origin_rcp,0) RETURNING id INTO u_dlv1;
  INSERT INTO public.inv_stock_item (product_id, serial, location_id, status, origin_operation_id, cost)
  VALUES (p_main,'PASSRT-DLVORD-2',l_dlvord,'ok',origin_rcp,0) RETURNING id INTO u_dlv2;
  INSERT INTO public.inv_stock_item (product_id, serial, location_id, status, origin_operation_id, cost)
  VALUES (p_main,'PASSRT-STOCK-1',l_stock,'ok',origin_rcp,0) RETURNING id INTO u_stk1;
  INSERT INTO public.inv_stock_item (product_id, serial, location_id, status, origin_operation_id, cost)
  VALUES (p_main,'PASSRT-LOSS-1',l_loss,'ok',origin_rcp,0) RETURNING id INTO u_loss1;

  -- Documents, each with an explicit route.
  v_res := public.inv_create_operation(t_out, l_dlvord, l_cust,
             p_source_document => 'PASSRT-OUT');
  d_out := (v_res->>'id')::uuid;
  m_out := public.inv_add_operation_line(d_out, p_main, 5);
  m_out_other_prod := public.inv_add_operation_line(d_out, p_alt, 1);

  v_res := public.inv_create_operation(t_int, l_stock, l_dlvord,
             p_source_document => 'PASSRT-INT-STOCK');
  d_int_stock := (v_res->>'id')::uuid;
  m_int_stock := public.inv_add_operation_line(d_int_stock, p_main, 5);

  v_res := public.inv_create_operation(t_int, l_godown, l_dlvord,
             p_source_document => 'PASSRT-INT-GODOWN');
  d_int_godown := (v_res->>'id')::uuid;
  m_int_godown := public.inv_add_operation_line(d_int_godown, p_main, 5);

  v_res := public.inv_create_operation(t_adj, l_loss, l_stock,
             p_source_document => 'PASSRT-ADJ');
  d_adj := (v_res->>'id')::uuid;
  m_adj := public.inv_add_operation_line(d_adj, p_main, 5);

  SELECT id INTO d_other FROM public.inv_operation WHERE number='RCP/2627/0001';

  --------------------------------------------------- 1. THE HELPER IS DIRECTIONAL
  INSERT INTO rt VALUES (1,
    'inv_location_reaches: GODOWN reaches STOCK (child under parent) = TRUE',
    public.inv_location_reaches(l_godown, l_stock) IS TRUE,
    format('reaches(GODOWN, STOCK)=%s', public.inv_location_reaches(l_godown, l_stock)));

  INSERT INTO rt VALUES (2,
    'inv_location_reaches is DIRECTIONAL: STOCK does NOT reach GODOWN (parent is not under child)',
    public.inv_location_reaches(l_stock, l_godown) IS FALSE,
    format('reaches(STOCK, GODOWN)=%s', public.inv_location_reaches(l_stock, l_godown)));

  INSERT INTO rt VALUES (3,
    'inv_location_reaches: a location reaches itself (distance 0)',
    public.inv_location_reaches(l_godown, l_godown) IS TRUE,
    format('reaches(GODOWN, GODOWN)=%s', public.inv_location_reaches(l_godown, l_godown)));

  ------------------------------- 4. THE DEFECT V OBSERVED, NOW REFUSED
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_transfer_stock_item(
      u_god1, m_out, l_godown, l_cust, 'inv_operation', d_out, 'outgoing');
    v_msg := '<<MOVED — THE ROUTE CHECK DID NOT FIRE>>';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (4,
    'THE DEFECT: a GODOWN unit onto a delivery sourced DELIVERY ORDER is REFUSED, and the message names BOTH locations',
    v_msg ILIKE '%Route not permitted%'
      AND v_msg ILIKE '%GODOWN%' AND v_msg ILIKE '%DELIVERY ORDER%',
    format('sqlstate=%s msg=%s', COALESCE(v_state,'<none>'), left(v_msg,150)));

  -- and it recorded NOTHING
  SELECT count(*) INTO v_cnt FROM public.inv_stock_tracking WHERE stock_item_id = u_god1;
  INSERT INTO rt VALUES (5,
    'the refused move wrote NO ledger row and left the unit in GODOWN',
    v_cnt = 0 AND (SELECT location_id FROM public.inv_stock_item WHERE id=u_god1) = l_godown,
    format('ledger rows=%s, still at godown=%s', v_cnt,
           (SELECT location_id FROM public.inv_stock_item WHERE id=u_god1) = l_godown));

  ---------------------------- 6. POSITIVE CONTROL: same document, right place
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_transfer_stock_item(
      u_dlv1, m_out, l_dlvord, l_cust, 'inv_operation', d_out, 'outgoing');
    v_msg := 'moved';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (6,
    'POSITIVE CONTROL: the SAME document accepts a unit that is actually at DELIVERY ORDER — so test 4 was the route, not the document or the unit',
    v_state IS NULL AND v_msg = 'moved',
    format('sqlstate=%s result=%s', COALESCE(v_state,'<none>'), left(v_msg,90)));

  ------------------- 7. ORDERING: ACCURACY BEATS LEGALITY
  -- u_dlv2 is at DELIVERY ORDER. Claim it is at GODOWN. That claim is BOTH
  -- inaccurate AND (GODOWN -> CUSTOMERS) an illegal route for this document, so
  -- only the ORDER of the two checks decides which message comes back.
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_transfer_stock_item(
      u_dlv2, m_out, l_godown, l_cust, 'inv_operation', d_out, 'outgoing');
    v_msg := '<<MOVED>>';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (7,
    'ORDERING: a stale expected-from reports "not where it was expected", NOT a route error — accuracy is judged before legality so a moved unit is described correctly',
    v_msg ILIKE '%is not where it was expected%'
      AND v_msg NOT ILIKE '%Route not permitted%',
    format('sqlstate=%s msg=%s', COALESCE(v_state,'<none>'), left(v_msg,130)));

  ------------------- 8. DESCENDANT: the test a naive equality fix fails
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_transfer_stock_item(
      u_god2, m_int_stock, l_godown, l_dlvord, 'inv_operation', d_int_stock, 'internal');
    v_msg := 'moved';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (8,
    'DESCENDANT: a document sourced STOCK ACCEPTS a unit sitting in GODOWN, its child. A plain equality check would refuse all 23 live GODOWN units here',
    v_state IS NULL AND v_msg = 'moved',
    format('sqlstate=%s result=%s', COALESCE(v_state,'<none>'), left(v_msg,110)));

  ------------------- 9. containment is directional, not symmetric
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_transfer_stock_item(
      u_stk1, m_int_godown, l_stock, l_dlvord, 'inv_operation', d_int_godown, 'internal');
    v_msg := '<<MOVED>>';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (9,
    'DIRECTIONAL: a document sourced GODOWN REFUSES a unit sitting in STOCK, its parent — containment runs one way only',
    v_msg ILIKE '%Route not permitted%',
    format('sqlstate=%s msg=%s', COALESCE(v_state,'<none>'), left(v_msg,120)));

  ------------------- 10/11. ADJUSTMENTS RUN BOTH WAYS ALONG THEIR AXIS
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_transfer_stock_item(
      u_loss1, m_adj, l_loss, l_stock, 'inv_operation', d_adj, 'adjustment');
    v_msg := 'moved';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (10,
    'ADJUSTMENT forward (virtual -> internal, the configured direction): ACCEPTED',
    v_state IS NULL AND v_msg = 'moved',
    format('sqlstate=%s result=%s', COALESCE(v_state,'<none>'), left(v_msg,110)));

  v_state := NULL; v_msg := NULL;
  BEGIN
    -- GODOWN is under STOCK (the document's DEST); INVENTORY LOSS is its SOURCE.
    -- This is the write-off direction, the reverse of how the type is configured.
    PERFORM public.inv_transfer_stock_item(
      u_god3, m_adj, l_godown, l_loss, 'inv_operation', d_adj, 'adjustment');
    v_msg := 'moved';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (11,
    'ADJUSTMENT reverse (internal -> virtual, a write-off): ACCEPTED. A one-directional rule would have broken adjustments the day they were built',
    v_state IS NULL AND v_msg = 'moved',
    format('sqlstate=%s result=%s', COALESCE(v_state,'<none>'), left(v_msg,110)));

  ------------------- 12. ADJUSTMENTS ARE NOT EXEMPT — the PAIR check
  -- u_god1 is in GODOWN, which IS under the document's dest (STOCK). SCRAP is
  -- neither end of this document's axis. Two INDEPENDENT membership tests would
  -- have to be written very carefully to catch this; the pair check catches it
  -- by construction.
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_transfer_stock_item(
      u_god1, m_adj, l_godown, l_scrap, 'inv_operation', d_adj, 'adjustment');
    v_msg := '<<MOVED>>';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (12,
    'ADJUSTMENT to a THIRD location (SCRAP, on an INVENTORY LOSS <-> STOCK document): REFUSED, and the message explains the axis rule',
    v_msg ILIKE '%Route not permitted%' AND v_msg ILIKE '%either way along its own axis%',
    format('sqlstate=%s msg=%s', COALESCE(v_state,'<none>'), left(v_msg,150)));

  ------------------- 13. THE PAIR CHECK: internal -> internal is not an adjustment
  -- GODOWN reaches the dest (STOCK) and STOCK reaches the dest (STOCK), so two
  -- INDEPENDENT membership tests over the allowed SET would ADMIT this move.
  -- The pair check refuses it: the ends must be OPPOSITE ends of the axis.
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_transfer_stock_item(
      u_god1, m_adj, l_godown, l_stock, 'inv_operation', d_adj, 'adjustment');
    v_msg := '<<MOVED — TWO INDEPENDENT MEMBERSHIP TESTS WOULD ALLOW THIS>>';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (13,
    'PAIR CHECK: an adjustment REFUSES internal -> internal (GODOWN -> STOCK) even though BOTH ends are individually in the allowed set. This is the test that separates a pair check from two membership tests',
    v_msg ILIKE '%Route not permitted%',
    format('sqlstate=%s msg=%s', COALESCE(v_state,'<none>'), left(v_msg,130)));

  ------------------- 14. THE DESTINATION SIDE IS ENFORCED TOO
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_transfer_stock_item(
      u_dlv2, m_out, l_dlvord, l_scrap, 'inv_operation', d_out, 'outgoing');
    v_msg := '<<MOVED>>';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (14,
    'DESTINATION: a delivery bound for CUSTOMERS REFUSES a unit sent to SCRAP — the to side is enforced, closing destination-on-trust',
    v_msg ILIKE '%Route not permitted%' AND v_msg ILIKE '%SCRAP%',
    format('sqlstate=%s msg=%s', COALESCE(v_state,'<none>'), left(v_msg,140)));

  ------------------- 15. THE LEDGER CITATION IS NO LONGER THE CALLER'S WORD
  v_state := NULL; v_msg := NULL;
  BEGIN
    -- A perfectly legal DELIVERY ORDER -> CUSTOMERS move, citing a RECEIPT.
    PERFORM public.inv_transfer_stock_item(
      u_dlv2, m_out, l_dlvord, l_cust, 'inv_operation', d_other, 'outgoing');
    v_msg := '<<MOVED — CITED THE WRONG DOCUMENT>>';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (15,
    'CITATION: a legal move that cites the WRONG document is refused with "Ledger citation mismatch" — a DIFFERENT refusal from the route one',
    v_msg ILIKE '%Ledger citation mismatch%' AND v_msg NOT ILIKE '%Route not permitted%',
    format('sqlstate=%s msg=%s', COALESCE(v_state,'<none>'), left(v_msg,140)));

  ------------------- 16. ATTRIBUTION: product mismatch is still its own refusal
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.inv_transfer_stock_item(
      u_dlv2, m_out_other_prod, l_dlvord, l_cust, 'inv_operation', d_out, 'outgoing');
    v_msg := '<<MOVED>>';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (16,
    'ATTRIBUTION: a product mismatch on a ROUTE-LEGAL move still reports the product, not the route — the new check did not swallow an existing one',
    v_msg ILIKE '%is product%' AND v_msg NOT ILIKE '%Route not permitted%',
    format('sqlstate=%s msg=%s', COALESCE(v_state,'<none>'), left(v_msg,130)));

  ------------------- 17. RECEIPTS STILL WORK
  v_state := NULL; v_msg := NULL;
  DECLARE
    d_rcp uuid; m_rcp uuid; v_new uuid; t_rcp uuid; l_vend uuid;
  BEGIN
    SELECT id INTO t_rcp FROM public.inv_operation_type WHERE name='GOODS RECEIVED';
    SELECT id INTO l_vend FROM public.inv_location WHERE name='VENDORS';
    v_res := public.inv_create_operation(t_rcp, l_vend, l_godown,
               p_source_document => 'PASSRT-RCP');
    d_rcp := (v_res->>'id')::uuid;
    m_rcp := public.inv_add_operation_line(d_rcp, p_main, 2);
    v_new := public.inv_receive_serial(m_rcp, 'PASSRT-RECEIVED-1');
    v_msg := 'received';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO rt VALUES (17,
    'RECEIPTS: inv_receive_serial still works end to end — the path behind all 25 existing receipt ledger rows is unbroken',
    v_state IS NULL AND v_msg = 'received',
    format('sqlstate=%s result=%s', COALESCE(v_state,'<none>'), left(v_msg,110)));

  ------------------- 18. the messaging superset
  SELECT count(*) INTO v_cnt FROM public.inv_document_allowed_from(d_out) f
   WHERE f.location_id = l_dlvord;
  INSERT INTO rt VALUES (18,
    'inv_document_allowed_from(delivery) contains DELIVERY ORDER and NOT GODOWN — the screen can refuse before any round trip',
    v_cnt = 1
      AND NOT EXISTS (SELECT 1 FROM public.inv_document_allowed_from(d_out) f2
                       WHERE f2.location_id = l_godown),
    format('dlvord present=%s, godown present=%s', v_cnt,
           EXISTS (SELECT 1 FROM public.inv_document_allowed_from(d_out) f3
                    WHERE f3.location_id = l_godown)));

  SELECT count(*) INTO v_cnt FROM public.inv_document_allowed_from(d_adj);
  INSERT INTO rt VALUES (19,
    'inv_document_allowed_from(adjustment) is a SUPERSET — it spans BOTH ends of the axis, which is more than inv_route_is_legal permits as a pair. Too generous is safe; too narrow would refuse a lawful unit',
    EXISTS (SELECT 1 FROM public.inv_document_allowed_from(d_adj) f WHERE f.location_id = l_loss)
      AND EXISTS (SELECT 1 FROM public.inv_document_allowed_from(d_adj) f WHERE f.location_id = l_stock)
      AND EXISTS (SELECT 1 FROM public.inv_document_allowed_from(d_adj) f WHERE f.location_id = l_godown),
    format('allowed_from count=%s (loss+stock+godown all present)', v_cnt));

END $$;

-- Summary first, detail LAST: the CLI prints only the final result set.
SELECT count(*) FILTER (WHERE NOT passed) AS failures, count(*) AS total FROM rt;

SELECT n, CASE WHEN passed THEN 'PASS' ELSE '*** FAIL ***' END AS result, test, detail
  FROM rt ORDER BY n;

ROLLBACK;
