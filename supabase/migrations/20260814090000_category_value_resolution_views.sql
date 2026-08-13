-- =====================================================================
-- CATEGORY-SCOPED ATTRIBUTE VALUES — PASS C: resolution
-- =====================================================================
--
-- FOR REVIEW. Approved by V on 2026-08-14.
--
-- THE SINGLE DEFINITION OF THE RULE. Both resolvers — the variant editor
-- (listAssignedAttributes) and the made-to-order picker
-- (listAttributesForProduct) — read these views. Nothing may reimplement the
-- walk in TypeScript; the Pass B config screen's display-only walk is deleted
-- in the same commit for exactly that reason.
--
-- THREE VIEWS, ONE RECURSION, one job each:
--
--   product_category_ancestors        the recursive walk: a category, itself at
--                                     distance 0, plus every ancestor
--   product_category_value_candidates ancestors JOIN the links — EVERY
--                                     declaration reachable from a category,
--                                     including ones an override will beat.
--                                     The config screen needs these to show
--                                     "overrides <Ancestor>"
--   product_category_values_resolved  DISTINCT ON over candidates — NEAREST
--                                     WINS. This is what the resolvers read
--
-- NEAREST WINS, stated rather than implied: where a value is declared on a
-- category AND inherited from an ancestor, the declaration with the SMALLEST
-- distance supplies the price. distance 0 is the category itself, so a child
-- always beats its parent. The DISTINCT ON + ORDER BY below is the mechanism;
-- `distance` and `source_category_id` are exposed so a consumer can show which
-- declaration won rather than having to trust it.
--
-- ⚠ THE CYCLE GUARD IS THE `seen` ARRAY, NOT `UNION`.
-- Nothing in the database prevents a loop in product_categories.parent_category_id
-- — only the config form's dropdown does. UNION deduplicates identical rows, so
-- it is the usual advice for terminating a recursive CTE. It is NOT sufficient
-- here, and this was measured rather than assumed:
--
--     with recursive t(node, depth) as (
--       select 'A', 0
--       union
--       select case when t.node='A' then 'B' else 'A' end, t.depth + 1
--         from t where t.depth < 12)
--     select count(*) from t;    -->  13 rows, still climbing
--
-- Because each row carries an incrementing `distance`, no two rows are ever
-- equal and UNION's dedup never fires. UNION is kept as asked and costs
-- nothing, but the thing that actually terminates a cycle is the explicit
-- `NOT (... = ANY(seen))` test.
--
-- SECURITY. Each view is security_invoker, so the querying user's RLS applies
-- to the underlying tables rather than the view owner's. The base tables are
-- readable by any authenticated user, so this changes nothing today; it means
-- the views cannot become a way around RLS if those policies ever tighten.
--
-- Rule 4: nothing dropped, nothing deleted. Three new views; no table, column,
-- policy or trigger is altered.

BEGIN;

-- 1 ------------------------------------------------- the recursive ancestry

CREATE VIEW public.product_category_ancestors
WITH (security_invoker = true) AS
WITH RECURSIVE walk AS (
  -- distance 0: a category is its own nearest "ancestor". This is what makes a
  -- local declaration beat an inherited one without a special case.
  SELECT
    c.id            AS category_id,
    c.id            AS ancestor_id,
    0               AS distance,
    ARRAY[c.id]     AS seen
  FROM public.product_categories c

  UNION

  SELECT
    w.category_id,
    parent.parent_category_id,
    w.distance + 1,
    w.seen || parent.parent_category_id
  FROM walk w
  JOIN public.product_categories parent ON parent.id = w.ancestor_id
  WHERE parent.parent_category_id IS NOT NULL
    -- The guard. See the header: UNION alone cannot stop this.
    AND NOT (parent.parent_category_id = ANY (w.seen))
)
SELECT
  w.category_id,
  w.ancestor_id,
  w.distance,
  a.name AS ancestor_name
FROM walk w
JOIN public.product_categories a ON a.id = w.ancestor_id;

COMMENT ON VIEW public.product_category_ancestors IS
  'A category, itself at distance 0, plus every ancestor. The ONLY recursive '
  'walk of product_categories.parent_category_id — cycle-guarded by a visited '
  'array, because UNION cannot dedupe rows carrying an incrementing distance.';

-- 2 -------------------------------------- every declaration reachable

CREATE VIEW public.product_category_value_candidates
WITH (security_invoker = true) AS
SELECT
  anc.category_id,
  l.value_id,
  l.attribute_id,
  l.extra_price,
  anc.ancestor_id   AS source_category_id,
  anc.ancestor_name AS source_category_name,
  anc.distance
FROM public.product_category_ancestors anc
JOIN public.product_category_attribute_values l
  ON l.category_id = anc.ancestor_id;

COMMENT ON VIEW public.product_category_value_candidates IS
  'Every value declaration reachable from a category, including ones a nearer '
  'declaration overrides. Configuration screens read this to show that an '
  'override is happening; resolvers must read '
  'product_category_values_resolved instead.';

-- 3 ------------------------------------------------ nearest wins

CREATE VIEW public.product_category_values_resolved
WITH (security_invoker = true) AS
SELECT DISTINCT ON (c.category_id, c.value_id)
  c.category_id,
  c.value_id,
  c.attribute_id,
  c.extra_price,
  c.source_category_id,
  c.source_category_name,
  c.distance,
  -- True when a further-away declaration was beaten by this one. Lets a screen
  -- say "overrides" without re-deriving the rule.
  (c.distance = 0 AND EXISTS (
     SELECT 1 FROM public.product_category_value_candidates o
      WHERE o.category_id = c.category_id
        AND o.value_id    = c.value_id
        AND o.distance    > 0
   )) AS overrides_ancestor
FROM public.product_category_value_candidates c
-- NEAREST WINS. Smallest distance first; distance 0 is the category itself.
ORDER BY c.category_id, c.value_id, c.distance ASC;

COMMENT ON VIEW public.product_category_values_resolved IS
  'The allowed attribute values for a category, one row per value, with the '
  'effective extra_price. NEAREST WINS: where a value is declared on the '
  'category and also inherited, the smallest distance supplies the price, so a '
  'child overrides its parent. This view is the single definition of that rule '
  '— no client may reimplement it.';

COMMIT;
