-- Section 3 of docs/GR_CREATION_DESIGN.md — per-operation-type numbering.
--
-- WHAT CHANGES: generate_document_number gains an optional operation type. When
-- one is supplied AND that operation type owns a sequence, the number is drawn
-- from the operation type's own columns (prefix, fy_label, current_number,
-- padding, separator), incremented atomically under FOR UPDATE. In every other
-- case — no operation type, unknown operation type, or owns_sequence = false —
-- the function behaves EXACTLY as it does today, from numbering_sequences.
--
-- ***** APPLYING THIS ALONE CHANGES NOTHING OBSERVABLE *****
-- owns_sequence is currently false on all 5 operation types, so every document
-- still takes the global branch. Activation is a separate one-row UPDATE
-- (see "TO ACTIVATE" below), which is what makes this migration verifiable in
-- two distinct stages: first that nothing moved, then that the new path works.
--
-- ---------------------------------------------------------------------------
-- THE OVERLOAD LANDMINE — why this migration DROPs before it CREATEs
--
-- `CREATE OR REPLACE FUNCTION` with a different argument list creates a SECOND
-- function rather than replacing the first. PostgREST resolves RPCs by argument
-- names, and an ambiguous pair breaks every caller — this is the failure that
-- previously broke create_ito_from_so. Both functions are therefore dropped by
-- their exact old signature and recreated, inside one transaction so there is no
-- window in which they do not exist.
--
-- The new second parameter is DEFAULTED, so all 18 existing SQL call sites and
-- both frontend RPC calls (which pass the named argument p_document_type)
-- continue to resolve without modification. Only gr_set_number is updated, to
-- start passing the operation type it already has on NEW.
--
-- Verify immediately after applying — this is the check that matters most:
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public'
--      AND proname IN ('generate_document_number','preview_next_document_number');
--   -- expect EXACTLY ONE row per function. Two rows = overload = broken.
--
-- ---------------------------------------------------------------------------
-- REVERSE / ROLLBACK — restores all three functions to their pre-migration form.
-- Run the whole block; it drops the two-argument versions and recreates the
-- originals verbatim.
--
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.generate_document_number(text, uuid);
--   DROP FUNCTION IF EXISTS public.preview_next_document_number(text, uuid);
--
--   CREATE OR REPLACE FUNCTION public.generate_document_number(p_document_type text)
--    RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
--   AS $function$
--   DECLARE
--     v_fy text; v_padding integer; v_sep text; v_next integer; v_prefix text;
--   BEGIN
--     v_fy := public.get_current_fy_label();
--     SELECT sequential_padding, prefix_separator INTO v_padding, v_sep FROM public.numbering_settings LIMIT 1;
--     IF v_padding IS NULL THEN v_padding := 4; END IF;
--     IF v_sep IS NULL THEN v_sep := '-'; END IF;
--     v_prefix := CASE lower(p_document_type)
--       WHEN 'sales_order' THEN 'SO' WHEN 'quotation' THEN 'QT' WHEN 'invoice' THEN 'INV'
--       WHEN 'delivery_note' THEN 'DN' WHEN 'internal_transfer' THEN 'ITO' WHEN 'internal_movement' THEN 'IM'
--       WHEN 'vendor_order' THEN 'VO' WHEN 'work_order' THEN 'WO' WHEN 'return_request' THEN 'RT'
--       WHEN 'credit_note' THEN 'CN' WHEN 'goods_receipt' THEN 'GR' WHEN 'payment_receipt' THEN 'PR'
--       WHEN 'correction_order' THEN 'CO' WHEN 'stock_count' THEN 'SC' WHEN 'write_off' THEN 'WF'
--       WHEN 'refund' THEN 'RF' WHEN 'exchange' THEN 'EX'
--       ELSE upper(p_document_type) END;
--     INSERT INTO public.numbering_sequences (document_type, fy_label, last_number)
--     VALUES (p_document_type, v_fy, 1)
--     ON CONFLICT (document_type, fy_label)
--     DO UPDATE SET last_number = public.numbering_sequences.last_number + 1, updated_at = now()
--     RETURNING last_number INTO v_next;
--     RETURN v_prefix || v_sep || v_fy || v_sep || lpad(v_next::text, v_padding, '0');
--   END;
--   $function$;
--
--   CREATE OR REPLACE FUNCTION public.preview_next_document_number(p_document_type text)
--    RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
--   AS $function$
--   DECLARE
--     v_fy text; v_padding integer; v_sep text; v_next integer; v_prefix text;
--   BEGIN
--     v_fy := public.get_current_fy_label();
--     SELECT sequential_padding, prefix_separator INTO v_padding, v_sep FROM public.numbering_settings LIMIT 1;
--     IF v_padding IS NULL THEN v_padding := 4; END IF;
--     IF v_sep IS NULL THEN v_sep := '-'; END IF;
--     SELECT COALESCE(last_number, 0) + 1 INTO v_next
--     FROM public.numbering_sequences
--     WHERE document_type = p_document_type AND fy_label = v_fy;
--     IF v_next IS NULL THEN v_next := 1; END IF;
--     v_prefix := CASE lower(p_document_type)
--       WHEN 'sales_order' THEN 'SO' WHEN 'quotation' THEN 'QT' WHEN 'invoice' THEN 'INV'
--       WHEN 'delivery_note' THEN 'DN' WHEN 'internal_transfer' THEN 'ITO' WHEN 'internal_movement' THEN 'IM'
--       WHEN 'vendor_order' THEN 'VO' WHEN 'work_order' THEN 'WO' WHEN 'return_request' THEN 'RT'
--       WHEN 'credit_note' THEN 'CN' WHEN 'goods_receipt' THEN 'GR' WHEN 'payment_receipt' THEN 'PR'
--       WHEN 'correction_order' THEN 'CO' WHEN 'stock_count' THEN 'SC' WHEN 'write_off' THEN 'WF'
--       WHEN 'refund' THEN 'RF' WHEN 'exchange' THEN 'EX'
--       ELSE upper(p_document_type) END;
--     RETURN v_prefix || v_sep || v_fy || v_sep || lpad(v_next::text, v_padding, '0');
--   END;
--   $function$;
--
--   CREATE OR REPLACE FUNCTION public.gr_set_number()
--    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
--   AS $function$
--   BEGIN
--     IF NEW.gr_number IS NULL OR NEW.gr_number = '' THEN
--       NEW.gr_number := public.generate_document_number('goods_receipt');
--     END IF;
--     RETURN NEW;
--   END $function$;
--   COMMIT;
--
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- Drop by exact old signature. Recreating with a different argument list
-- without this would leave two functions and make PostgREST ambiguous.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.generate_document_number(text);
DROP FUNCTION IF EXISTS public.preview_next_document_number(text);

-- ---------------------------------------------------------------------------
-- generate_document_number — issues and consumes a number.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.generate_document_number(
  p_document_type    text,
  p_operation_type_id uuid DEFAULT NULL
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fy      text;
  v_padding integer;
  v_sep     text;
  v_next    integer;
  v_prefix  text;
  v_ot      public.operation_types%ROWTYPE;
BEGIN
  v_fy := public.get_current_fy_label();

  -- Global format defaults; an operation type may override them per-sequence.
  SELECT sequential_padding, prefix_separator INTO v_padding, v_sep
    FROM public.numbering_settings LIMIT 1;
  IF v_padding IS NULL THEN v_padding := 4; END IF;
  IF v_sep IS NULL THEN v_sep := '-'; END IF;

  -- =========================================================================
  -- BRANCH A — the operation type owns its sequence.
  --
  -- FOR UPDATE takes a row-level lock for the rest of the transaction, which is
  -- what makes the read-modify-write atomic. It is the per-row equivalent of
  -- the INSERT .. ON CONFLICT DO UPDATE used by the global branch: two
  -- concurrent inserts under the same operation type serialise here rather than
  -- both reading the same current_number.
  -- =========================================================================
  IF p_operation_type_id IS NOT NULL THEN
    SELECT * INTO v_ot
      FROM public.operation_types
     WHERE id = p_operation_type_id
       FOR UPDATE;

    IF FOUND AND v_ot.owns_sequence AND v_ot.sequence_prefix IS NOT NULL THEN
      -- Per-sequence format overrides, falling back to the global settings.
      v_padding := COALESCE(v_ot.sequence_padding, v_padding);
      v_sep     := COALESCE(v_ot.sequence_separator, v_sep);

      -- Financial-year roll-over: the first document of a new FY restarts the
      -- series at 1 and stamps the new label.
      IF v_ot.sequence_fy_label IS DISTINCT FROM v_fy THEN
        v_next := 1;
      ELSE
        v_next := v_ot.sequence_current_number + 1;
      END IF;

      UPDATE public.operation_types
         SET sequence_current_number = v_next,
             sequence_fy_label       = v_fy,
             updated_at              = now()
       WHERE id = p_operation_type_id;

      RETURN v_ot.sequence_prefix || v_sep || v_fy || v_sep
             || lpad(v_next::text, v_padding, '0');
    END IF;
    -- Not found, or does not own a sequence: fall through to the global branch.
  END IF;

  -- =========================================================================
  -- BRANCH B — global sequence. Unchanged from the pre-migration function.
  -- This is the path every Sales, Invoicing, Manufacturing and Returns document
  -- takes, and it must stay byte-for-byte equivalent in behaviour.
  -- =========================================================================
  v_prefix := CASE lower(p_document_type)
    WHEN 'sales_order' THEN 'SO' WHEN 'quotation' THEN 'QT' WHEN 'invoice' THEN 'INV'
    WHEN 'delivery_note' THEN 'DN' WHEN 'internal_transfer' THEN 'ITO' WHEN 'internal_movement' THEN 'IM'
    WHEN 'vendor_order' THEN 'VO' WHEN 'work_order' THEN 'WO' WHEN 'return_request' THEN 'RT'
    WHEN 'credit_note' THEN 'CN' WHEN 'goods_receipt' THEN 'GR' WHEN 'payment_receipt' THEN 'PR'
    WHEN 'correction_order' THEN 'CO' WHEN 'stock_count' THEN 'SC' WHEN 'write_off' THEN 'WF'
    WHEN 'refund' THEN 'RF' WHEN 'exchange' THEN 'EX'
    ELSE upper(p_document_type) END;

  INSERT INTO public.numbering_sequences (document_type, fy_label, last_number)
  VALUES (p_document_type, v_fy, 1)
  ON CONFLICT (document_type, fy_label)
  DO UPDATE SET last_number = public.numbering_sequences.last_number + 1, updated_at = now()
  RETURNING last_number INTO v_next;

  RETURN v_prefix || v_sep || v_fy || v_sep || lpad(v_next::text, v_padding, '0');
END;
$function$;

COMMENT ON FUNCTION public.generate_document_number(text, uuid) IS
  'Issues the next document number. With an operation type that owns a sequence, draws from that operation type''s own columns under FOR UPDATE; otherwise from numbering_sequences exactly as before. The second argument is optional so every pre-existing caller resolves unchanged.';

-- ---------------------------------------------------------------------------
-- preview_next_document_number — same decision, WITHOUT consuming a number.
-- Deliberately STABLE and deliberately no FOR UPDATE: a preview must not lock a
-- row or advance a counter.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.preview_next_document_number(
  p_document_type    text,
  p_operation_type_id uuid DEFAULT NULL
)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fy      text;
  v_padding integer;
  v_sep     text;
  v_next    integer;
  v_prefix  text;
  v_ot      public.operation_types%ROWTYPE;
BEGIN
  v_fy := public.get_current_fy_label();

  SELECT sequential_padding, prefix_separator INTO v_padding, v_sep
    FROM public.numbering_settings LIMIT 1;
  IF v_padding IS NULL THEN v_padding := 4; END IF;
  IF v_sep IS NULL THEN v_sep := '-'; END IF;

  IF p_operation_type_id IS NOT NULL THEN
    SELECT * INTO v_ot FROM public.operation_types WHERE id = p_operation_type_id;

    IF FOUND AND v_ot.owns_sequence AND v_ot.sequence_prefix IS NOT NULL THEN
      v_padding := COALESCE(v_ot.sequence_padding, v_padding);
      v_sep     := COALESCE(v_ot.sequence_separator, v_sep);

      IF v_ot.sequence_fy_label IS DISTINCT FROM v_fy THEN
        v_next := 1;
      ELSE
        v_next := v_ot.sequence_current_number + 1;
      END IF;

      RETURN v_ot.sequence_prefix || v_sep || v_fy || v_sep
             || lpad(v_next::text, v_padding, '0');
    END IF;
  END IF;

  SELECT COALESCE(last_number, 0) + 1 INTO v_next
  FROM public.numbering_sequences
  WHERE document_type = p_document_type AND fy_label = v_fy;
  IF v_next IS NULL THEN v_next := 1; END IF;

  v_prefix := CASE lower(p_document_type)
    WHEN 'sales_order' THEN 'SO' WHEN 'quotation' THEN 'QT' WHEN 'invoice' THEN 'INV'
    WHEN 'delivery_note' THEN 'DN' WHEN 'internal_transfer' THEN 'ITO' WHEN 'internal_movement' THEN 'IM'
    WHEN 'vendor_order' THEN 'VO' WHEN 'work_order' THEN 'WO' WHEN 'return_request' THEN 'RT'
    WHEN 'credit_note' THEN 'CN' WHEN 'goods_receipt' THEN 'GR' WHEN 'payment_receipt' THEN 'PR'
    WHEN 'correction_order' THEN 'CO' WHEN 'stock_count' THEN 'SC' WHEN 'write_off' THEN 'WF'
    WHEN 'refund' THEN 'RF' WHEN 'exchange' THEN 'EX'
    ELSE upper(p_document_type) END;

  RETURN v_prefix || v_sep || v_fy || v_sep || lpad(v_next::text, v_padding, '0');
END;
$function$;

COMMENT ON FUNCTION public.preview_next_document_number(text, uuid) IS
  'Non-consuming preview of the next document number. Mirrors generate_document_number''s branch logic; STABLE and takes no lock.';

-- ---------------------------------------------------------------------------
-- gr_set_number — the only caller updated. goods_receipts.operation_type_id is
-- already on NEW in a BEFORE INSERT trigger, so no extra lookup is needed.
-- Passing NULL (the current state of 9 of 10 rows) takes Branch B, i.e. today's
-- behaviour.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gr_set_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.gr_number IS NULL OR NEW.gr_number = '' THEN
    NEW.gr_number := public.generate_document_number('goods_receipt', NEW.operation_type_id);
  END IF;
  RETURN NEW;
END $function$;

COMMIT;

-- ---------------------------------------------------------------------------
-- TO ACTIVATE (separate, deliberate, and NOT part of this migration)
--
-- Applying the above changes nothing observable, because owns_sequence is false
-- on every operation type. To switch Goods Receipts onto their operation type's
-- series:
--
--   UPDATE public.operation_types
--      SET owns_sequence = true, updated_at = now()
--    WHERE name = 'GOODS RECEIVED';
--
-- To switch it back off — a complete, instant revert of the behaviour change,
-- without touching any function:
--
--   UPDATE public.operation_types
--      SET owns_sequence = false, updated_at = now()
--    WHERE name = 'GOODS RECEIVED';
--
-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFICATION (read-only unless stated)
--
-- STAGE 1 — nothing changed yet
--
--   -- THE critical check: exactly one row per function, two arguments each
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public'
--      AND proname IN ('generate_document_number','preview_next_document_number')
--    ORDER BY proname;
--   -- expect 2 rows total, each 'p_document_type text, p_operation_type_id uuid'
--
--   -- global previews unchanged for every module
--   SELECT public.preview_next_document_number('sales_order')    AS so,
--          public.preview_next_document_number('goods_receipt')  AS gr,
--          public.preview_next_document_number('quotation')      AS qt;
--
--   -- an operation type that does NOT own its sequence still previews globally
--   SELECT public.preview_next_document_number('goods_receipt', id) AS still_global
--     FROM public.operation_types WHERE name = 'GOODS RECEIVED';
--   -- must equal the plain goods_receipt preview above
--
--   SELECT count(*) FROM public.goods_receipts;            -- unchanged
--   SELECT document_type, fy_label, last_number FROM public.numbering_sequences
--    ORDER BY document_type;                                -- unchanged
--   SELECT name, owns_sequence, sequence_current_number FROM public.operation_types
--    ORDER BY name;                                         -- all owns_sequence false
--
-- STAGE 2 — after running the ACTIVATE statement above
--
--   SELECT public.preview_next_document_number('goods_receipt', id) AS op_type_series
--     FROM public.operation_types WHERE name = 'GOODS RECEIVED';
--   -- now the operation type's own series, from its prefix and current_number
--
--   -- create a GR with operation_type_id set -> gets the op type's series, and
--   -- operation_types.sequence_current_number advances by 1 while
--   -- numbering_sequences.goods_receipt does NOT move
--   -- create a GR with operation_type_id NULL -> still the global GR series, and
--   -- numbering_sequences.goods_receipt advances instead
--
--   -- non-inventory numbering must be untouched throughout
--   SELECT public.preview_next_document_number('sales_order');
-- ---------------------------------------------------------------------------
