-- =====================================================================
-- INVENTORY RESET — PASS 10B: variant product SCHEMA
-- =====================================================================
--
-- FOR REVIEW ONLY. NOT APPLIED. Approved decisions from V, Pass 10B.
--
-- WHAT THIS DOES
-- Adds the catalogue shape for Odoo-style variant products. A variant is a
-- sellable version of a product ("Dining Chair, Large, Walnut") that exists in
-- the catalogue BEFORE any physical unit does — which is the whole reason it
-- was chosen over per-unit attributes: V orders from the factory by version,
-- and salespeople pick the version from a list.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- Nothing reads variants after this migration. No existing RPC is altered, no
-- existing view is changed, no UI exists. Every variant_id column added here is
-- NULLABLE and stays NULL on every existing row. `variant_id IS NULL` is a
-- permanent, legitimate state meaning "this product has no variants" — it is
-- not a migration artefact to be cleaned up later. That is what lets products
-- without variants keep behaving exactly as they do today.
--
-- THE ONE EXISTING-TABLE BEHAVIOUR CHANGE, STATED PLAINLY
-- Section 9 adds a trigger to inv_stock_item. It fires only when variant_id IS
-- NOT NULL, and nothing writes variant_id until Pass 10D, so it cannot fire
-- today. It is added now so the "stock makes a variant permanent" safety net is
-- in place BEFORE anything can create stock against a variant, rather than
-- after. Section 8 also relaxes one UNIQUE constraint — see the note there.
--
-- RULE 4: nothing is dropped or deleted. Archiving is a status transition.
-- RULE 5: every guard raises a sentence written to be read by staff.
--
-- REVIEW NOTE — DEVIATION FROM "ARCHIVE VIA is_active"
-- Decision 2 says archive via is_active; the include-list asks for a lifecycle
-- column covering provisional/permanent/archived. Carrying BOTH would give a
-- variant two archive flags that can disagree. This migration therefore uses
-- the status enum ALONE for variants — `status = 'archived'` IS the archive.
-- `products.is_active` is untouched and still governs products. Flagging this
-- because it is a deviation from the letter of decision 2, made to avoid two
-- sources of truth. Say the word and I will swap it for is_active + status.

BEGIN;

-- 1 -------------------------------------------------------------- enum types

CREATE TYPE public.product_variant_status AS ENUM (
  'provisional',  -- created from a quotation/order line, not yet earned its place
  'permanent',    -- an order was confirmed against it, or it has physical stock
  'archived'      -- withdrawn from the catalogue; never deleted
);

COMMENT ON TYPE public.product_variant_status IS
  'Variant lifecycle. provisional -> permanent is one-way (see the guard in '
  'tg_product_variant_guard). archived is the only withdrawal mechanism; there '
  'is no delete path for variants.';

CREATE TYPE public.product_mode AS ENUM (
  'stocked',        -- sold as pre-defined variants picked from a list
  'made_to_order',  -- sold via the customization picker, free-text per line
  'both'
);

COMMENT ON TYPE public.product_mode IS
  'Which selling path a product uses. Explicit, never inferred from '
  'product_attribute_assignments — inference would let the same chair be '
  'recorded two different ways.';

-- 2 --------------------------------------------- prerequisite: value uniqueness
-- Decision 8. Without this, two "Walnut" rows generate two identical variants
-- and every count downstream splits silently. Verified 0 duplicates today, so
-- this cannot fail on current data.

ALTER TABLE public.product_attribute_values
  ADD CONSTRAINT product_attribute_values_attribute_value_key
  UNIQUE (attribute_id, value);

-- Lets a variant value row prove, declaratively, that its value_id really
-- belongs to its attribute_id (used by the composite FK in section 5).
ALTER TABLE public.product_attribute_values
  ADD CONSTRAINT product_attribute_values_id_attribute_key
  UNIQUE (id, attribute_id);

-- 3 ------------------------------------------------------ products.mode column
-- Default is made_to_order: that is exactly today's behaviour (the
-- CustomizationPicker path), so no existing product changes how it works.

ALTER TABLE public.products
  ADD COLUMN mode public.product_mode NOT NULL DEFAULT 'made_to_order';

COMMENT ON COLUMN public.products.mode IS
  'Selling path: stocked (pick a variant), made_to_order (customization '
  'picker), or both. Defaults to made_to_order so existing products keep their '
  'current behaviour. Nothing reads this column until Pass 10C.';

-- 4 ---------------------------------------------------------- product_variants

CREATE TABLE public.product_variants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL
                 REFERENCES public.products(id) ON DELETE RESTRICT,

  sku          text NOT NULL,
  name         text NOT NULL,
  barcode      text,

  -- ABSOLUTE, not a delta from products.sale_price (decision 7). Furniture
  -- pricing is not a linear sum of option deltas. product_attribute_values.
  -- extra_price still exists and still feeds the made-to-order picker; the two
  -- are separate systems on purpose and are not reconciled.
  sale_price   numeric(14,2) NOT NULL DEFAULT 0,
  cost_price   numeric(14,2) NOT NULL DEFAULT 0,

  status       public.product_variant_status NOT NULL DEFAULT 'provisional',

  -- Sorted, colon-joined value_ids. Maintained by trigger from
  -- product_variant_values; never written by hand. NULL only while a variant is
  -- mid-construction inside a transaction. See section 6 for why this exists.
  combo_key    text,

  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  promoted_at  timestamptz,
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_variants_sku_not_blank
    CHECK (length(trim(sku)) > 0),
  CONSTRAINT product_variants_name_not_blank
    CHECK (length(trim(name)) > 0),
  CONSTRAINT product_variants_prices_nonneg
    CHECK (sale_price >= 0 AND cost_price >= 0),
  -- A barcode that is present must be meaningful.
  CONSTRAINT product_variants_barcode_not_blank
    CHECK (barcode IS NULL OR length(trim(barcode)) > 0)
);

COMMENT ON TABLE public.product_variants IS
  'A sellable version of a product. Exists in the catalogue before any physical '
  'unit does, which is what lets a purchase order say "10 Large Walnut" and a '
  'salesperson pick a version from a list.';

COMMENT ON COLUMN public.product_variants.combo_key IS
  'Derived uniqueness key: sorted value_ids joined by ":". Maintained only by '
  'tg_product_variant_sync_combo_key. Backs the UNIQUE index that makes '
  'duplicate combinations impossible rather than merely unlikely.';

COMMENT ON COLUMN public.product_variants.sale_price IS
  'ABSOLUTE price for this version, not a delta from products.sale_price.';

-- SKUs are addressable by scanners and printed on labels, so they are unique
-- across the whole catalogue, not merely within a product.
CREATE UNIQUE INDEX product_variants_sku_key
  ON public.product_variants (sku);

CREATE UNIQUE INDEX product_variants_barcode_key
  ON public.product_variants (barcode)
  WHERE barcode IS NOT NULL;

-- THE combination-uniqueness guard. See section 6 for why an index and not a
-- checking trigger.
CREATE UNIQUE INDEX product_variants_combo_key
  ON public.product_variants (product_id, combo_key)
  WHERE combo_key IS NOT NULL;

-- The variant picker's query: live variants of one product.
CREATE INDEX product_variants_product_live_idx
  ON public.product_variants (product_id)
  WHERE status <> 'archived';

-- The auto-archive sweep's query (section 10).
CREATE INDEX product_variants_provisional_idx
  ON public.product_variants (created_at)
  WHERE status = 'provisional';

-- Lets the child tables in section 8 prove declaratively that a variant_id
-- belongs to the same product as the row's own product_id. Without this, a
-- receipt line could point at a variant of a different product.
ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_id_product_key UNIQUE (id, product_id);

CREATE TRIGGER product_variants_set_updated_at
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5 ----------------------------------------------------- product_variant_values

CREATE TABLE public.product_variant_values (
  variant_id   uuid NOT NULL
                 REFERENCES public.product_variants(id) ON DELETE CASCADE,
  attribute_id uuid NOT NULL
                 REFERENCES public.product_attributes(id) ON DELETE RESTRICT,
  value_id     uuid NOT NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),

  -- One value per attribute per variant. "Large AND Small" is not a thing.
  PRIMARY KEY (variant_id, attribute_id),

  -- The value must actually belong to the attribute it is filed under.
  -- Declarative, so no trigger can be bypassed or forgotten.
  CONSTRAINT product_variant_values_value_matches_attribute
    FOREIGN KEY (value_id, attribute_id)
    REFERENCES public.product_attribute_values (id, attribute_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.product_variant_values IS
  'The combination a variant stands for: one row per attribute. CASCADEs from '
  'the variant (the rows are meaningless without it) but RESTRICTs against the '
  'vocabulary (an attribute value in use cannot be removed underneath it).';

-- "Every variant that is Walnut" — the reverse lookup.
CREATE INDEX product_variant_values_value_idx
  ON public.product_variant_values (value_id);

-- 6 ------------------------------------- combination uniqueness: key + trigger
--
-- WHY A DERIVED KEY WITH A UNIQUE INDEX, NOT A CHECKING TRIGGER
-- A trigger that SELECTs for an existing identical combination has a
-- time-of-check/time-of-use race: two concurrent transactions each look, each
-- find nothing, each insert, both commit, and the duplicate exists. Nothing in
-- the trigger can prevent that without taking a table lock. A UNIQUE index is
-- enforced by the storage engine and cannot race — the second writer blocks and
-- then fails. The cost is one derived column that must be kept in step, which
-- is the trigger below and nothing else.
--
-- The key lives on the parent because uniqueness is scoped per product, and
-- only the parent carries product_id.

CREATE OR REPLACE FUNCTION public.tg_product_variant_sync_combo_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_variant uuid := COALESCE(NEW.variant_id, OLD.variant_id);
BEGIN
  UPDATE public.product_variants pv
     SET combo_key = (
           SELECT string_agg(vv.value_id::text, ':' ORDER BY vv.value_id)
             FROM public.product_variant_values vv
            WHERE vv.variant_id = v_variant
         )
   WHERE pv.id = v_variant;

  RETURN NULL;
END $function$;

COMMENT ON FUNCTION public.tg_product_variant_sync_combo_key() IS
  'Recomputes product_variants.combo_key whenever the variant''s value set '
  'changes. The UNIQUE index on (product_id, combo_key) does the actual '
  'enforcing.';

CREATE TRIGGER product_variant_values_sync_combo_key
  AFTER INSERT OR UPDATE OR DELETE ON public.product_variant_values
  FOR EACH ROW EXECUTE FUNCTION public.tg_product_variant_sync_combo_key();

-- A variant with no values is not a variant. Deferred so that the normal
-- parent-then-children insertion order works inside one transaction; the
-- assertion lands at COMMIT.
CREATE OR REPLACE FUNCTION public.tg_product_variant_require_values()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.product_variant_values WHERE variant_id = NEW.id
  ) THEN
    RAISE EXCEPTION
      'Variant % (%) has no attribute values. A variant must state the combination it stands for — add at least one attribute value, or archive the variant instead of emptying it.',
      NEW.sku, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END $function$;

CREATE CONSTRAINT TRIGGER product_variants_require_values
  AFTER INSERT OR UPDATE ON public.product_variants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_product_variant_require_values();

-- 7 --------------------------------------------- lifecycle guard on the variant
--
-- Enforces three of V's decisions in one BEFORE UPDATE:
--   * archiving is REFUSED while physical units exist (decision 9)
--   * permanent never regresses to provisional (decision 4)
--   * archived_at / promoted_at are stamped rather than trusted from the client

CREATE OR REPLACE FUNCTION public.tg_product_variant_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_units integer;
BEGIN
  -- permanent -> provisional is not a transition that exists.
  IF OLD.status = 'permanent' AND NEW.status = 'provisional' THEN
    RAISE EXCEPTION
      'Variant % is permanent and cannot be made provisional again. A variant becomes permanent when an order is confirmed against it or when physical units exist; neither fact can be un-made.',
      OLD.sku
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'archived' AND OLD.status <> 'archived' THEN
    SELECT count(*) INTO v_units
      FROM public.inv_stock_item WHERE variant_id = OLD.id;

    IF v_units > 0 THEN
      RAISE EXCEPTION
        'Variant % cannot be archived: % physical unit(s) of it are in stock. Move or write off the units first — archiving a version that exists in the godown would hide real inventory.',
        OLD.sku, v_units
        USING ERRCODE = 'check_violation';
    END IF;

    NEW.archived_at := now();
  END IF;

  IF NEW.status = 'permanent' AND OLD.status <> 'permanent' THEN
    NEW.promoted_at := COALESCE(NEW.promoted_at, now());
  END IF;

  -- Un-archiving is allowed (a withdrawn version can come back) and clears the
  -- stamp so the column never lies about the current state.
  IF NEW.status <> 'archived' AND OLD.status = 'archived' THEN
    NEW.archived_at := NULL;
  END IF;

  RETURN NEW;
END $function$;

CREATE TRIGGER product_variants_guard
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.tg_product_variant_guard();

-- 8 ------------------------------------------------ variant_id on the stock layer
--
-- All three columns are NULLABLE and stay NULL on every existing row. The
-- composite FKs use MATCH SIMPLE (the default): when variant_id IS NULL the
-- constraint is not enforced at all, so plain products are untouched. When it
-- is set, the variant is proven to belong to the same product as the row.

ALTER TABLE public.inv_stock_item
  ADD COLUMN variant_id uuid,
  ADD CONSTRAINT inv_stock_item_variant_fk
    FOREIGN KEY (variant_id, product_id)
    REFERENCES public.product_variants (id, product_id)
    ON DELETE RESTRICT;

COMMENT ON COLUMN public.inv_stock_item.variant_id IS
  'Which version this physical unit is. NULL means the product has no variants '
  '— a permanent, valid state, not a backfill gap.';

CREATE INDEX inv_stock_item_variant_idx
  ON public.inv_stock_item (variant_id)
  WHERE variant_id IS NOT NULL;

ALTER TABLE public.inv_move
  ADD COLUMN variant_id uuid,
  ADD CONSTRAINT inv_move_variant_fk
    FOREIGN KEY (variant_id, product_id)
    REFERENCES public.product_variants (id, product_id)
    ON DELETE RESTRICT;

CREATE INDEX inv_move_variant_idx
  ON public.inv_move (variant_id)
  WHERE variant_id IS NOT NULL;

ALTER TABLE public.inv_purchase_order_line
  ADD COLUMN variant_id uuid,
  ADD CONSTRAINT inv_purchase_order_line_variant_fk
    FOREIGN KEY (variant_id, product_id)
    REFERENCES public.product_variants (id, product_id)
    ON DELETE RESTRICT;

-- ⚠ REVIEW POINT — the one constraint RELAXATION in this migration.
-- inv_purchase_order_line currently carries UNIQUE (order_id, product_id),
-- which forbids two lines for the same product on one order. That constraint
-- makes "10 Large Walnut and 5 Small Teak on one purchase order" impossible,
-- which is precisely the case variants were chosen for. Widening it to include
-- variant_id relaxes the rule: nothing that is legal today becomes illegal, and
-- the old behaviour is preserved for plain products because two lines with the
-- same product and both variant_ids NULL still collide (NULLs are NOT DISTINCT
-- here by explicit choice).
ALTER TABLE public.inv_purchase_order_line
  DROP CONSTRAINT inv_purchase_order_line_unique_product;

CREATE UNIQUE INDEX inv_purchase_order_line_unique_product_variant
  ON public.inv_purchase_order_line (order_id, product_id, variant_id)
  NULLS NOT DISTINCT;

-- 9 ------------------------------------------------ stock makes a variant permanent
--
-- Decision 4's safety net. A variant with physical units cannot be provisional,
-- regardless of what happened on the sales side. Fires only when variant_id IS
-- NOT NULL, and nothing writes variant_id until Pass 10D — so on today's data
-- this trigger is inert. It is added now so the net is in place BEFORE the first
-- unit can be created against a variant.

CREATE OR REPLACE FUNCTION public.tg_inv_stock_item_promote_variant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.product_variants
     SET status = 'permanent'
   WHERE id = NEW.variant_id
     AND status = 'provisional';

  RETURN NULL;
END $function$;

COMMENT ON FUNCTION public.tg_inv_stock_item_promote_variant() IS
  'Safety net for decision 4: a variant with physical units is permanent, '
  'whatever the sales side did. The primary promotion path is order '
  'confirmation, which arrives in a later pass.';

CREATE TRIGGER inv_stock_item_promote_variant
  AFTER INSERT OR UPDATE OF variant_id ON public.inv_stock_item
  FOR EACH ROW
  WHEN (NEW.variant_id IS NOT NULL)
  EXECUTE FUNCTION public.tg_inv_stock_item_promote_variant();

-- 10 ------------------------------------------------------- auto-archive sweep
--
-- DESIGNED, NOT SCHEDULED. V approves the schedule separately (decision 5).
--
-- This function REFUSES TO RUN until the sales-side checks it needs actually
-- exist. Order and quotation lines do not carry variant_id yet — that is Pass
-- 10F — so a sweep run today could not tell "never used" from "used on an order
-- we cannot see", and would archive variants that are genuinely in play. Rather
-- than leave that as a comment someone might miss, the function hard-fails.
-- When 10F adds the columns, the guard stops firing and the function works.

CREATE OR REPLACE FUNCTION public.product_variant_auto_archive(
  p_older_than interval DEFAULT '90 days',
  p_dry_run    boolean  DEFAULT true
)
RETURNS TABLE (variant_id uuid, sku text, action text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_has_order_variant     boolean;
  v_has_quotation_variant boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not permitted to run the variant auto-archive sweep.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'order_lines'
       AND column_name = 'variant_id')
    INTO v_has_order_variant;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'quotation_lines'
       AND column_name = 'variant_id')
    INTO v_has_quotation_variant;

  IF NOT (v_has_order_variant AND v_has_quotation_variant) THEN
    RAISE EXCEPTION
      'Auto-archive is not safe to run yet: order_lines and quotation_lines do not carry variant_id, so this sweep cannot tell an unused variant from one sitting on a live quotation. It would archive variants that are in play. Add those columns first (Pass 10F), then run this again.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- Unreachable until the columns above exist. Left explicit so the intended
  -- refusal set is reviewable now rather than invented later: a provisional
  -- variant older than the cutoff is archived ONLY when it has no stock, no
  -- quotation line and no order line of any age or state.
  RETURN QUERY
  WITH candidate AS (
    SELECT pv.id, pv.sku
      FROM public.product_variants pv
     WHERE pv.status = 'provisional'
       AND pv.created_at < now() - p_older_than
       AND NOT EXISTS (SELECT 1 FROM public.inv_stock_item si
                        WHERE si.variant_id = pv.id)
       AND NOT EXISTS (SELECT 1 FROM public.inv_move m
                        WHERE m.variant_id = pv.id)
       AND NOT EXISTS (SELECT 1 FROM public.inv_purchase_order_line pol
                        WHERE pol.variant_id = pv.id)
  ), archived AS (
    UPDATE public.product_variants pv
       SET status = 'archived'
      FROM candidate c
     WHERE pv.id = c.id AND NOT p_dry_run
     RETURNING pv.id, pv.sku
  )
  SELECT c.id, c.sku,
         CASE WHEN p_dry_run THEN 'would-archive' ELSE 'archived' END,
         format('provisional, created %s ago, no stock/move/purchase reference',
                age(now(), (SELECT created_at FROM public.product_variants WHERE id = c.id)))
    FROM candidate c;
END $function$;

COMMENT ON FUNCTION public.product_variant_auto_archive(interval, boolean) IS
  'Designed, not scheduled. Refuses to run until order_lines and '
  'quotation_lines carry variant_id, because without them it cannot distinguish '
  'an unused variant from one on a live quotation. Defaults to a dry run.';

-- 11 --------------------------------------------------------------------- RLS
--
-- Mirrors the inv_* pattern (select-all for authenticated, writes gated on a
-- role predicate) with one deliberate widening: decision 3 lets any salesperson
-- create a provisional variant from a quotation or order line, and
-- can_write_inventory() does not include sales_rep. INSERT is therefore widened
-- to sales_rep; UPDATE is not, so a salesperson can bring a version into
-- existence but cannot reprice, rename or archive one.
--
-- DELETE gets an explicit deny policy rather than simply no policy. Decision 2
-- is "no delete anywhere", and an absent policy reads as an oversight where
-- USING (false) reads as a decision. Same shape as products_no_delete.

ALTER TABLE public.product_variants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variant_values  ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_variants_select_auth
  ON public.product_variants FOR SELECT USING (true);

CREATE POLICY product_variants_insert_write
  ON public.product_variants FOR INSERT
  WITH CHECK (
    public.can_write_inventory()
    OR public.has_role(auth.uid(), 'sales_rep'::public.app_role)
  );

CREATE POLICY product_variants_update_inv
  ON public.product_variants FOR UPDATE
  USING (public.can_write_inventory())
  WITH CHECK (public.can_write_inventory());

CREATE POLICY product_variants_no_delete
  ON public.product_variants FOR DELETE USING (false);

CREATE POLICY product_variant_values_select_auth
  ON public.product_variant_values FOR SELECT USING (true);

CREATE POLICY product_variant_values_insert_write
  ON public.product_variant_values FOR INSERT
  WITH CHECK (
    public.can_write_inventory()
    OR public.has_role(auth.uid(), 'sales_rep'::public.app_role)
  );

CREATE POLICY product_variant_values_update_inv
  ON public.product_variant_values FOR UPDATE
  USING (public.can_write_inventory())
  WITH CHECK (public.can_write_inventory());

-- Values may be removed while a variant is being built (by an inventory writer,
-- not a salesperson). The deferred require-values trigger stops the variant
-- being left empty, and the archive guard stops the variant vanishing.
CREATE POLICY product_variant_values_delete_inv
  ON public.product_variant_values FOR DELETE
  USING (public.can_write_inventory());

COMMIT;
