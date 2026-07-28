-- Operation Types, steps 1-2 of docs/OPERATION_TYPES_DESIGN.md:
-- document-side source/destination location columns.
--
-- WHY: `operation_types` already carries `default_source_location_id` and
-- `default_dest_location_id` (verified live; 4 of 8 slots populated), but the
-- document tables have nowhere to store a *resolved* source/destination. That
-- makes a per-document override unrepresentable, not merely unimplemented.
-- These columns are that storage. They are written by nothing yet.
--
-- SCOPE: additive columns + FKs only. NO trigger, NO RPC change, NO backfill,
-- NO behaviour change. Every new column is nullable with no default, so all
-- existing rows (10 goods_receipts, 0 delivery_notes, 4 internal_transfer_orders
-- as of 2026-07-29) get NULL and remain fully valid. Nothing in the frontend or
-- in any RPC reads these columns, so applying this file cannot change what the
-- application does. The COALESCE-based readers land in steps 4-6.
--
-- `internal_transfer_orders` deliberately does NOT get a `warehouse_id`: the
-- warehouse is DERIVED via warehouse_locations.warehouse_id from the ITO's
-- source location, so there is exactly one source of truth and no drift.
--
-- ON DELETE SET NULL on every new FK, matching the behaviour of the existing
-- goods_receipts_operation_type_id_fkey / delivery_notes_operation_type_id_fkey.
-- Note this differs from operation_types' own default-location FKs, which have
-- no ON DELETE action — that is intentional: a location must not be deletable
-- while it is configured as a default, but a *historical document* should not
-- block deletion of a location it once referenced.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, and DROP CONSTRAINT IF EXISTS before
-- each ADD CONSTRAINT. Safe to re-apply to the live database.
--
-- ---------------------------------------------------------------------------
-- REVERSE / ROLLBACK — run this to undo this migration in full.
-- Dropping the columns drops their FK constraints with them. This is lossless
-- today because nothing writes these columns; once steps 9-11 ship and real
-- overrides exist, this rollback would discard them.
--
--   ALTER TABLE public.goods_receipts
--     DROP COLUMN IF EXISTS source_location_id,
--     DROP COLUMN IF EXISTS dest_location_id;
--
--   ALTER TABLE public.delivery_notes
--     DROP COLUMN IF EXISTS source_location_id,
--     DROP COLUMN IF EXISTS dest_location_id;
--
--   ALTER TABLE public.internal_transfer_orders
--     DROP COLUMN IF EXISTS operation_type_id,
--     DROP COLUMN IF EXISTS source_location_id,
--     DROP COLUMN IF EXISTS dest_location_id;
--
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. goods_receipts — operation_type_id already exists (col 20).
-- ---------------------------------------------------------------------------
ALTER TABLE public.goods_receipts
  ADD COLUMN IF NOT EXISTS source_location_id uuid,
  ADD COLUMN IF NOT EXISTS dest_location_id   uuid;

ALTER TABLE public.goods_receipts
  DROP CONSTRAINT IF EXISTS goods_receipts_source_location_id_fkey;
ALTER TABLE public.goods_receipts
  ADD  CONSTRAINT goods_receipts_source_location_id_fkey
       FOREIGN KEY (source_location_id)
       REFERENCES public.warehouse_locations(id) ON DELETE SET NULL;

ALTER TABLE public.goods_receipts
  DROP CONSTRAINT IF EXISTS goods_receipts_dest_location_id_fkey;
ALTER TABLE public.goods_receipts
  ADD  CONSTRAINT goods_receipts_dest_location_id_fkey
       FOREIGN KEY (dest_location_id)
       REFERENCES public.warehouse_locations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.goods_receipts.source_location_id IS
  'Resolved source location for this receipt. Seeded from operation_types.default_source_location_id at insert; an explicitly supplied value is the per-document override. NULL => completion RPCs fall back to existing logic (VDR106 lookup).';
COMMENT ON COLUMN public.goods_receipts.dest_location_id IS
  'Resolved destination location for this receipt. Seeded from operation_types.default_dest_location_id at insert; an explicitly supplied value is the per-document override. NULL => completion RPCs fall back to existing logic (warehouses.default_receipt_location_id, then first active internal location).';

-- ---------------------------------------------------------------------------
-- 2. delivery_notes — operation_type_id already exists (col 26).
-- ---------------------------------------------------------------------------
ALTER TABLE public.delivery_notes
  ADD COLUMN IF NOT EXISTS source_location_id uuid,
  ADD COLUMN IF NOT EXISTS dest_location_id   uuid;

ALTER TABLE public.delivery_notes
  DROP CONSTRAINT IF EXISTS delivery_notes_source_location_id_fkey;
ALTER TABLE public.delivery_notes
  ADD  CONSTRAINT delivery_notes_source_location_id_fkey
       FOREIGN KEY (source_location_id)
       REFERENCES public.warehouse_locations(id) ON DELETE SET NULL;

ALTER TABLE public.delivery_notes
  DROP CONSTRAINT IF EXISTS delivery_notes_dest_location_id_fkey;
ALTER TABLE public.delivery_notes
  ADD  CONSTRAINT delivery_notes_dest_location_id_fkey
       FOREIGN KEY (dest_location_id)
       REFERENCES public.warehouse_locations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.delivery_notes.source_location_id IS
  'Resolved source location for this delivery. Seeded from operation_types.default_source_location_id at insert; explicit value = per-document override. NULL => stock moves keep taking their source per-serial from goods_receipt_serials.current_location.';
COMMENT ON COLUMN public.delivery_notes.dest_location_id IS
  'Resolved destination location for this delivery. Seeded from operation_types.default_dest_location_id at insert; explicit value = per-document override. NULL => completion RPC falls back to the CTMR107 / type=customer lookup.';

-- ---------------------------------------------------------------------------
-- 3. internal_transfer_orders — has none of the three columns today.
--    No warehouse_id: derived from warehouse_locations.warehouse_id of the
--    source location.
-- ---------------------------------------------------------------------------
ALTER TABLE public.internal_transfer_orders
  ADD COLUMN IF NOT EXISTS operation_type_id  uuid,
  ADD COLUMN IF NOT EXISTS source_location_id uuid,
  ADD COLUMN IF NOT EXISTS dest_location_id   uuid;

ALTER TABLE public.internal_transfer_orders
  DROP CONSTRAINT IF EXISTS internal_transfer_orders_operation_type_id_fkey;
ALTER TABLE public.internal_transfer_orders
  ADD  CONSTRAINT internal_transfer_orders_operation_type_id_fkey
       FOREIGN KEY (operation_type_id)
       REFERENCES public.operation_types(id) ON DELETE SET NULL;

ALTER TABLE public.internal_transfer_orders
  DROP CONSTRAINT IF EXISTS internal_transfer_orders_source_location_id_fkey;
ALTER TABLE public.internal_transfer_orders
  ADD  CONSTRAINT internal_transfer_orders_source_location_id_fkey
       FOREIGN KEY (source_location_id)
       REFERENCES public.warehouse_locations(id) ON DELETE SET NULL;

ALTER TABLE public.internal_transfer_orders
  DROP CONSTRAINT IF EXISTS internal_transfer_orders_dest_location_id_fkey;
ALTER TABLE public.internal_transfer_orders
  ADD  CONSTRAINT internal_transfer_orders_dest_location_id_fkey
       FOREIGN KEY (dest_location_id)
       REFERENCES public.warehouse_locations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.internal_transfer_orders.operation_type_id IS
  'Which operation type this transfer is. Brings ITO in line with goods_receipts and delivery_notes, which already have this FK. NULL on all pre-existing rows; create_ito_from_so does not set it yet (step 8).';
COMMENT ON COLUMN public.internal_transfer_orders.source_location_id IS
  'Resolved source location for this transfer. Seeded from operation_types.default_source_location_id at insert; explicit value = per-document override. Also the single source of truth for this ITO''s warehouse — derive via warehouse_locations.warehouse_id rather than storing it. Later location-scoped serial reservation in create_ito_from_so reads this column.';
COMMENT ON COLUMN public.internal_transfer_orders.dest_location_id IS
  'Resolved destination location for this transfer. Seeded from operation_types.default_dest_location_id at insert; explicit value = per-document override. NULL => complete_ito_with_qc falls back to the serial-derived transit-location lookup.';

COMMIT;

-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFICATION (read-only, run separately)
--
--   -- 7 columns present, all nullable, no defaults
--   SELECT table_name, column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND (table_name, column_name) IN (
--            ('goods_receipts','source_location_id'),
--            ('goods_receipts','dest_location_id'),
--            ('delivery_notes','source_location_id'),
--            ('delivery_notes','dest_location_id'),
--            ('internal_transfer_orders','operation_type_id'),
--            ('internal_transfer_orders','source_location_id'),
--            ('internal_transfer_orders','dest_location_id'))
--    ORDER BY table_name, column_name;
--
--   -- 7 FKs, every one ON DELETE SET NULL
--   SELECT rel.relname, con.conname, pg_get_constraintdef(con.oid)
--     FROM pg_constraint con
--     JOIN pg_class rel ON rel.oid = con.conrelid
--    WHERE con.conname IN (
--            'goods_receipts_source_location_id_fkey',
--            'goods_receipts_dest_location_id_fkey',
--            'delivery_notes_source_location_id_fkey',
--            'delivery_notes_dest_location_id_fkey',
--            'internal_transfer_orders_operation_type_id_fkey',
--            'internal_transfer_orders_source_location_id_fkey',
--            'internal_transfer_orders_dest_location_id_fkey')
--    ORDER BY rel.relname, con.conname;
--
--   -- all existing rows NULL, counts unchanged (10 / 0 / 4)
--   SELECT 'goods_receipts' t, count(*) rows,
--          count(source_location_id) src, count(dest_location_id) dst
--     FROM public.goods_receipts
--   UNION ALL SELECT 'delivery_notes', count(*),
--          count(source_location_id), count(dest_location_id)
--     FROM public.delivery_notes
--   UNION ALL SELECT 'internal_transfer_orders', count(*),
--          count(source_location_id), count(dest_location_id)
--     FROM public.internal_transfer_orders;
--
--   -- 16 serials untouched
--   SELECT stock_status, qc_status, current_location, count(*)
--     FROM public.goods_receipt_serials GROUP BY 1,2,3 ORDER BY 4 DESC;
-- ---------------------------------------------------------------------------
