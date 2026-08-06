-- =====================================================================
-- INVENTORY RESET - STEP 4, MIGRATION A: schema changes (inv_* ONLY)
-- =====================================================================
--
-- Three requested changes plus one that item 4 cannot work without:
--   1. inv_operation_state gains 'in_progress', positioned between ready and done
--   2. inv_purchase_order_line gains UNIQUE (order_id, product_id)
--   3. the Step 3 transition guard learns the new state
--   4. inv_test_template gains is_required  <-- see note below
--
-- (4) IS NOT SCOPE CREEP, IT IS A DEPENDENCY. Migration B's QC gate promotes a
-- unit only when "every REQUIRED test passed", but the Step 2 table has no way
-- to say a test is required - it has requires_value and requires_attachment,
-- which describe how a result is captured, not whether the test must pass.
-- Without is_required the gate can only mean "every active test", which removes
-- the ability to have an advisory check. Defaults to true, so existing
-- behaviour is the strict one.
--
-- THIS MIGRATION DOES NOT touch products, CRM, or the old inventory module,
-- and reuses none of the four legacy function names.
--
-- Apply BEFORE 20260807160000_inv_receipt_workflow_step4b.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. NEW ENUM VALUE
-- ---------------------------------------------------------------------
-- Deliberately OUTSIDE any explicit transaction. PostgreSQL 12+ permits
-- ALTER TYPE ... ADD VALUE inside a transaction block, but the new value
-- cannot be USED until that transaction commits. Running it standalone
-- removes the restriction entirely and keeps the rest of the file simple.
--
-- BEFORE 'done' puts the enum in lifecycle order:
--   draft, waiting, ready, in_progress, done, cancelled

ALTER TYPE public.inv_operation_state ADD VALUE IF NOT EXISTS 'in_progress' BEFORE 'done';


BEGIN;

-- ---------------------------------------------------------------------
-- 2. ONE LINE PER PRODUCT PER ORDER
-- ---------------------------------------------------------------------
-- RULE: a purchase order may not list the same product twice.
--
-- This is what makes received_qty countable. Migration B recomputes a line's
-- received quantity by counting the units that arrived for that product on
-- receipts citing this order; with two lines for one product that count has
-- no correct home and both lines would show the full total. Forbidding the
-- shape removes the ambiguity rather than papering over it.
--
-- Safe to add: inv_purchase_order_line is empty.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.inv_purchase_order_line'::regclass
       AND conname  = 'inv_purchase_order_line_unique_product'
  ) THEN
    ALTER TABLE public.inv_purchase_order_line
      ADD CONSTRAINT inv_purchase_order_line_unique_product
      UNIQUE (order_id, product_id);
  END IF;
END $$;

COMMENT ON CONSTRAINT inv_purchase_order_line_unique_product
  ON public.inv_purchase_order_line IS
  'One line per product per order. Order more of the same product by raising ordered_qty, not by adding a second line - this is what keeps received_qty unambiguous.';


-- ---------------------------------------------------------------------
-- 3. REQUIRED vs ADVISORY QC TESTS
-- ---------------------------------------------------------------------
-- RULE: a required test must pass before a unit becomes sellable. An advisory
-- test is recorded and surfaced, but failing it flags the unit rather than
-- rejecting it.

ALTER TABLE public.inv_test_template
  ADD COLUMN IF NOT EXISTS is_required boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.inv_test_template.is_required IS
  'True: the unit cannot leave quarantine until this test passes. False: advisory - a failure marks the unit attention rather than rejected.';


-- ---------------------------------------------------------------------
-- 4. REVISED OPERATION STATE MACHINE
-- ---------------------------------------------------------------------
-- Replaces the Step 3 body of inv_operation_state_allowed with one that knows
-- about in_progress. Same name, same signature, same single-place-to-edit
-- design; only the VALUES list changes.
--
-- FULL REVISED LIST (draft, waiting, ready, in_progress, done, cancelled):
--
--   draft       -> waiting, ready, cancelled
--   waiting     -> draft, ready, cancelled
--   ready       -> draft, waiting, in_progress, done, cancelled
--   in_progress -> ready, done, cancelled
--   done        -> (terminal)
--   cancelled   -> (terminal)
--
-- Notes on the choices:
--   * ready -> done is KEPT. A receipt whose moves all complete in one action
--     never passes through in_progress, and forcing a detour would be noise.
--   * in_progress -> ready is allowed so derivation can walk back if every
--     completed move is later cancelled. It is a correction, not a reversal
--     of completed work.
--   * in_progress -> draft is NOT allowed. Once units are on the document,
--     returning it to draft would misrepresent it as untouched.
--   * done and cancelled remain terminal, exactly as in Step 3.
--
-- The body compares ::text, so it neither depends on nor is affected by enum
-- sort order.

CREATE OR REPLACE FUNCTION public.inv_operation_state_allowed(
  p_old public.inv_operation_state,
  p_new public.inv_operation_state
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_old = p_new
      OR (p_old::text, p_new::text) IN (VALUES
            -- from           to
            ('draft',       'waiting'),
            ('draft',       'ready'),
            ('draft',       'cancelled'),
            ('waiting',     'draft'),
            ('waiting',     'ready'),
            ('waiting',     'cancelled'),
            ('ready',       'draft'),
            ('ready',       'waiting'),
            ('ready',       'in_progress'),
            ('ready',       'done'),
            ('ready',       'cancelled'),
            ('in_progress', 'ready'),
            ('in_progress', 'done'),
            ('in_progress', 'cancelled')
            -- 'done' and 'cancelled' are terminal: no rows, deliberately.
         );
$$;

COMMENT ON FUNCTION public.inv_operation_state_allowed IS
  'Single source of truth for legal inv_operation_state transitions, including in_progress. done and cancelled are terminal.';

COMMIT;
