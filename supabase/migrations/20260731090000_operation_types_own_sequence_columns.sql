-- Operation Types own their numbering sequence — Sections 1 and 2 of
-- docs/GR_CREATION_DESIGN.md. ADDITIVE ONLY.
--
-- WHY: today every document number comes from the global path —
-- generate_document_number(text) reads a hardcoded prefix CASE, the format from
-- numbering_settings, and the counter from numbering_sequences keyed by
-- (document_type, fy_label). operation_types.sequence_prefix is read by NO SQL
-- function and no numbering code; it is display-only. These columns give each
-- operation type a self-contained sequence so a later step can key numbering off
-- operation_type_id.
--
-- SCOPE: 5 additive columns + 1 CHECK + a one-time seed. NO function is created
-- or replaced, NO trigger is added, NO existing column is written.
--
-- ***** ZERO BEHAVIOUR CHANGE — EXPLICIT CONFIRMATION *****
-- After this migration every document is still numbered exactly as it is today:
--   * generate_document_number(text) is NOT touched (that is Section 3).
--   * preview_next_document_number(text) is NOT touched.
--   * gr_set_number() and the other 8 numbering triggers are NOT touched.
--   * numbering_sequences and numbering_settings are NOT written.
-- The switch that would change anything is `owns_sequence`, and it defaults
-- FALSE on every row. Nothing reads any of these columns yet.
--
-- SEEDING — the critical-correctness part, and what it is really defending
-- against. No existing document belongs to any operation type's series:
--   * the 10 goods receipts are GR-2627-0001..0010, but GOODS RECEIVED's
--     sequence_prefix is 'RCP' -> zero documents match 'RCP-2627-%'
--   * the 4 transfers are ITO-2627-0002..0005, but the three internal_transfer
--     types are 'INT' / 'KDR' / 'RTN' -> zero documents match either
-- So a collision is impossible TODAY whatever we seed. The seed defends against
-- a future prefix edit: if someone sets GOODS RECEIVED's prefix to 'GR' after
-- go-live, an unseeded counter would reissue GR-2627-0001, and
-- goods_receipts_gr_number_key (UNIQUE) would reject the insert outright.
--
-- Per GR_CREATION_DESIGN.md section 2c the seed is therefore
--   GREATEST(global counter for the mapped document_type + FY,
--            MAX(trailing number) of documents already matching this op type's
--            own prefix + FY pattern)
-- Both sources, because the counter alone is wrong if a number was ever supplied
-- explicitly (the triggers only fill when the number IS NULL or ''), and the
-- documents alone are wrong if numbers were issued then rolled back.
--
-- Idempotent, and safe to re-run AFTER go-live: the seed only touches rows whose
-- sequence_fy_label IS NULL, i.e. rows never seeded. Without that guard a re-run
-- would reset a live counter BACKWARDS and cause exactly the duplicate numbers
-- this step exists to prevent.
--
-- ---------------------------------------------------------------------------
-- REVERSE / ROLLBACK — run this to undo this migration in full.
-- Dropping the columns drops the CHECK with them. Lossless today because
-- nothing reads them; after Section 3 ships this would discard live counters.
--
--   ALTER TABLE public.operation_types
--     DROP COLUMN IF EXISTS sequence_fy_label,
--     DROP COLUMN IF EXISTS sequence_current_number,
--     DROP COLUMN IF EXISTS sequence_padding,
--     DROP COLUMN IF EXISTS sequence_separator,
--     DROP COLUMN IF EXISTS owns_sequence;
--
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- SECTION 1 — per-operation-type sequence columns
--
-- sequence_prefix (text, position 4) already exists and is reused as-is.
-- padding and separator are NULLABLE ON PURPOSE: NULL means "inherit
-- numbering_settings", so the global format still applies unless an operation
-- type deliberately overrides it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.operation_types
  ADD COLUMN IF NOT EXISTS sequence_fy_label       text,
  ADD COLUMN IF NOT EXISTS sequence_current_number integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sequence_padding        integer,
  ADD COLUMN IF NOT EXISTS sequence_separator      text,
  ADD COLUMN IF NOT EXISTS owns_sequence           boolean NOT NULL DEFAULT false;

-- An operation type cannot be switched on without the two fields the formatter
-- needs. Satisfied trivially today: owns_sequence is false on every row.
ALTER TABLE public.operation_types
  DROP CONSTRAINT IF EXISTS operation_types_owns_sequence_requires_fields;
ALTER TABLE public.operation_types
  ADD  CONSTRAINT operation_types_owns_sequence_requires_fields
       CHECK (NOT owns_sequence
              OR (sequence_prefix IS NOT NULL AND sequence_fy_label IS NOT NULL));

COMMENT ON COLUMN public.operation_types.sequence_fy_label IS
  'Financial year this counter belongs to, e.g. 2627. On the first document of a new FY the generator resets sequence_current_number to 1 and stamps the new label. NULL means never seeded.';
COMMENT ON COLUMN public.operation_types.sequence_current_number IS
  'Count already ISSUED by this operation type''s series, so the next document is this + 1. Same semantics as numbering_sequences.last_number and serial_counters.last_number.';
COMMENT ON COLUMN public.operation_types.sequence_padding IS
  'Zero-padding width. NULL inherits numbering_settings.sequential_padding.';
COMMENT ON COLUMN public.operation_types.sequence_separator IS
  'Separator between prefix, FY and counter. NULL inherits numbering_settings.prefix_separator.';
COMMENT ON COLUMN public.operation_types.owns_sequence IS
  'When true, documents created under this operation type draw their number from this row instead of the global numbering_sequences table. Defaults false so adding these columns changes nothing; flipping it per operation type is the go-live switch (GR_CREATION_DESIGN.md step 7).';

-- ---------------------------------------------------------------------------
-- SECTION 2 — seed each counter from real document numbers
--
-- Derived from live data, never hardcoded. Guarded to rows never seeded.
-- ---------------------------------------------------------------------------
WITH fy AS (
  SELECT public.get_current_fy_label() AS label
),
-- operation_kind -> the document type the global counter uses. The vocabularies
-- genuinely differ ('receipt' vs 'goods_receipt', 'delivery' vs
-- 'delivery_note'), which is why this mapping has to be explicit.
kind_map(operation_kind, document_type) AS (
  VALUES ('receipt','goods_receipt'),
         ('delivery','delivery_note'),
         ('internal_transfer','internal_transfer'),
         ('manufacturing','work_order')
),
-- every existing document number that a per-op-type series could collide with
docs(operation_kind, number) AS (
  SELECT 'receipt',           gr_number   FROM public.goods_receipts           WHERE gr_number  IS NOT NULL
  UNION ALL
  SELECT 'delivery',          reference   FROM public.delivery_notes           WHERE reference  IS NOT NULL
  UNION ALL
  SELECT 'internal_transfer', ito_number  FROM public.internal_transfer_orders WHERE ito_number IS NOT NULL
),
seed AS (
  SELECT ot.id,
         (SELECT label FROM fy) AS fy_label,
         GREATEST(
           -- (a) the global counter for the mapped document type in this FY
           COALESCE((SELECT ns.last_number
                       FROM public.numbering_sequences ns
                      WHERE ns.document_type = km.document_type
                        AND ns.fy_label = (SELECT label FROM fy)), 0),
           -- (b) the highest trailing number already issued under THIS
           --     operation type's own prefix in this FY
           COALESCE((SELECT MAX((regexp_match(d.number, '(\d+)$'))[1]::int)
                       FROM docs d
                      WHERE d.operation_kind = ot.operation_kind
                        AND ot.sequence_prefix IS NOT NULL
                        AND d.number LIKE ot.sequence_prefix || '%'
                        AND d.number LIKE '%' || (SELECT label FROM fy) || '%'), 0)
         ) AS current_number
    FROM public.operation_types ot
    LEFT JOIN kind_map km ON km.operation_kind = ot.operation_kind
)
UPDATE public.operation_types ot
   SET sequence_current_number = seed.current_number,
       sequence_fy_label       = seed.fy_label,
       updated_at              = now()
  FROM seed
 WHERE seed.id = ot.id
   AND ot.sequence_fy_label IS NULL;   -- never re-seed a live counter

COMMIT;

-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFICATION (read-only, run separately)
--
--   -- 5 columns present, operation_types now 31 columns (was 26)
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='operation_types'
--      AND column_name IN ('sequence_fy_label','sequence_current_number',
--                          'sequence_padding','sequence_separator','owns_sequence')
--    ORDER BY column_name;
--
--   -- the seed, and what each series would issue first once switched on
--   SELECT name, operation_kind, sequence_prefix, owns_sequence,
--          sequence_fy_label, sequence_current_number,
--          sequence_prefix || '-' || sequence_fy_label || '-' ||
--            lpad((sequence_current_number + 1)::text, 4, '0') AS next_number_when_enabled
--     FROM public.operation_types ORDER BY operation_kind, name;
--   -- expect owns_sequence FALSE on all 5, fy_label '2627', and
--   --   GOODS RECEIVED 10 -> RCP-2627-0011
--   --   ITEM ESTIMATE / KADRI - ITEM ESTIMATE / RETURNS 5 -> INT|KDR|RTN-2627-0006
--   --   DELIVERY NOTE 0 -> DEL-2627-0001
--
--   -- NOTHING ELSE MOVED
--   SELECT document_type, fy_label, last_number FROM public.numbering_sequences
--    ORDER BY document_type;      -- unchanged: correction_order 1, goods_receipt 10,
--                                 -- internal_transfer 5, payment_receipt 6,
--                                 -- quotation 2, sales_order 6, stock_count 1
--   SELECT gr_number FROM public.goods_receipts ORDER BY created_at;
--                                 -- unchanged: GR-2627-0001 .. GR-2627-0010
--   SELECT count(*) FROM public.goods_receipt_serials;          -- 16
--   SELECT count(*) FROM public.stock_moves;                    -- 8
--   SELECT count(*) FROM public.stock_move_lines;               -- 8
--
--   -- numbering functions untouched: still exactly one row each, one argument
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public'
--      AND proname IN ('generate_document_number','preview_next_document_number',
--                      'gr_set_number');
--
--   -- and the global path still answers as before
--   SELECT public.preview_next_document_number('goods_receipt');  -- GR-2627-0011
--   SELECT public.preview_next_document_number('sales_order');    -- SO-2627-0007
-- ---------------------------------------------------------------------------
