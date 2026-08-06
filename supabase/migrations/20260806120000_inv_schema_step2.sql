-- =====================================================================
-- INVENTORY RESET - STEP 2: new schema layer (ADDITIVE ONLY)
-- =====================================================================
--
-- Creates the `inv_`-prefixed foundation for the rebuilt inventory module.
-- It runs ALONGSIDE the existing 47 inventory tables, which keep working as
-- the fallback until cutover.
--
-- THIS MIGRATION DOES NOT:
--   * drop, alter or rename ANY existing table, column, RPC or policy
--   * touch `products` (read-only anchor; `stock_on_hand` is left alone)
--   * touch CRM. `customers` is referenced by ONE nullable FK with
--     ON DELETE SET NULL, so CRM may delete a customer freely and nothing
--     here blocks it. No writes to `customers`, no FK pointing at anything new.
--   * create any function or RPC - Step 3 owns the ledger and state machines
--   * reuse the four legacy function names: inv_approve_adjustment,
--     inv_validate_stock_move, inv_save_stock_move, inv_delete_stock_move
--
-- FK direction rule: new -> new freely; new -> shared read-only anchors
-- (products, customers, vendors, auth.users) only. No FK from any existing
-- inventory table into these, so either module can be removed independently.
--
-- Preserved pre-reset state: docs/inventory-preserved/ (tag pre-inventory-reset).
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1. ENUM TYPES
-- =====================================================================
-- Guarded so the migration is re-runnable. CREATE TYPE has no IF NOT EXISTS;
-- these DO blocks are inline anonymous code, not stored functions.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'inv_stock_status') THEN
    CREATE TYPE public.inv_stock_status AS ENUM
      ('ok', 'attention', 'damaged', 'destroyed', 'rejected', 'lost', 'quarantined');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'inv_location_type') THEN
    CREATE TYPE public.inv_location_type AS ENUM
      ('supplier', 'view', 'internal', 'customer', 'inventory_loss', 'production', 'transit', 'scrap');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'inv_operation_state') THEN
    CREATE TYPE public.inv_operation_state AS ENUM
      ('draft', 'waiting', 'ready', 'done', 'cancelled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'inv_move_state') THEN
    CREATE TYPE public.inv_move_state AS ENUM
      ('draft', 'confirmed', 'assigned', 'done', 'cancelled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'inv_operation_kind') THEN
    CREATE TYPE public.inv_operation_kind AS ENUM
      ('receipt', 'internal', 'outgoing', 'adjustment');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'inv_order_state') THEN
    CREATE TYPE public.inv_order_state AS ENUM
      ('draft', 'sent', 'confirmed', 'partially_received', 'received', 'cancelled');
  END IF;
END $$;


-- =====================================================================
-- 2. NUMBERING - one owner for every document number
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.inv_number_sequence (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_type   text        NOT NULL,
    prefix          text        NOT NULL,
    fy_label        text        NOT NULL,
    current_number  integer     NOT NULL DEFAULT 0,
    padding         integer     NOT NULL DEFAULT 4,
    separator       text        NOT NULL DEFAULT '/',
    is_active       boolean     NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT inv_number_sequence_unique_doc_fy UNIQUE (document_type, fy_label),
    CONSTRAINT inv_number_sequence_current_number_nonneg CHECK (current_number >= 0),
    CONSTRAINT inv_number_sequence_padding_range        CHECK (padding BETWEEN 1 AND 12)
);

COMMENT ON TABLE public.inv_number_sequence IS
  'Single owner of document numbering. Replaces the split between numbering_sequences and operation_types.sequence_current_number. Go-live reset = UPDATE current_number = 0 for the relevant fy_label.';


-- =====================================================================
-- 3. CORE - warehouses and the location tree
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.inv_warehouse (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text        NOT NULL,
    name        text        NOT NULL,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT inv_warehouse_code_not_blank CHECK (length(trim(code)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS inv_warehouse_code_key
    ON public.inv_warehouse (upper(code));

COMMENT ON TABLE public.inv_warehouse IS 'Physical site. GLF: store vs factory are separate warehouses.';


CREATE TABLE IF NOT EXISTS public.inv_location (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id  uuid NOT NULL
                    REFERENCES public.inv_warehouse (id) ON DELETE RESTRICT,
    parent_id     uuid
                    REFERENCES public.inv_location (id) ON DELETE RESTRICT,
    code          text                     NOT NULL,
    name          text                     NOT NULL,
    type          public.inv_location_type NOT NULL,
    is_active     boolean                  NOT NULL DEFAULT true,
    barcode       text,
    notes         text,
    created_at    timestamptz              NOT NULL DEFAULT now(),
    updated_at    timestamptz              NOT NULL DEFAULT now(),

    CONSTRAINT inv_location_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE UNIQUE INDEX IF NOT EXISTS inv_location_code_key
    ON public.inv_location (upper(code));
CREATE INDEX IF NOT EXISTS inv_location_warehouse_idx ON public.inv_location (warehouse_id);
CREATE INDEX IF NOT EXISTS inv_location_parent_idx    ON public.inv_location (parent_id);
CREATE INDEX IF NOT EXISTS inv_location_type_idx      ON public.inv_location (type) WHERE is_active;

COMMENT ON TABLE public.inv_location IS
  'Location tree with typed behaviour. `type` is a real enum, unlike warehouse_locations.type which was free text. supplier/customer are the counterparty sides of receipts and deliveries; inventory_loss/scrap/production are the virtual counterparties an adjustment must cite.';


-- =====================================================================
-- 4. OPERATION TYPE - document behaviour config
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.inv_operation_type (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                        text                      NOT NULL,
    kind                        public.inv_operation_kind NOT NULL,
    sequence_id                 uuid
                                  REFERENCES public.inv_number_sequence (id) ON DELETE RESTRICT,
    default_source_location_id  uuid
                                  REFERENCES public.inv_location (id) ON DELETE RESTRICT,
    default_dest_location_id    uuid
                                  REFERENCES public.inv_location (id) ON DELETE RESTRICT,

    -- GLF rule: GR destination is locked, not staff-editable.
    locks_destination           boolean NOT NULL DEFAULT false,
    locks_source                boolean NOT NULL DEFAULT false,

    -- scan flags
    mandatory_scan_product      boolean NOT NULL DEFAULT true,
    mandatory_scan_serial       boolean NOT NULL DEFAULT true,
    mandatory_scan_dest_location boolean NOT NULL DEFAULT false,
    allow_extra_products        boolean NOT NULL DEFAULT false,
    print_labels                boolean NOT NULL DEFAULT false,

    is_active                   boolean     NOT NULL DEFAULT true,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inv_operation_type_name_key
    ON public.inv_operation_type (upper(name));
CREATE INDEX IF NOT EXISTS inv_operation_type_kind_idx
    ON public.inv_operation_type (kind) WHERE is_active;

COMMENT ON COLUMN public.inv_operation_type.locks_destination IS
  'When true the document copies default_dest_location_id and the UI must not offer the field. This is where the GR "destination locked, not staff-editable" rule lives.';


-- =====================================================================
-- 5. PROCUREMENT - purchase orders (commitment only, moves NO stock)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.inv_purchase_order (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number      text                   NOT NULL,
    vendor_id   uuid
                  REFERENCES public.vendors (id) ON DELETE RESTRICT,
    state       public.inv_order_state NOT NULL DEFAULT 'draft',
    ordered_at  timestamptz,
    expected_at timestamptz,
    created_by  uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inv_purchase_order_number_key
    ON public.inv_purchase_order (number);
CREATE INDEX IF NOT EXISTS inv_purchase_order_vendor_idx ON public.inv_purchase_order (vendor_id);
CREATE INDEX IF NOT EXISTS inv_purchase_order_state_idx  ON public.inv_purchase_order (state);

COMMENT ON TABLE public.inv_purchase_order IS
  'A commitment to buy. Moves NO stock and creates NO stock items - only a Goods Receipt does that. One order may be fulfilled by several receipts (partial receipts).';


CREATE TABLE IF NOT EXISTS public.inv_purchase_order_line (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      uuid NOT NULL
                    REFERENCES public.inv_purchase_order (id) ON DELETE CASCADE,
    product_id    uuid NOT NULL
                    REFERENCES public.products (id) ON DELETE RESTRICT,
    ordered_qty   integer     NOT NULL,
    received_qty  integer     NOT NULL DEFAULT 0,
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT inv_po_line_ordered_qty_positive CHECK (ordered_qty > 0),
    CONSTRAINT inv_po_line_received_qty_nonneg  CHECK (received_qty >= 0)
);

CREATE INDEX IF NOT EXISTS inv_purchase_order_line_order_idx
    ON public.inv_purchase_order_line (order_id);
CREATE INDEX IF NOT EXISTS inv_purchase_order_line_product_idx
    ON public.inv_purchase_order_line (product_id);

COMMENT ON COLUMN public.inv_purchase_order_line.received_qty IS
  'Maintained by the receipt flow in Step 3 (derived from inv_move_line). Deliberately NOT capped at ordered_qty here - over-receipt is a real event that the discrepancy flow must be able to record.';


-- =====================================================================
-- 6. OPERATIONS SPINE - operation / move / move line
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.inv_operation (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number                    text NOT NULL,
    operation_type_id         uuid NOT NULL
                                REFERENCES public.inv_operation_type (id) ON DELETE RESTRICT,
    state                     public.inv_operation_state NOT NULL DEFAULT 'draft',

    source_location_id        uuid REFERENCES public.inv_location (id) ON DELETE RESTRICT,
    dest_location_id          uuid REFERENCES public.inv_location (id) ON DELETE RESTRICT,

    -- Counterparty. Two typed columns rather than one polymorphic uuid, so both
    -- stay real foreign keys. At most one may be set.
    partner_vendor_id         uuid REFERENCES public.vendors  (id) ON DELETE SET NULL,
    partner_customer_id       uuid REFERENCES public.customers(id) ON DELETE SET NULL,

    source_purchase_order_id  uuid REFERENCES public.inv_purchase_order (id) ON DELETE SET NULL,
    source_document           text,

    scheduled_at              timestamptz,
    done_at                   timestamptz,
    created_by                uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    notes                     text,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT inv_operation_single_partner CHECK (
        partner_vendor_id IS NULL OR partner_customer_id IS NULL),
    CONSTRAINT inv_operation_done_has_timestamp CHECK (
        state <> 'done' OR done_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS inv_operation_number_key ON public.inv_operation (number);
CREATE INDEX IF NOT EXISTS inv_operation_type_idx   ON public.inv_operation (operation_type_id);
CREATE INDEX IF NOT EXISTS inv_operation_state_idx  ON public.inv_operation (state);
CREATE INDEX IF NOT EXISTS inv_operation_po_idx     ON public.inv_operation (source_purchase_order_id)
    WHERE source_purchase_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inv_operation_dest_idx   ON public.inv_operation (dest_location_id);
CREATE INDEX IF NOT EXISTS inv_operation_source_idx ON public.inv_operation (source_location_id);

COMMENT ON TABLE public.inv_operation IS
  'One document header for every stock document: receipt, internal transfer, outgoing, adjustment. Replaces the parallel goods_receipts / internal_transfer_orders / internal_movements / transfers stacks.';

COMMENT ON CONSTRAINT inv_operation_single_partner ON public.inv_operation IS
  'A document has at most one counterparty. Vendor for receipts, customer for outgoing, neither for internal and adjustment.';


CREATE TABLE IF NOT EXISTS public.inv_move (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id  uuid NOT NULL
                    REFERENCES public.inv_operation (id) ON DELETE CASCADE,
    product_id    uuid NOT NULL
                    REFERENCES public.products (id) ON DELETE RESTRICT,
    demand_qty    integer              NOT NULL DEFAULT 0,
    state         public.inv_move_state NOT NULL DEFAULT 'draft',
    notes         text,
    created_at    timestamptz          NOT NULL DEFAULT now(),
    updated_at    timestamptz          NOT NULL DEFAULT now(),

    CONSTRAINT inv_move_demand_qty_nonneg CHECK (demand_qty >= 0)
);

CREATE INDEX IF NOT EXISTS inv_move_operation_idx ON public.inv_move (operation_id);
CREATE INDEX IF NOT EXISTS inv_move_product_idx   ON public.inv_move (product_id);
CREATE INDEX IF NOT EXISTS inv_move_state_idx     ON public.inv_move (state);

COMMENT ON TABLE public.inv_move IS
  'Product-level demand on a document ("10 of SKU X"). The per-unit reality lives in inv_move_line.';


-- inv_stock_item is created below but referenced here, so inv_move_line comes
-- after it. See section 7.


-- =====================================================================
-- 7. inv_stock_item - THE single source of truth per physical unit
-- =====================================================================
-- Always quantity 1. There is deliberately NO quantity column and no
-- stock_on_hand anywhere: on-hand is COUNT(*) over this table. That is what
-- structurally removes the stale-column bug class.

CREATE TABLE IF NOT EXISTS public.inv_stock_item (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id              uuid NOT NULL
                              REFERENCES public.products (id) ON DELETE RESTRICT,
    serial                  text NOT NULL,
    location_id             uuid NOT NULL
                              REFERENCES public.inv_location (id) ON DELETE RESTRICT,
    status                  public.inv_stock_status NOT NULL DEFAULT 'ok',

    -- Provenance: the receipt that brought this unit into existence. RESTRICT,
    -- not SET NULL - losing provenance silently is exactly the failure mode
    -- this rebuild exists to remove.
    origin_operation_id     uuid REFERENCES public.inv_operation (id) ON DELETE RESTRICT,

    batch_code              text,          -- reserved; GLF does not batch-track today
    cost                    numeric(14,2) NOT NULL DEFAULT 0,
    received_at             timestamptz,

    -- Optional earmarking for a customer. ON DELETE SET NULL so CRM can delete
    -- a customer without this module ever blocking it.
    reserved_for_customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL,
    reserved_at             timestamptz,

    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT inv_stock_item_serial_not_blank CHECK (length(trim(serial)) > 0),
    CONSTRAINT inv_stock_item_cost_nonneg      CHECK (cost >= 0),
    CONSTRAINT inv_stock_item_reserved_pair    CHECK (
        (reserved_for_customer_id IS NULL AND reserved_at IS NULL)
     OR (reserved_for_customer_id IS NOT NULL AND reserved_at IS NOT NULL))
);

-- Serial lookup (also enforces global uniqueness).
CREATE UNIQUE INDEX IF NOT EXISTS inv_stock_item_serial_key
    ON public.inv_stock_item (serial);

-- On-hand counts by location + status. Composite ordering matches the query
-- shape "how many OK units are in location X".
CREATE INDEX IF NOT EXISTS inv_stock_item_location_status_idx
    ON public.inv_stock_item (location_id, status);

-- Narrower partial index for the overwhelmingly common "sellable stock" query.
CREATE INDEX IF NOT EXISTS inv_stock_item_available_idx
    ON public.inv_stock_item (location_id, product_id)
    WHERE status = 'ok' AND reserved_for_customer_id IS NULL;

CREATE INDEX IF NOT EXISTS inv_stock_item_product_idx  ON public.inv_stock_item (product_id);
CREATE INDEX IF NOT EXISTS inv_stock_item_origin_idx   ON public.inv_stock_item (origin_operation_id);
CREATE INDEX IF NOT EXISTS inv_stock_item_reserved_idx ON public.inv_stock_item (reserved_for_customer_id)
    WHERE reserved_for_customer_id IS NOT NULL;

COMMENT ON TABLE public.inv_stock_item IS
  'One row per physical unit. Always quantity 1 - GLF serial-tracks everything, so there is no quantity branch. On-hand is derived by COUNT over this table; no cached total exists anywhere.';

COMMENT ON COLUMN public.inv_stock_item.status IS
  'Condition only (InvenTree StockStatus). Lifecycle facts such as reserved or sold are NOT statuses - reservation is reserved_for_customer_id, and location tells you where the unit is.';


-- inv_move_line - per-unit actual, now that inv_stock_item exists
CREATE TABLE IF NOT EXISTS public.inv_move_line (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    move_id           uuid NOT NULL
                        REFERENCES public.inv_move (id) ON DELETE CASCADE,
    stock_item_id     uuid NOT NULL
                        REFERENCES public.inv_stock_item (id) ON DELETE RESTRICT,
    from_location_id  uuid REFERENCES public.inv_location (id) ON DELETE RESTRICT,
    to_location_id    uuid REFERENCES public.inv_location (id) ON DELETE RESTRICT,
    done_at           timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),

    -- One unit may appear only once per move.
    CONSTRAINT inv_move_line_unique_item_per_move UNIQUE (move_id, stock_item_id)
);

CREATE INDEX IF NOT EXISTS inv_move_line_move_idx       ON public.inv_move_line (move_id);
CREATE INDEX IF NOT EXISTS inv_move_line_stock_item_idx ON public.inv_move_line (stock_item_id);

COMMENT ON TABLE public.inv_move_line IS
  'Per-unit actual movement. Replaces stock_move_lines.serial_numbers text[] - one row per serial, so "where has this unit been" is an index lookup instead of an array scan.';


-- =====================================================================
-- 8. inv_stock_tracking - append-only per-unit ledger
-- =====================================================================
-- Append-only by design:
--   * no updated_at column, nothing to amend
--   * RLS below grants SELECT and INSERT only; there is deliberately no
--     UPDATE and no DELETE policy, so RLS itself blocks mutation for every
--     non-superuser role
--   * Step 3 adds a BEFORE UPDATE OR DELETE trigger for defence in depth
--     (the existing module uses exactly this pattern via
--     prevent_stock_move_mutation / prevent_stock_move_line_mutation)

CREATE TABLE IF NOT EXISTS public.inv_stock_tracking (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_item_id     uuid NOT NULL
                        REFERENCES public.inv_stock_item (id) ON DELETE RESTRICT,
    entry_type        text NOT NULL,
    from_location_id  uuid REFERENCES public.inv_location (id) ON DELETE RESTRICT,
    to_location_id    uuid REFERENCES public.inv_location (id) ON DELETE RESTRICT,

    -- Every row names the document that caused it. document_type is text
    -- because a tracking row may cite a document outside this module
    -- (e.g. a sales order); document_id stays a real uuid.
    document_type     text,
    document_id       uuid,

    user_id           uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    detail            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT inv_stock_tracking_entry_type_not_blank CHECK (length(trim(entry_type)) > 0),
    CONSTRAINT inv_stock_tracking_document_pair CHECK (
        (document_type IS NULL AND document_id IS NULL)
     OR (document_type IS NOT NULL AND document_id IS NOT NULL))
);

-- Per-unit history lookup, newest first.
CREATE INDEX IF NOT EXISTS inv_stock_tracking_item_time_idx
    ON public.inv_stock_tracking (stock_item_id, created_at DESC);

-- Document -> its tracking rows.
CREATE INDEX IF NOT EXISTS inv_stock_tracking_document_idx
    ON public.inv_stock_tracking (document_type, document_id)
    WHERE document_type IS NOT NULL;

COMMENT ON TABLE public.inv_stock_tracking IS
  'Append-only per-unit ledger (InvenTree StockItemTracking). Every row references its source document. Never updated, never deleted - RLS grants INSERT and SELECT only, and Step 3 adds a mutation-blocking trigger.';


-- =====================================================================
-- 9. QC - per-product checklist, per-unit results
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.inv_test_template (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL product_id = a test that applies to every product.
    product_id            uuid REFERENCES public.products (id) ON DELETE CASCADE,
    name                  text        NOT NULL,
    description           text,
    requires_value        boolean     NOT NULL DEFAULT false,
    requires_attachment   boolean     NOT NULL DEFAULT false,
    sort_order            integer     NOT NULL DEFAULT 0,
    is_active             boolean     NOT NULL DEFAULT true,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT inv_test_template_name_not_blank CHECK (length(trim(name)) > 0)
);

-- A product may not define the same test twice. Two partial unique indexes
-- because NULL product_id (the global tests) needs its own uniqueness rule.
CREATE UNIQUE INDEX IF NOT EXISTS inv_test_template_product_name_key
    ON public.inv_test_template (product_id, upper(name))
    WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inv_test_template_global_name_key
    ON public.inv_test_template (upper(name))
    WHERE product_id IS NULL;

CREATE INDEX IF NOT EXISTS inv_test_template_product_idx
    ON public.inv_test_template (product_id, sort_order) WHERE is_active;

COMMENT ON TABLE public.inv_test_template IS
  'Per-product QC checklist (InvenTree PartTestTemplate). This half has no equivalent in the old module, where QC was a single boolean plus free text.';


CREATE TABLE IF NOT EXISTS public.inv_test_result (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_item_id  uuid NOT NULL
                     REFERENCES public.inv_stock_item (id) ON DELETE CASCADE,
    template_id    uuid NOT NULL
                     REFERENCES public.inv_test_template (id) ON DELETE RESTRICT,
    result         boolean     NOT NULL,
    value          text,
    notes          text,
    attachments    jsonb       NOT NULL DEFAULT '[]'::jsonb,
    tested_by      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    tested_at      timestamptz NOT NULL DEFAULT now(),
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inv_test_result_stock_item_idx
    ON public.inv_test_result (stock_item_id, tested_at DESC);
CREATE INDEX IF NOT EXISTS inv_test_result_template_idx
    ON public.inv_test_result (template_id);
CREATE INDEX IF NOT EXISTS inv_test_result_failed_idx
    ON public.inv_test_result (stock_item_id) WHERE result = false;

COMMENT ON TABLE public.inv_test_result IS
  'One row per unit per test. Retesting appends another row rather than overwriting, so QC history survives - ordered by tested_at, the newest row is current.';


-- =====================================================================
-- 10. ROW LEVEL SECURITY
-- =====================================================================
-- Mirrors the existing module exactly: read for any authenticated user,
-- write gated by can_write_inventory(), delete gated by is_admin().
-- Both helpers already exist and are unchanged by this migration.

ALTER TABLE public.inv_number_sequence      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_warehouse            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_location             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_operation_type       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_purchase_order       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_purchase_order_line  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_operation            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_move                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_stock_item           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_move_line            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_stock_tracking       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_test_template        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_test_result          ENABLE ROW LEVEL SECURITY;

-- Standard four-policy set. Applied to every table EXCEPT inv_stock_tracking,
-- which gets select+insert only.
-- CREATE POLICY has no IF NOT EXISTS, so each is guarded against pg_policy to
-- keep the whole migration re-runnable.
DO $$
DECLARE
  tbl  text;
  spec record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'inv_number_sequence','inv_warehouse','inv_location','inv_operation_type',
    'inv_purchase_order','inv_purchase_order_line','inv_operation','inv_move',
    'inv_stock_item','inv_move_line','inv_test_template','inv_test_result'
  ] LOOP
    FOR spec IN
      SELECT * FROM (VALUES
        ('_select_auth',  'FOR SELECT TO authenticated USING (true)'),
        ('_insert_inv',   'FOR INSERT TO authenticated WITH CHECK (public.can_write_inventory())'),
        ('_update_inv',   'FOR UPDATE TO authenticated USING (public.can_write_inventory()) WITH CHECK (public.can_write_inventory())'),
        ('_delete_admin', 'FOR DELETE TO authenticated USING (public.is_admin())')
      ) AS v(suffix, body)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policy p
        WHERE p.polrelid = format('public.%I', tbl)::regclass
          AND p.polname  = tbl || spec.suffix
      ) THEN
        EXECUTE format('CREATE POLICY %I ON public.%I %s',
                       tbl || spec.suffix, tbl, spec.body);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Append-only ledger: SELECT and INSERT only. The absence of UPDATE and DELETE
-- policies is the enforcement, not an oversight.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.inv_stock_tracking'::regclass
                    AND polname  = 'inv_stock_tracking_select_auth') THEN
    CREATE POLICY inv_stock_tracking_select_auth ON public.inv_stock_tracking
        FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.inv_stock_tracking'::regclass
                    AND polname  = 'inv_stock_tracking_insert_inv') THEN
    CREATE POLICY inv_stock_tracking_insert_inv ON public.inv_stock_tracking
        FOR INSERT TO authenticated WITH CHECK (public.can_write_inventory());
  END IF;
END $$;


-- =====================================================================
-- 11. DEFERRED TO STEP 3 - recorded here so the intent is not lost
-- =====================================================================
--
-- (a) ADJUSTMENT COUNTERPARTY RULE
--     "An adjustment operation must have a source or dest location of type
--      inventory_loss, scrap or production."
--     Not expressible as a CHECK: the rule spans three tables - the kind lives
--     on inv_operation_type, the types live on inv_location, and the row being
--     checked is inv_operation. A CHECK constraint may not query other tables.
--     Step 3 implements it as a DEFERRABLE CONSTRAINT TRIGGER on inv_operation
--     (AFTER INSERT OR UPDATE) that joins operation_type and both locations and
--     raises when kind = 'adjustment' and neither side is virtual. Deferrable so
--     a document can be built in any column order within one transaction.
--     The indexes it needs (inv_operation_source_idx, inv_operation_dest_idx,
--     inv_location_type_idx) are already created above.
--
-- (b) APPEND-ONLY TRIGGER on inv_stock_tracking
--     BEFORE UPDATE OR DELETE ... RAISE EXCEPTION. RLS already blocks both for
--     authenticated users; the trigger closes the service-role path too.
--
-- (c) updated_at MAINTENANCE
--     Every table above carries updated_at but NO trigger, because this step
--     creates no functions. Step 3 attaches the EXISTING
--     public.update_updated_at_column() to each. Until then updated_at only
--     changes when a writer sets it explicitly.
--
-- (d) STATE MACHINES
--     The enums constrain vocabulary; they do not constrain transitions.
--     Step 3 adds the transition guards for inv_operation_state and
--     inv_move_state.
--
-- (e) NUMBER ALLOCATION
--     Step 3 adds the allocator that bumps inv_number_sequence.current_number
--     atomically. Must NOT be named inv_approve_adjustment,
--     inv_validate_stock_move, inv_save_stock_move or inv_delete_stock_move -
--     all four already exist in the legacy module.

COMMIT;
