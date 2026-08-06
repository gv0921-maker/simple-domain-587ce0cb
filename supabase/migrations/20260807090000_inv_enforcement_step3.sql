-- =====================================================================
-- INVENTORY RESET - STEP 3: enforcement layer (inv_* ONLY)
-- =====================================================================
--
-- Adds the functions, triggers and one view that make the Step 2 schema
-- self-defending. Everything here is new and `inv_`-prefixed.
--
-- THIS MIGRATION DOES NOT:
--   * drop, alter or rename ANY existing object
--   * touch `products`, CRM, or any table of the old inventory module
--   * reuse the four legacy names: inv_approve_adjustment,
--     inv_validate_stock_move, inv_save_stock_move, inv_delete_stock_move
--
-- Re-runnable: functions use CREATE OR REPLACE (all names are new, so nothing
-- existing is replaced); triggers are guarded on pg_trigger rather than
-- DROP ... IF EXISTS, so this migration never issues a DROP.
--
-- Depends on: 20260806120000_inv_schema_step2.sql
-- Reuses unchanged: public.update_updated_at_column(), public.is_admin(),
--                   public.can_write_inventory()
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1. APPEND-ONLY LEDGER
-- =====================================================================
-- RULE: a row in inv_stock_tracking, once written, can never be changed or
-- removed. RLS already omits UPDATE and DELETE policies, which stops ordinary
-- authenticated users. This trigger closes the remaining paths - SECURITY
-- DEFINER functions, the service role, and anything else that bypasses RLS.

CREATE OR REPLACE FUNCTION public.inv_tg_block_tracking_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION
    'inv_stock_tracking is an append-only ledger: % is not permitted on it. Correct a mistake by writing a new compensating tracking row, never by editing history.',
    TG_OP
    USING ERRCODE = 'check_violation';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.inv_stock_tracking'::regclass
                    AND tgname  = 'inv_stock_tracking_block_update') THEN
    CREATE TRIGGER inv_stock_tracking_block_update
      BEFORE UPDATE ON public.inv_stock_tracking
      FOR EACH ROW EXECUTE FUNCTION public.inv_tg_block_tracking_mutation();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.inv_stock_tracking'::regclass
                    AND tgname  = 'inv_stock_tracking_block_delete') THEN
    CREATE TRIGGER inv_stock_tracking_block_delete
      BEFORE DELETE ON public.inv_stock_tracking
      FOR EACH ROW EXECUTE FUNCTION public.inv_tg_block_tracking_mutation();
  END IF;

  -- TRUNCATE bypasses row-level triggers, so it needs its own statement-level one.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.inv_stock_tracking'::regclass
                    AND tgname  = 'inv_stock_tracking_block_truncate') THEN
    CREATE TRIGGER inv_stock_tracking_block_truncate
      BEFORE TRUNCATE ON public.inv_stock_tracking
      FOR EACH STATEMENT EXECUTE FUNCTION public.inv_tg_block_tracking_mutation();
  END IF;
END $$;


-- =====================================================================
-- 2. updated_at MAINTENANCE
-- =====================================================================
-- RULE: any row that can be edited stamps updated_at automatically.
--
-- Attaches the EXISTING public.update_updated_at_column() - unchanged, not
-- redefined - to the TEN inv_ tables that carry updated_at.
--
-- The other three carry created_at only and are immutable by design:
--   inv_stock_tracking (append-only ledger)
--   inv_move_line      (a movement that happened; amend by moving again)
--   inv_test_result    (retesting appends a new row, never edits the old)

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'inv_number_sequence','inv_warehouse','inv_location','inv_operation_type',
    'inv_purchase_order','inv_purchase_order_line','inv_operation','inv_move',
    'inv_stock_item','inv_test_template'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = format('public.%I', tbl)::regclass
                      AND tgname  = tbl || '_set_updated_at') THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
        tbl || '_set_updated_at', tbl);
    END IF;
  END LOOP;
END $$;


-- =====================================================================
-- 3. ADJUSTMENT COUNTERPARTY GUARD
-- =====================================================================
-- RULE: stock cannot appear from nowhere or vanish into nowhere. An adjustment
-- must name where the difference went. Exactly one side of the document is a
-- virtual location (inventory_loss, scrap or production) and the other side is
-- a real internal location.
--
-- Not expressible as a CHECK: the rule spans three tables (kind lives on
-- inv_operation_type, types live on inv_location, the row is inv_operation).
-- DEFERRABLE INITIALLY DEFERRED so a document may be assembled column by column
-- inside one transaction and is only judged at COMMIT.

CREATE OR REPLACE FUNCTION public.inv_tg_adjustment_counterparty()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_op          public.inv_operation%ROWTYPE;
  v_kind        public.inv_operation_kind;
  v_src_type    public.inv_location_type;
  v_dst_type    public.inv_location_type;
  v_src_virtual boolean;
  v_dst_virtual boolean;
  c_virtual     public.inv_location_type[] :=
                  ARRAY['inventory_loss','scrap','production']::public.inv_location_type[];
BEGIN
  /*
   * Re-read the row as it stands NOW rather than trusting NEW.
   *
   * This is what actually makes "assemble the document in any column order"
   * work. A deferred constraint trigger queues one event per row modification,
   * each carrying the tuple as of that modification, and every queued event
   * fires at COMMIT. Judging NEW would therefore fail on an intermediate state
   * -- INSERT with a null destination, UPDATE to fill it in -- even though the
   * committed row is perfectly legal.
   *
   * Re-reading makes every queued event evaluate the same final row, so the
   * check is idempotent and only the committed state is judged.
   */
  SELECT * INTO v_op FROM public.inv_operation WHERE id = NEW.id;

  -- Row was deleted later in the same transaction: nothing to judge.
  IF v_op.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ot.kind INTO v_kind
    FROM public.inv_operation_type ot
   WHERE ot.id = v_op.operation_type_id;

  -- Only adjustments are constrained here.
  IF v_kind IS DISTINCT FROM 'adjustment'::public.inv_operation_kind THEN
    RETURN NULL;
  END IF;

  IF v_op.source_location_id IS NULL OR v_op.dest_location_id IS NULL THEN
    RAISE EXCEPTION
      'Adjustment % must set both a source and a destination location: one side must be a virtual location (inventory_loss, scrap or production) and the other an internal location.',
      v_op.number
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT type INTO v_src_type FROM public.inv_location WHERE id = v_op.source_location_id;
  SELECT type INTO v_dst_type FROM public.inv_location WHERE id = v_op.dest_location_id;

  v_src_virtual := v_src_type = ANY (c_virtual);
  v_dst_virtual := v_dst_type = ANY (c_virtual);

  -- Exactly one side virtual - never both, never neither.
  IF v_src_virtual = v_dst_virtual THEN
    RAISE EXCEPTION
      'Adjustment % must have exactly one virtual counterparty. Source is %, destination is %. One side must be inventory_loss, scrap or production; the other must be internal.',
      v_op.number, v_src_type, v_dst_type
      USING ERRCODE = 'check_violation';
  END IF;

  -- The non-virtual side must be a real internal location.
  IF v_src_virtual AND v_dst_type <> 'internal'::public.inv_location_type THEN
    RAISE EXCEPTION
      'Adjustment % moves stock out of virtual location type % but its destination is type %, not internal.',
      v_op.number, v_src_type, v_dst_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_dst_virtual AND v_src_type <> 'internal'::public.inv_location_type THEN
    RAISE EXCEPTION
      'Adjustment % moves stock into virtual location type % but its source is type %, not internal.',
      v_op.number, v_dst_type, v_src_type
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.inv_operation'::regclass
                    AND tgname  = 'inv_operation_adjustment_counterparty') THEN
    CREATE CONSTRAINT TRIGGER inv_operation_adjustment_counterparty
      AFTER INSERT OR UPDATE ON public.inv_operation
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.inv_tg_adjustment_counterparty();
  END IF;
END $$;


-- =====================================================================
-- 4. STATE MACHINES
-- =====================================================================
-- RULE: a document may only move between states along a defined path, and
-- nothing ever leaves 'done' or 'cancelled'. The legal set lives in ONE place
-- per enum - edit the VALUES list, nothing else.
--
-- The Step 2 enums constrain the vocabulary; these functions constrain the
-- transitions. That distinction is the whole point: the old module had CHECK
-- constraints on status text and still allowed completed -> draft.

CREATE OR REPLACE FUNCTION public.inv_operation_state_allowed(
  p_old public.inv_operation_state,
  p_new public.inv_operation_state
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_old = p_new
      OR (p_old::text, p_new::text) IN (VALUES
            -- from      to
            ('draft',   'waiting'),
            ('draft',   'ready'),
            ('draft',   'cancelled'),
            ('waiting', 'draft'),
            ('waiting', 'ready'),
            ('waiting', 'cancelled'),
            ('ready',   'draft'),
            ('ready',   'waiting'),
            ('ready',   'done'),
            ('ready',   'cancelled')
            -- 'done' and 'cancelled' are terminal: no rows, deliberately.
         );
$$;

COMMENT ON FUNCTION public.inv_operation_state_allowed IS
  'Single source of truth for legal inv_operation_state transitions. done and cancelled are terminal.';


CREATE OR REPLACE FUNCTION public.inv_move_state_allowed(
  p_old public.inv_move_state,
  p_new public.inv_move_state
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_old = p_new
      OR (p_old::text, p_new::text) IN (VALUES
            ('draft',     'confirmed'),
            ('draft',     'cancelled'),
            ('confirmed', 'draft'),
            ('confirmed', 'assigned'),
            ('confirmed', 'cancelled'),
            ('assigned',  'confirmed'),
            ('assigned',  'done'),
            ('assigned',  'cancelled')
            -- 'done' and 'cancelled' are terminal.
         );
$$;

COMMENT ON FUNCTION public.inv_move_state_allowed IS
  'Single source of truth for legal inv_move_state transitions. done and cancelled are terminal.';


CREATE OR REPLACE FUNCTION public.inv_tg_guard_operation_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.inv_operation_state_allowed(OLD.state, NEW.state) THEN
    RAISE EXCEPTION
      'Illegal state transition on operation %: % -> %. %',
      COALESCE(NEW.number, NEW.id::text), OLD.state, NEW.state,
      CASE WHEN OLD.state IN ('done','cancelled')
           THEN format('%s is a terminal state and cannot be left.', OLD.state)
           ELSE 'See public.inv_operation_state_allowed for the legal set.' END
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.inv_tg_guard_move_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.inv_move_state_allowed(OLD.state, NEW.state) THEN
    RAISE EXCEPTION
      'Illegal state transition on move %: % -> %. %',
      NEW.id, OLD.state, NEW.state,
      CASE WHEN OLD.state IN ('done','cancelled')
           THEN format('%s is a terminal state and cannot be left.', OLD.state)
           ELSE 'See public.inv_move_state_allowed for the legal set.' END
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.inv_operation'::regclass
                    AND tgname  = 'inv_operation_guard_state') THEN
    CREATE TRIGGER inv_operation_guard_state
      BEFORE UPDATE OF state ON public.inv_operation
      FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
      EXECUTE FUNCTION public.inv_tg_guard_operation_state();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.inv_move'::regclass
                    AND tgname  = 'inv_move_guard_state') THEN
    CREATE TRIGGER inv_move_guard_state
      BEFORE UPDATE OF state ON public.inv_move
      FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
      EXECUTE FUNCTION public.inv_tg_guard_move_state();
  END IF;
END $$;


-- =====================================================================
-- 5. NUMBER ALLOCATOR
-- =====================================================================
-- RULE: document numbers come from one place, are never reused, and never
-- collide - even when two people save at the same instant.
--
-- Concurrency: a single UPDATE ... RETURNING takes the row lock and increments
-- in one statement. A second caller blocks on that row until the first commits,
-- then reads the incremented value. There is no read-then-write window.

CREATE OR REPLACE FUNCTION public.inv_allocate_document_number(
  p_document_type text,
  p_fy_label      text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to allocate inventory document numbers.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.inv_number_sequence
     SET current_number = current_number + 1,
         updated_at     = now()
   WHERE document_type = p_document_type
     AND fy_label      = p_fy_label
     AND is_active
  RETURNING * INTO r;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No active number sequence for document type % in financial year %. Create one in inv_number_sequence first.',
      p_document_type, p_fy_label
      USING ERRCODE = 'no_data_found';
  END IF;

  -- e.g. RCP + / + 2627 + / + 0014  ->  RCP/2627/0014
  RETURN r.prefix || r.separator || r.fy_label || r.separator
       || lpad(r.current_number::text, r.padding, '0');
END $$;

COMMENT ON FUNCTION public.inv_allocate_document_number IS
  'Atomically allocates the next document number. Single UPDATE ... RETURNING, so it is safe under concurrency with no read-then-write gap.';


CREATE OR REPLACE FUNCTION public.inv_reset_sequence_counter(
  p_document_type text,
  p_fy_label      text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Admin only. This discards numbering history; it is a go-live action.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators may reset a document number sequence.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.inv_number_sequence
     SET current_number = 0,
         updated_at     = now()
   WHERE document_type = p_document_type
     AND fy_label      = p_fy_label;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No number sequence for document type % in financial year %.',
      p_document_type, p_fy_label
      USING ERRCODE = 'no_data_found';
  END IF;
END $$;

COMMENT ON FUNCTION public.inv_reset_sequence_counter IS
  'Go-live counter reset. Admin only. Sets current_number back to zero so the first real document is number 1.';


-- =====================================================================
-- 6. STOCK ENTRY RULE
-- =====================================================================
-- RULE: a physical unit may only come into existence through a document that
-- is entitled to create stock - a Goods Receipt, or an adjustment (a stock
-- count finding something that was never received). Nothing else may conjure
-- a unit.
--
-- NOTE: this makes origin_operation_id effectively mandatory at runtime even
-- though the column is nullable. Seeding opening stock therefore requires an
-- adjustment operation, which is the intended discipline - opening stock is an
-- adjustment against a virtual counterparty.

CREATE OR REPLACE FUNCTION public.inv_tg_stock_item_origin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_kind   public.inv_operation_kind;
  v_number text;
BEGIN
  IF NEW.origin_operation_id IS NULL THEN
    RAISE EXCEPTION
      'Stock item % (serial %) has no origin operation. A unit may only be created by a receipt or an adjustment - set origin_operation_id.',
      NEW.id, NEW.serial
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT ot.kind, o.number INTO v_kind, v_number
    FROM public.inv_operation o
    JOIN public.inv_operation_type ot ON ot.id = o.operation_type_id
   WHERE o.id = NEW.origin_operation_id;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION
      'Stock item % cites origin operation % which does not exist.',
      NEW.serial, NEW.origin_operation_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_kind NOT IN ('receipt'::public.inv_operation_kind,
                    'adjustment'::public.inv_operation_kind) THEN
    RAISE EXCEPTION
      'Stock item % cannot be created by operation % because its type is a % operation. Finished goods enter stock only via a receipt, or via an adjustment.',
      NEW.serial, v_number, v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.inv_stock_item'::regclass
                    AND tgname  = 'inv_stock_item_check_origin') THEN
    CREATE TRIGGER inv_stock_item_check_origin
      BEFORE INSERT ON public.inv_stock_item
      FOR EACH ROW EXECUTE FUNCTION public.inv_tg_stock_item_origin();
  END IF;
END $$;


-- =====================================================================
-- 7. THE CORE MOVEMENT FUNCTION
-- =====================================================================
-- RULE: there is exactly one sanctioned way to move a unit. It checks the unit
-- is where the caller believes it is, moves it, records the movement in the
-- ledger citing the document, and records the per-unit line - all in one
-- transaction. Nothing else may write inv_stock_item.location_id.
--
-- Guards, in order:
--   * caller has inventory write permission
--   * the unit exists and is locked FOR UPDATE for the rest of the transaction
--   * the unit is actually in the expected source location
--   * destination exists and is active
--   * the unit's product matches the move's product
--   * this unit has not already been processed on this move (double-scan)

CREATE OR REPLACE FUNCTION public.inv_transfer_stock_item(
  p_stock_item_id             uuid,
  p_move_id                   uuid,
  p_expected_from_location_id uuid,
  p_to_location_id            uuid,
  p_document_type             text,
  p_document_id               uuid,
  p_entry_type                text  DEFAULT 'transfer',
  p_detail                    jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item          public.inv_stock_item%ROWTYPE;
  v_move_product  uuid;
  v_dest_active   boolean;
  v_dest_exists   boolean;
  v_move_line_id  uuid;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to move inventory.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_expected_from_location_id IS NULL OR p_to_location_id IS NULL THEN
    RAISE EXCEPTION
      'Both the expected source location and the destination location are required. Moving a unit without asserting where it came from is how silent divergence starts.'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Lock the unit for the rest of the transaction.
  SELECT * INTO v_item
    FROM public.inv_stock_item
   WHERE id = p_stock_item_id
   FOR UPDATE;

  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Stock item % not found.', p_stock_item_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_item.location_id <> p_expected_from_location_id THEN
    RAISE EXCEPTION
      'Stock item % (serial %) is not where it was expected: it is in location %, but the caller expected %. Refusing to move it.',
      v_item.id, v_item.serial, v_item.location_id, p_expected_from_location_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT true, is_active INTO v_dest_exists, v_dest_active
    FROM public.inv_location WHERE id = p_to_location_id;

  IF v_dest_exists IS NULL THEN
    RAISE EXCEPTION 'Destination location % does not exist.', p_to_location_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT v_dest_active THEN
    RAISE EXCEPTION 'Destination location % is not active.', p_to_location_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT product_id INTO v_move_product FROM public.inv_move WHERE id = p_move_id;

  IF v_move_product IS NULL THEN
    RAISE EXCEPTION 'Move % not found.', p_move_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_move_product <> v_item.product_id THEN
    RAISE EXCEPTION
      'Stock item % is product %, but move % is for product %.',
      v_item.serial, v_item.product_id, p_move_id, v_move_product
      USING ERRCODE = 'check_violation';
  END IF;

  -- Double-processing guard. A UNIQUE constraint already backs this; catching
  -- it here turns a raw constraint violation into a sentence a user can act on.
  IF EXISTS (SELECT 1 FROM public.inv_move_line
              WHERE move_id = p_move_id AND stock_item_id = p_stock_item_id) THEN
    RAISE EXCEPTION
      'Stock item % (serial %) has already been processed on this document. Scanning the same unit twice does not move it twice.',
      v_item.id, v_item.serial
      USING ERRCODE = 'unique_violation';
  END IF;

  -- 1. move the unit
  UPDATE public.inv_stock_item
     SET location_id = p_to_location_id,
         updated_at  = now()
   WHERE id = p_stock_item_id;

  -- 2. record it in the append-only ledger, citing the document
  INSERT INTO public.inv_stock_tracking (
    stock_item_id, entry_type, from_location_id, to_location_id,
    document_type, document_id, user_id, detail
  ) VALUES (
    p_stock_item_id, p_entry_type, p_expected_from_location_id, p_to_location_id,
    p_document_type, p_document_id, auth.uid(),
    COALESCE(p_detail, '{}'::jsonb) || jsonb_build_object('serial', v_item.serial)
  );

  -- 3. record the per-unit line on the document
  INSERT INTO public.inv_move_line (
    move_id, stock_item_id, from_location_id, to_location_id, done_at
  ) VALUES (
    p_move_id, p_stock_item_id, p_expected_from_location_id, p_to_location_id, now()
  )
  RETURNING id INTO v_move_line_id;

  RETURN v_move_line_id;
END $$;

COMMENT ON FUNCTION public.inv_transfer_stock_item IS
  'The ONLY sanctioned way to move a unit. Validates position, moves it, writes the ledger row citing the document, and writes the move line - one transaction. Everything that moves stock calls this.';


-- =====================================================================
-- 8. ON-HAND
-- =====================================================================
-- RULE: on-hand is counted, never stored. There is no cached total to drift.
-- This is the structural replacement for products.stock_on_hand.
--
-- security_invoker = true (PG 15+) so the view honours the caller's RLS on
-- inv_stock_item rather than the view owner's.

CREATE OR REPLACE VIEW public.inv_on_hand
WITH (security_invoker = true) AS
SELECT
    si.product_id,
    si.location_id,
    si.status,
    count(*)                                                        AS qty,
    count(*) FILTER (WHERE si.reserved_for_customer_id IS NULL)     AS qty_unreserved,
    count(*) FILTER (WHERE si.reserved_for_customer_id IS NOT NULL) AS qty_reserved
  FROM public.inv_stock_item si
 GROUP BY si.product_id, si.location_id, si.status;

COMMENT ON VIEW public.inv_on_hand IS
  'On-hand by product, location and condition, counted live from inv_stock_item. Replaces products.stock_on_hand structurally - there is no stored total anywhere to go stale.';


-- Convenience: sellable quantity, i.e. condition ok and not earmarked.
-- p_location_id NULL means "anywhere".
CREATE OR REPLACE FUNCTION public.inv_available_qty(
  p_product_id  uuid,
  p_location_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT count(*)::integer
    FROM public.inv_stock_item si
   WHERE si.product_id = p_product_id
     AND si.status = 'ok'::public.inv_stock_status
     AND si.reserved_for_customer_id IS NULL
     AND (p_location_id IS NULL OR si.location_id = p_location_id);
$$;

COMMENT ON FUNCTION public.inv_available_qty IS
  'Sellable units: condition ok and not earmarked for a customer. Pass NULL location for the whole company.';


-- =====================================================================
-- GRANTS
-- =====================================================================
-- All three SECURITY DEFINER functions (inv_allocate_document_number,
-- inv_reset_sequence_counter, inv_transfer_stock_item) do their own permission
-- checks internally as their first act -- can_write_inventory() for the two
-- write paths, is_admin() for the counter reset -- so EXECUTE may be granted
-- broadly without widening who can actually change anything.

GRANT EXECUTE ON FUNCTION public.inv_allocate_document_number(text, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_reset_sequence_counter(text, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_transfer_stock_item(uuid, uuid, uuid, uuid, text, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_available_qty(uuid, uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_operation_state_allowed(public.inv_operation_state, public.inv_operation_state) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_move_state_allowed(public.inv_move_state, public.inv_move_state)                TO authenticated;
GRANT SELECT  ON public.inv_on_hand TO authenticated;


-- =====================================================================
-- NOT IN THIS STEP
-- =====================================================================
-- * Creating a stock item on receipt, and the receipt/delivery/transfer
--   workflows themselves - they are callers of inv_transfer_stock_item.
-- * Maintaining inv_purchase_order_line.received_qty and the
--   partially_received / received order states.
-- * Deriving inv_operation.state from its moves (currently set by the caller,
--   with transitions policed here).
-- * Any frontend.

COMMIT;
