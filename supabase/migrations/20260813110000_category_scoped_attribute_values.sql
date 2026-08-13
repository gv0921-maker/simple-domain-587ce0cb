-- =====================================================================
-- CATEGORY-SCOPED ATTRIBUTE VALUES — PASS A: schema only
-- =====================================================================
--
-- FOR REVIEW. NOT APPLIED. Approved by V on 2026-08-13.
--
-- WHAT THIS IS FOR
-- Attribute values are global today: every product that has `Model` assigned
-- sees every model number in the business. The requirement is that a value list
-- belongs to a product CATEGORY — all wooden furniture draws on one Model list
-- (001-099), branded ranges have their own schemes — while the values
-- themselves stay shared, because "012" is the same design concept on a chair
-- and on a table.
--
-- So the category declares which VALUES apply. It does NOT declare which
-- ATTRIBUTES apply: `product_attribute_assignments` already does that per
-- product and is read by Sales' CustomizationPicker. The two compose —
-- a product's options for an attribute are the values of that attribute
-- allowed for its category. Scoping sits ABOVE assignment; it does not replace
-- it.
--
-- SHIPS INERT. Nothing reads this table after this migration. No existing row
-- changes, no column is altered, no policy or trigger elsewhere is touched.
-- The resolvers are Pass C.
--
-- NOTHING IS BACKFILLED, deliberately. Every category, attribute value and
-- product in the database today is test data created while building, and it is
-- wiped at go-live. The real vocabulary (Wood TK/ATK/Rubberwood, Model 001-099,
-- Polish GLF11-GLF77) is entered later against finished scoping, so a backfill
-- would only be thrown away.
--
-- Rule 4: nothing dropped, nothing deleted.

BEGIN;

-- 1 ------------------------------------------- the category -> value link

CREATE TABLE public.product_category_attribute_values (
  category_id  uuid NOT NULL
                 REFERENCES public.product_categories(id) ON DELETE CASCADE,

  value_id     uuid NOT NULL,

  -- Denormalised so the resolver can filter by attribute without joining back
  -- to product_attribute_values. It is NOT free-floating: the composite FK
  -- below proves it matches the value's real attribute, so it cannot drift.
  attribute_id uuid NOT NULL,

  /*
   * PER-CATEGORY PRICE ADJUSTMENT.
   *
   * NOT NULL DEFAULT 0, and 0 means "adds nothing". There is deliberately NO
   * fallback to product_attribute_values.extra_price.
   *
   * The decision this encodes is V's: pricing is per category, not global.
   * A nullable column meaning "fall back to the global figure" would put the
   * global column silently back in charge of every link where someone did not
   * type a number — which is exactly the two-sources-of-truth problem this
   * change exists to remove. Once a value is scoped to a category, that
   * category's row is the whole answer.
   *
   * Note this is the OPPOSITE call to products.weight/volume, where NULL was
   * kept meaningful because "never measured" and "weighs nothing" are different
   * facts. A price adjustment has no such gap: "adds nothing" is a complete,
   * ordinary answer, not a missing measurement. DEFAULT 0 also means linking a
   * value is a one-field action and pricing it is opt-in.
   */
  extra_price  numeric(14,2) NOT NULL DEFAULT 0,

  created_at   timestamptz NOT NULL DEFAULT now(),

  -- One row per value per category. Also the index the resolver uses to walk
  -- from a category (and its ancestors) to its allowed values.
  PRIMARY KEY (category_id, value_id),

  -- The value must really belong to the attribute it is filed under. Backed by
  -- product_attribute_values_id_attribute_key, the UNIQUE (id, attribute_id)
  -- added in Pass 10B for exactly this kind of composite reference.
  --
  -- RESTRICT, not CASCADE: a value in use by a category is not something to
  -- remove silently. The refusal is the point.
  CONSTRAINT pcav_value_matches_attribute
    FOREIGN KEY (value_id, attribute_id)
    REFERENCES public.product_attribute_values (id, attribute_id)
    ON DELETE RESTRICT,

  CONSTRAINT pcav_extra_price_nonneg CHECK (extra_price >= 0)
);

COMMENT ON TABLE public.product_category_attribute_values IS
  'Which attribute values a product category may draw on, with that category''s '
  'own price adjustment. Values stay shared across categories — the same "012" '
  'is one row in product_attribute_values — and only the permission to use it, '
  'and its price, are per category. Inheritance is DOWNWARD: a product may use '
  'the values of its category and of every ancestor.';

COMMENT ON COLUMN public.product_category_attribute_values.extra_price IS
  'Price adjustment for this value IN THIS CATEGORY. Authoritative — it does '
  'not fall back to product_attribute_values.extra_price. 0 means adds nothing.';

COMMENT ON COLUMN public.product_category_attribute_values.attribute_id IS
  'Denormalised copy of the value''s attribute, proven correct by the composite '
  'FK. Present so the resolver can filter by attribute without a second join.';

-- "Which categories offer this value", and attribute-first resolution.
CREATE INDEX product_category_attribute_values_attr_value_idx
  ON public.product_category_attribute_values (attribute_id, value_id);

-- 2 --------------------------------------------------------------------- RLS
--
-- Mirrors product_attribute_values, its sibling: the vocabulary and the
-- permission to use it are the same class of configuration and belong to the
-- same people. Readable by anyone authenticated because every product screen
-- needs it; writable by admins only.
--
-- DELETE is permitted here, unlike variants or checklists. A link row is pure
-- configuration — "this category may use this value" — and carries no history:
-- un-ticking a value is not erasing a record of something that happened. The
-- same reasoning already applies to product_attribute_assignments, which is
-- maintained by delete-and-reinsert.

ALTER TABLE public.product_category_attribute_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY pcav_select_auth
  ON public.product_category_attribute_values
  FOR SELECT USING (true);

CREATE POLICY pcav_insert_admin
  ON public.product_category_attribute_values
  FOR INSERT WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY pcav_update_admin
  ON public.product_category_attribute_values
  FOR UPDATE USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY pcav_delete_admin
  ON public.product_category_attribute_values
  FOR DELETE USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

COMMIT;
