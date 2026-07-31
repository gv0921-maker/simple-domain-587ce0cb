-- Activate per-operation-type numbering for GOODS RECEIVED.
-- Step 7 of docs/GR_CREATION_DESIGN.md — the FIRST OBSERVABLE BEHAVIOUR CHANGE.
--
-- Everything before this was plumbing: 20260731090000 added the sequence columns
-- and seeded the counters, 20260731100000 taught generate_document_number to use
-- them. Both were inert because owns_sequence was false everywhere. This flips
-- exactly one boolean on exactly one row, and numbering changes.
--
-- WHAT CHANGES, precisely:
--   A goods receipt created WITH operation_type_id = GOODS RECEIVED now draws
--   from that operation type's own sequence:
--       RCP/2627/0011, then 0012, ...
--   and advances operation_types.sequence_current_number (10 -> 11 -> ...).
--
-- WHAT DOES NOT CHANGE:
--   * A goods receipt with operation_type_id NULL still takes the global branch
--     and advances numbering_sequences.goods_receipt (GR/2627/0011, ...).
--   * The other four operation types keep owns_sequence = false and stay on the
--     global path.
--   * Every non-operation-type document — sales orders, quotations, invoices,
--     payments, credit notes, vendor orders, work orders, returns, stock counts,
--     write-offs, correction orders, internal movements — is untouched. Their
--     callers pass no operation type, so they take Branch B, which is the
--     pre-migration body verbatim.
--
-- DELIBERATE DECISIONS (confirmed before applying):
--   * sequence_prefix stays 'RCP'. The first op-type receipt is therefore
--     RCP/2627/0011, a new series that cannot collide with the existing
--     GR-2627-0001..0010 documents.
--   * sequence_current_number stays 10, NOT reset to 0, so the series continues
--     rather than restarting. This is the conservative GREATEST seed applied in
--     20260731090000.
--   * The separator is '/' because numbering_settings.prefix_separator was
--     changed from '-' to '/' on 2026-07-30. Existing receipts keep their
--     dashes; this is a pre-existing setting, not something this migration does.
--
-- The DO block is a safety guard: operation_types.name has NO unique constraint,
-- so a bare UPDATE ... WHERE name = '...' could silently hit several rows if a
-- duplicate is ever created. It aborts unless exactly one row matches.
--
-- Idempotent: re-running sets true to true and re-stamps updated_at. It never
-- touches sequence_current_number, so a re-run cannot disturb a live counter.
--
-- ---------------------------------------------------------------------------
-- REVERSE / ROLLBACK — a complete, instant revert of the behaviour change.
-- No function is touched; numbering returns to the global path immediately.
--
--   UPDATE public.operation_types
--      SET owns_sequence = false, updated_at = now()
--    WHERE name = 'GOODS RECEIVED' AND operation_kind = 'receipt';
--
-- Receipts already issued as RCP/2627/#### keep those numbers, and
-- sequence_current_number keeps its value, so re-activating later resumes the
-- series rather than reusing numbers.
-- ---------------------------------------------------------------------------

BEGIN;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.operation_types
   WHERE name = 'GOODS RECEIVED' AND operation_kind = 'receipt';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly 1 operation type matching (name = ''GOODS RECEIVED'', operation_kind = ''receipt''), found %. Refusing to flip owns_sequence.',
      v_count;
  END IF;
END $$;

UPDATE public.operation_types
   SET owns_sequence = true,
       updated_at    = now()
 WHERE name = 'GOODS RECEIVED'
   AND operation_kind = 'receipt';

COMMIT;

-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFICATION (read-only)
--
--   -- (a) GOODS RECEIVED now uses its own series; the plain call does not
--   SELECT public.preview_next_document_number('goods_receipt') AS global_path,
--          (SELECT public.preview_next_document_number('goods_receipt', id)
--             FROM public.operation_types WHERE name = 'GOODS RECEIVED') AS op_type_path;
--   -- expect global_path = 'GR/2627/0011', op_type_path = 'RCP/2627/0011'
--
--   -- (b) non-operation-type documents unchanged
--   SELECT public.preview_next_document_number('sales_order')    AS so,   -- SO/2627/0007
--          public.preview_next_document_number('invoice')        AS inv,
--          public.preview_next_document_number('payment_receipt') AS pr;  -- PR/2627/0007
--
--   -- (c) only GOODS RECEIVED is switched on
--   SELECT name, owns_sequence, sequence_current_number
--     FROM public.operation_types ORDER BY name;
--   -- expect exactly one row true; the other four false and untouched
--
--   -- after creating a real goods receipt under this operation type:
--   --   its gr_number should be RCP/2627/0011
--   --   operation_types.sequence_current_number should be 11
--   --   numbering_sequences.goods_receipt should STILL be 10
-- ---------------------------------------------------------------------------
