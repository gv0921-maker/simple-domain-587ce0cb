-- =====================================================================
-- PASS C SMOKE SUITE — runs against the APPLIED views, then ROLLS BACK.
--
-- Fixtures are named PASSC-* and referenced by nothing else, so a result can
-- only have come from the thing under test (CLAUDE.md TESTING).
--
-- Every assertion records the ACTUAL value it saw, so a pass is inspectable
-- rather than a bare boolean.
-- =====================================================================
BEGIN;

CREATE TEMP TABLE passc_results(n int, test text, passed boolean, detail text)
ON COMMIT DROP;

DO $$
DECLARE
  a uuid; b uuid; c uuid; d uuid;
  attr uuid; val uuid; prod uuid;
  v_price numeric; v_dist int; v_src text; v_over boolean;
  v_cnt int; v_guarded int; v_unguarded int; v_maxdist int;
  v_prices numeric[];
BEGIN
  ------------------------------------------------------------------ fixtures
  -- Three genuine levels, plus D under the leaf declaring nothing.
  INSERT INTO public.product_categories(name) VALUES ('PASSC-A-root') RETURNING id INTO a;
  INSERT INTO public.product_categories(name, parent_category_id)
       VALUES ('PASSC-B-mid', a) RETURNING id INTO b;
  INSERT INTO public.product_categories(name, parent_category_id)
       VALUES ('PASSC-C-leaf', b) RETURNING id INTO c;
  INSERT INTO public.product_categories(name, parent_category_id)
       VALUES ('PASSC-D-child', c) RETURNING id INTO d;

  INSERT INTO public.product_attributes(name) VALUES ('PASSC-ATTR') RETURNING id INTO attr;
  INSERT INTO public.product_attribute_values(attribute_id, value)
       VALUES (attr, 'PASSC-VAL') RETURNING id INTO val;

  -- The SAME value declared at THREE different prices down one chain.
  INSERT INTO public.product_category_attribute_values(category_id, value_id, attribute_id, extra_price)
  VALUES (a, val, attr, 100.00), (b, val, attr, 200.00), (c, val, attr, 300.00);

  ------------------------------------------------- 1. NEAREST WINS (the leaf)
  SELECT count(*) INTO v_cnt
    FROM public.product_category_values_resolved
   WHERE category_id = c AND value_id = val;
  INSERT INTO passc_results VALUES (1,
    'resolved returns exactly ONE row for (leaf, value) — DISTINCT ON collapsed the three declarations',
    v_cnt = 1, format('rows=%s (expected 1)', v_cnt));

  SELECT extra_price, distance, source_category_name, overrides_ancestor
    INTO v_price, v_dist, v_src, v_over
    FROM public.product_category_values_resolved
   WHERE category_id = c AND value_id = val;
  INSERT INTO passc_results VALUES (2,
    'LEAF price wins: 300.00 from PASSC-C-leaf at distance 0 — not the middle''s 200 nor the root''s 100',
    v_price = 300.00 AND v_dist = 0 AND v_src = 'PASSC-C-leaf',
    format('price=%s distance=%s source=%s', v_price, v_dist, v_src));

  -- The winner must have been chosen among genuine alternatives, not been the
  -- only row present. Prove the losers exist in candidates.
  SELECT array_agg(extra_price ORDER BY distance) INTO v_prices
    FROM public.product_category_value_candidates
   WHERE category_id = c AND value_id = val;
  INSERT INTO passc_results VALUES (3,
    'the two LOSING declarations were genuinely present (candidates = 300,200,100 by distance)',
    v_prices = ARRAY[300.00, 200.00, 100.00],
    format('candidates=%s', v_prices));

  INSERT INTO passc_results VALUES (4,
    'leaf row is flagged overrides_ancestor',
    v_over IS TRUE, format('overrides_ancestor=%s', v_over));

  ------------------------------------- 2. the leaf does NOT leak upward
  SELECT extra_price, distance, source_category_name, overrides_ancestor
    INTO v_price, v_dist, v_src, v_over
    FROM public.product_category_values_resolved
   WHERE category_id = b AND value_id = val;
  INSERT INTO passc_results VALUES (5,
    'MIDDLE resolves to its own 200.00 — a child''s declaration does not travel up',
    v_price = 200.00 AND v_dist = 0 AND v_src = 'PASSC-B-mid' AND v_over IS TRUE,
    format('price=%s distance=%s source=%s overrides=%s', v_price, v_dist, v_src, v_over));

  SELECT extra_price, distance, overrides_ancestor INTO v_price, v_dist, v_over
    FROM public.product_category_values_resolved
   WHERE category_id = a AND value_id = val;
  INSERT INTO passc_results VALUES (6,
    'ROOT resolves to 100.00, overrides_ancestor FALSE (nothing above it declares)',
    v_price = 100.00 AND v_dist = 0 AND v_over IS FALSE,
    format('price=%s distance=%s overrides=%s', v_price, v_dist, v_over));

  ------------------------------------- 3. pure inheritance, no local declaration
  SELECT extra_price, distance, source_category_name, overrides_ancestor
    INTO v_price, v_dist, v_src, v_over
    FROM public.product_category_values_resolved
   WHERE category_id = d AND value_id = val;
  INSERT INTO passc_results VALUES (7,
    'D declares nothing: inherits the NEAREST declaration (leaf 300.00 at distance 1), not the root''s 100',
    v_price = 300.00 AND v_dist = 1 AND v_src = 'PASSC-C-leaf' AND v_over IS FALSE,
    format('price=%s distance=%s source=%s overrides=%s', v_price, v_dist, v_src, v_over));

  ------------------------------------------------------- 4. THE CYCLE GUARD
  -- Nothing in the database prevents this. A -> B -> C -> D -> A.
  UPDATE public.product_categories SET parent_category_id = d WHERE id = a;

  SELECT count(*), max(distance) INTO v_guarded, v_maxdist
    FROM public.product_category_ancestors
   WHERE category_id IN (a, b, c, d);
  INSERT INTO passc_results VALUES (8,
    'guarded walk TERMINATES on a 4-cycle: 4 categories x 4 reachable = 16 rows, max distance 3',
    v_guarded = 16 AND v_maxdist = 3,
    format('rows=%s max_distance=%s (expected 16 / 3)', v_guarded, v_maxdist));

  -- NEGATIVE CONTROL: the same recursion with the `seen` guard REMOVED, capped
  -- at distance 50 so it cannot run away. If UNION were what terminates a
  -- cycle, this would stop on its own and match the guarded count. It does not
  -- — it runs to the cap, because each row carries an incrementing distance and
  -- so is never a duplicate.
  WITH RECURSIVE unguarded AS (
    SELECT cat.id AS category_id, cat.id AS ancestor_id, 0 AS distance
      FROM public.product_categories cat WHERE cat.id IN (a, b, c, d)
    UNION
    SELECT u.category_id, p.parent_category_id, u.distance + 1
      FROM unguarded u
      JOIN public.product_categories p ON p.id = u.ancestor_id
     WHERE p.parent_category_id IS NOT NULL
       AND u.distance < 50
  )
  SELECT count(*), max(distance) INTO v_unguarded, v_maxdist FROM unguarded;
  INSERT INTO passc_results VALUES (9,
    'NEGATIVE CONTROL: without the seen-array guard the SAME UNION recursion runs to the 50 cap (204 rows) instead of stopping — UNION is NOT the terminator',
    v_unguarded = 204 AND v_maxdist = 50 AND v_unguarded > v_guarded,
    format('unguarded rows=%s max_distance=%s vs guarded %s (expected 204 / 50 / 16)',
           v_unguarded, v_maxdist, v_guarded));

  -- and the resolved view is still CORRECT under a cycle, not merely finite
  SELECT count(*) INTO v_cnt
    FROM public.product_category_values_resolved
   WHERE category_id IN (a, b, c, d) AND value_id = val;
  SELECT extra_price INTO v_price
    FROM public.product_category_values_resolved
   WHERE category_id = d AND value_id = val;
  INSERT INTO passc_results VALUES (10,
    'under a cycle the resolved view still returns one row per category and D still nearest-wins at 300.00',
    v_cnt = 4 AND v_price = 300.00,
    format('rows=%s d_price=%s (expected 4 / 300.00)', v_cnt, v_price));

  UPDATE public.product_categories SET parent_category_id = NULL WHERE id = a;

  ------------------------------------------------- 5. THE UNCATEGORISED CASE
  INSERT INTO public.products(sku, name, category_id)
       VALUES ('PASSC-NOCAT', 'PASSC uncategorised product', NULL) RETURNING id INTO prod;

  BEGIN
    SELECT count(*) INTO v_cnt
      FROM public.product_category_values_resolved r
     WHERE r.category_id = (SELECT p.category_id FROM public.products p WHERE p.id = prod);
    INSERT INTO passc_results VALUES (11,
      'an UNCATEGORISED product resolves to ZERO values and does not error (no fallback to all values)',
      v_cnt = 0, format('rows=%s (expected 0)', v_cnt));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO passc_results VALUES (11,
      'an UNCATEGORISED product resolves to ZERO values and does not error',
      false, format('ERRORED %s: %s', SQLSTATE, SQLERRM));
  END;

  -- and the categorised comparison, so test 11 is not vacuously true
  SELECT count(*) INTO v_cnt
    FROM public.product_category_values_resolved r
   WHERE r.category_id = c;
  INSERT INTO passc_results VALUES (12,
    'control for 11: the SAME query for a CATEGORISED product returns rows, so zero was a real answer',
    v_cnt > 0, format('rows=%s (expected > 0)', v_cnt));
END $$;

SELECT n, CASE WHEN passed THEN 'PASS' ELSE '*** FAIL ***' END AS result, test, detail
  FROM passc_results ORDER BY n;

ROLLBACK;
