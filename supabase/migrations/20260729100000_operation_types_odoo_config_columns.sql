-- operation_types: the six columns the Odoo-style config page needs.
--
-- WHY: mapping the Odoo Operation Type form (General / Hardware / Barcode App)
-- against the live table showed 16 of 22 fields already have columns and 6 do
-- not. Those 6 are added here so the config page can be built in full rather
-- than shipped with silently missing controls.
--
--   General tab      barcode
--   Hardware tab     print_return_slip
--                    (print_delivery_slip, print_product_labels and
--                     print_lot_serial_labels already exist)
--   Barcode App tab  show_reserved_lots
--                    mandatory_scan_dest_location
--                    allow_full_picking_validation
--                    force_dest_all_products
--                    (mandatory_scan_product, mandatory_scan_lot_serial and
--                     allow_extra_products already exist)
--
-- SCOPE: additive columns only. No CHECK constraints, no foreign keys, no RPC
-- change, no trigger, no backfill statement, no behaviour change. Nothing reads
-- these columns yet.
--
-- EXISTING ROWS: the 4 operation types (ITEM ESTIMATE, GOODS RECEIVED, DELIVERY
-- NOTE, RETURNS) pick up the column defaults and are otherwise untouched --
-- `barcode` NULL, `show_reserved_lots` true, the other four false. No existing
-- column is written. On PostgreSQL 17.6 a non-volatile DEFAULT is stored as a
-- metadata attribute, so ADD COLUMN does not rewrite the table.
--
-- Defaults chosen to match current behaviour, so reading a column later cannot
-- change what the app does today: the three permission-ish flags default false
-- (nothing is forced or newly allowed) and show_reserved_lots defaults true
-- (reserved lots are visible today).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-apply to the live database.
--
-- ---------------------------------------------------------------------------
-- REVERSE / ROLLBACK — run this to undo this migration in full.
-- Lossless today because nothing writes these columns; once the config page
-- ships, this discards whatever has been configured.
--
--   ALTER TABLE public.operation_types
--     DROP COLUMN IF EXISTS barcode,
--     DROP COLUMN IF EXISTS print_return_slip,
--     DROP COLUMN IF EXISTS show_reserved_lots,
--     DROP COLUMN IF EXISTS mandatory_scan_dest_location,
--     DROP COLUMN IF EXISTS allow_full_picking_validation,
--     DROP COLUMN IF EXISTS force_dest_all_products;
--
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.operation_types
  ADD COLUMN IF NOT EXISTS barcode                       text,
  ADD COLUMN IF NOT EXISTS print_return_slip             boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_reserved_lots            boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS mandatory_scan_dest_location  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_full_picking_validation boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS force_dest_all_products       boolean DEFAULT false;

COMMENT ON COLUMN public.operation_types.barcode IS
  'General tab: barcode identifying this operation type, for scanning straight into it from the barcode app. Free text, no uniqueness enforced.';
COMMENT ON COLUMN public.operation_types.print_return_slip IS
  'Hardware tab: print a return slip on validation. Completes the print_* set alongside print_delivery_slip, print_product_labels and print_lot_serial_labels.';
COMMENT ON COLUMN public.operation_types.show_reserved_lots IS
  'Barcode App tab: show reserved lots/serial numbers to the operator. Defaults true to match current behaviour.';
COMMENT ON COLUMN public.operation_types.mandatory_scan_dest_location IS
  'Barcode App tab: operator must scan the destination location. Completes the mandatory_scan_* set alongside mandatory_scan_product and mandatory_scan_lot_serial.';
COMMENT ON COLUMN public.operation_types.allow_full_picking_validation IS
  'Barcode App tab: allow validating an entire picking in one action rather than line by line.';
COMMENT ON COLUMN public.operation_types.force_dest_all_products IS
  'Barcode App tab: require a destination location on every product line.';

COMMIT;

-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFICATION (read-only, run separately)
--
--   -- 6 columns present with the intended types and defaults
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'operation_types'
--      AND column_name IN ('barcode','print_return_slip','show_reserved_lots',
--                          'mandatory_scan_dest_location',
--                          'allow_full_picking_validation',
--                          'force_dest_all_products')
--    ORDER BY column_name;
--
--   -- operation_types is now 26 columns (was 20)
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'operation_types';
--
--   -- 4 rows, defaults applied, pre-existing values unchanged
--   SELECT name, operation_kind, sequence_prefix, card_color,
--          create_backorder, use_existing_lots, create_new_lots,
--          print_delivery_slip, mandatory_scan_product, allow_extra_products,
--          barcode, print_return_slip, show_reserved_lots,
--          mandatory_scan_dest_location, allow_full_picking_validation,
--          force_dest_all_products
--     FROM public.operation_types
--    ORDER BY created_at;
--   -- expect: 4 rows; barcode NULL; show_reserved_lots true; the other four
--   -- false; and name/kind/prefix/color/backorder/lots/print/scan exactly as
--   -- before (ITEM ESTIMATE INT amber always, GOODS RECEIVED RCP purple always,
--   -- DELIVERY NOTE DEL green ask, RETURNS RTN red never).
--
--   -- no constraints were added
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'public.operation_types'::regclass
--    ORDER BY conname;
--   -- expect the same 6 as before: 2 CHECK, 3 FK, 1 PK.
-- ---------------------------------------------------------------------------
