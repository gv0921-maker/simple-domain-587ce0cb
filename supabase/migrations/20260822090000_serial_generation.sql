-- ============================================================================
-- SERIAL GENERATION — labels before the goods, and vendor serials beside them
--
-- V'S WORKFLOW: create the receipt with quantities -> GENERATE SERIALS ->
-- print labels -> stick them on the goods -> scan them in. Generation is
-- therefore a PREREQUISITE for printing, not a detail of it.
--
-- THE CONSTRAINT THAT SHAPES EVERYTHING: a generated-but-not-yet-received
-- serial CANNOT be an inv_stock_item. That table is the single source of truth
-- for what is in the building; the QC gate, the on-hand readers, the variant
-- archive guard and route enforcement all assume a row there is a real unit in
-- a real place. A pending serial is a NUMBER, not a UNIT, so it lives in its
-- own table and every one of those readers is untouched.
--
-- THREE DECISIONS FROM V, 2026-08-22, all encoded here:
--   1. The counter is per (product, FY) and CONTINUES across receipts.
--   2. A misprint is REPRINTED under the same number, not voided. Void is for
--      genuine cancellation only. Hence print_count, not void-and-regenerate.
--   3. Vendor serials COEXIST. A scanned serial with no pending row is a
--      vendor serial arriving, not an error.
--
-- Blast radius:
--   + 2 tables (inv_serial_sequence, inv_pending_serial)
--   + 4 functions (inv_generate_serials, inv_void_pending_serials,
--                  inv_record_serial_print, inv_tg_void_pending_serials_on_close)
--   ~ 1 function REPLACED (inv_receive_serial) — additive only, see section 6
--   + 3 triggers, + 8 policies, + indexes/constraints on the new tables
--   - no existing table, column, view, policy or constraint is altered
--   - no existing row is written or revalidated
-- ============================================================================

BEGIN;

-- =================== 1. the counter: per (product, FY) ====================
-- Modelled on inv_number_sequence, which has proven this shape for document
-- numbers, but keyed on (product_id, fy_label) because a serial's namespace is
-- the PRODUCT, not the document type.
--
-- WHY NOT REUSE WHAT EXISTS:
--   serial_counters          legacy, keyed on prefix alone with NO FY
--                            dimension, and shared with
--                            generate_serials_for_gr_line — the legacy path
--                            could advance our counter.
--   allocate_serial_numbers  mints {sku}-{yymm}-{n}. That is a SECOND
--                            convention and V forbade one.
--   inv_number_sequence      keyed (document_type, fy_label). Abusing
--                            document_type as 'serial:<sku>' would grow one row
--                            per product and surface every SKU in the numbering
--                            config screen as though it were a document type.
CREATE TABLE public.inv_serial_sequence (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  fy_label       text NOT NULL,
  current_number integer NOT NULL DEFAULT 0,
  padding        integer NOT NULL DEFAULT 4,
  separator      text    NOT NULL DEFAULT '-',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inv_serial_sequence_unique_product_fy UNIQUE (product_id, fy_label),
  CONSTRAINT inv_serial_sequence_current_nonneg    CHECK (current_number >= 0),
  CONSTRAINT inv_serial_sequence_padding_range     CHECK (padding BETWEEN 1 AND 12),
  CONSTRAINT inv_serial_sequence_fy_not_blank      CHECK (length(btrim(fy_label)) > 0)
);

COMMENT ON TABLE public.inv_serial_sequence IS
  'Serial counter, one row per (product, financial year). Continues across '
  'receipts: a receipt ending at 0012 means the next receipt for that product '
  'starts at 0013. Numbers are consumed on allocation and NEVER recycled.';

-- ===================== 2. the pending serial itself =======================
-- Keyed to the MOVE, not the operation: inv_move carries product_id (the SKU
-- that forms the prefix) and demand_qty (the default count). Keying to the
-- operation would lose the product on a multi-line receipt.
--
-- ON DELETE RESTRICT on move_id is deliberate. inv_remove_operation_line()
-- exists, and a line with printed labels out in the world must not vanish
-- silently — those labels have to be voided explicitly first.
CREATE TABLE public.inv_pending_serial (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  move_id       uuid NOT NULL REFERENCES public.inv_move(id) ON DELETE RESTRICT,

  -- UNIQUE ACROSS THE WHOLE TABLE, INCLUDING VOIDED AND CONSUMED ROWS.
  -- This is what implements never-recycle: a voided number stays occupied so
  -- it can never be minted again. A partial unique index over live rows only
  -- would hand a retired number back out, and a voided label may already be
  -- stuck to a piece of furniture.
  serial        text NOT NULL UNIQUE,

  generated_at  timestamptz NOT NULL DEFAULT now(),
  generated_by  uuid,

  -- DECISION 2: a misprint is reprinted under the SAME number. Printing is
  -- therefore a counter and a log, not a state, and nothing here can retire a
  -- number. The count exists so a reprint is visible rather than invisible.
  print_count       integer NOT NULL DEFAULT 0,
  first_printed_at  timestamptz,
  last_printed_at   timestamptz,

  consumed_at   timestamptz,
  stock_item_id uuid REFERENCES public.inv_stock_item(id) ON DELETE RESTRICT,

  voided_at     timestamptz,
  voided_by     uuid,
  void_reason   text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT inv_pending_serial_not_blank CHECK (length(btrim(serial)) > 0),

  -- A number is pending, consumed, or voided. Never two at once: "received AND
  -- cancelled" is not a state a physical label can be in.
  CONSTRAINT inv_pending_serial_single_outcome
    CHECK (NOT (consumed_at IS NOT NULL AND voided_at IS NOT NULL)),

  -- Consumed means "this number now names a real unit". The link is the proof.
  CONSTRAINT inv_pending_serial_consumed_pair
    CHECK ((consumed_at IS NULL AND stock_item_id IS NULL)
        OR (consumed_at IS NOT NULL AND stock_item_id IS NOT NULL)),

  -- Rule 5: a number retired without a reason is indistinguishable from one
  -- that was lost.
  CONSTRAINT inv_pending_serial_void_pair
    CHECK ((voided_at IS NULL AND void_reason IS NULL)
        OR (voided_at IS NOT NULL AND length(btrim(void_reason)) > 0)),

  CONSTRAINT inv_pending_serial_print_count_nonneg CHECK (print_count >= 0),
  CONSTRAINT inv_pending_serial_print_pair
    CHECK ((print_count = 0 AND first_printed_at IS NULL AND last_printed_at IS NULL)
        OR (print_count > 0 AND first_printed_at IS NOT NULL AND last_printed_at IS NOT NULL))
);

COMMENT ON TABLE public.inv_pending_serial IS
  'A serial number generated for a receipt line and not yet received. NOT a '
  'stock item: it is a number, not a unit, and it lives outside inv_stock_item '
  'so on-hand, QC, route and variant-guard readers never see it. A scanned '
  'serial with NO row here is a VENDOR serial, which is normal.';

CREATE INDEX inv_pending_serial_move_idx ON public.inv_pending_serial (move_id);
CREATE INDEX inv_pending_serial_open_idx ON public.inv_pending_serial (move_id)
  WHERE consumed_at IS NULL AND voided_at IS NULL;
CREATE INDEX inv_pending_serial_stock_item_idx ON public.inv_pending_serial (stock_item_id)
  WHERE stock_item_id IS NOT NULL;

CREATE TRIGGER inv_serial_sequence_set_updated_at
  BEFORE UPDATE ON public.inv_serial_sequence
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER inv_pending_serial_set_updated_at
  BEFORE UPDATE ON public.inv_pending_serial
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================== 3. RLS ====================================
-- Identical shape to inv_move / inv_move_line: everyone reads, inventory
-- writers write, only admins delete.
ALTER TABLE public.inv_serial_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_pending_serial  ENABLE ROW LEVEL SECURITY;

CREATE POLICY inv_serial_sequence_select_auth ON public.inv_serial_sequence
  FOR SELECT USING (true);
CREATE POLICY inv_serial_sequence_insert_inv ON public.inv_serial_sequence
  FOR INSERT WITH CHECK (public.can_write_inventory());
CREATE POLICY inv_serial_sequence_update_inv ON public.inv_serial_sequence
  FOR UPDATE USING (public.can_write_inventory()) WITH CHECK (public.can_write_inventory());
CREATE POLICY inv_serial_sequence_delete_admin ON public.inv_serial_sequence
  FOR DELETE USING (public.is_admin());

CREATE POLICY inv_pending_serial_select_auth ON public.inv_pending_serial
  FOR SELECT USING (true);
CREATE POLICY inv_pending_serial_insert_inv ON public.inv_pending_serial
  FOR INSERT WITH CHECK (public.can_write_inventory());
CREATE POLICY inv_pending_serial_update_inv ON public.inv_pending_serial
  FOR UPDATE USING (public.can_write_inventory()) WITH CHECK (public.can_write_inventory());
CREATE POLICY inv_pending_serial_delete_admin ON public.inv_pending_serial
  FOR DELETE USING (public.is_admin());

-- ========================= 4. the generator ===============================
CREATE FUNCTION public.inv_generate_serials(p_move_id uuid, p_count integer)
RETURNS TABLE (pending_id uuid, serial_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_op        public.inv_operation%ROWTYPE;
  v_ot        public.inv_operation_type%ROWTYPE;
  v_seq       public.inv_number_sequence%ROWTYPE;
  v_product   uuid;
  v_sku       text;
  v_fy        text;
  v_docsep    text;
  v_pad       integer;
  v_ssep      text;
  v_made      integer := 0;
  v_attempts  integer := 0;
  v_num       integer;
  v_candidate text;
  v_id        uuid;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to generate serial numbers.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_count IS NULL OR p_count < 1 THEN
    RAISE EXCEPTION 'The number of serials to generate must be at least 1.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A cap, because this burns numbers irreversibly. A fat-fingered 10000 is a
  -- permanent gap in the sequence and cannot be undone.
  IF p_count > 500 THEN
    RAISE EXCEPTION
      'Refusing to generate % serials at once; the cap is 500. Numbers are consumed on allocation and never recycled, so a mistyped count cannot be taken back.',
      p_count
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT o.* INTO v_op
    FROM public.inv_move m
    JOIN public.inv_operation o ON o.id = m.operation_id
   WHERE m.id = p_move_id;

  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Move % not found.', p_move_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT m.product_id INTO v_product FROM public.inv_move m WHERE m.id = p_move_id;
  SELECT * INTO v_ot FROM public.inv_operation_type WHERE id = v_op.operation_type_id;

  -- Only receipts. A transfer or delivery moves units that already exist, so
  -- generating a number for one would mint a label for a unit that already has
  -- a serial. Same reasoning as inv_tg_stock_item_origin's kind restriction.
  IF v_ot.kind <> 'receipt'::public.inv_operation_kind THEN
    RAISE EXCEPTION
      'Operation % is a % operation, not a receipt. Serial numbers are generated only on receipts, because only a receipt brings a new unit into existence.',
      v_op.number, v_ot.kind
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_op.state IN ('done','cancelled') THEN
    RAISE EXCEPTION
      'Receipt % is already % and cannot have further serials generated.',
      v_op.number, v_op.state
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT p.sku INTO v_sku FROM public.products p WHERE p.id = v_product;
  IF v_sku IS NULL OR btrim(v_sku) = '' THEN
    RAISE EXCEPTION
      'Product % has no SKU, and the SKU is the first field of a serial number. Set one before generating serials.',
      v_product
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- THE FINANCIAL YEAR COMES FROM THE DOCUMENT, NEVER FROM THE CLOCK.
  -- A receipt opened in 2627 and received in 2628 must still mint 2627
  -- serials; deriving from now() is the obvious wrong thing. The document's
  -- own number already carries the answer (RCP/2627/0001), so it is parsed
  -- back out using that sequence's separator, with the sequence's fy_label as
  -- the fallback when the number does not parse.
  IF v_ot.sequence_id IS NOT NULL THEN
    SELECT * INTO v_seq FROM public.inv_number_sequence WHERE id = v_ot.sequence_id;
  END IF;
  v_docsep := COALESCE(v_seq.separator, '/');
  v_fy := NULLIF(split_part(v_op.number, v_docsep, 2), '');
  IF v_fy IS NULL OR v_fy !~ '^[0-9]{2,6}$' THEN
    v_fy := v_seq.fy_label;
  END IF;
  IF v_fy IS NULL THEN
    RAISE EXCEPTION
      'Cannot determine the financial year for %: its number does not parse and its operation type has no number sequence.',
      v_op.number
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  INSERT INTO public.inv_serial_sequence (product_id, fy_label, current_number)
  VALUES (v_product, v_fy, 0)
  ON CONFLICT (product_id, fy_label) DO NOTHING;

  SELECT padding, separator INTO v_pad, v_ssep
    FROM public.inv_serial_sequence
   WHERE product_id = v_product AND fy_label = v_fy;

  WHILE v_made < p_count LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > p_count + 1000 THEN
      RAISE EXCEPTION
        'Gave up generating serials for % after % attempts: the % % namespace is too densely occupied by existing serials. Investigate before retrying.',
        v_op.number, v_attempts, v_sku, v_fy
        USING ERRCODE = 'check_violation';
    END IF;

    -- Atomic, and inside the caller's transaction: mirrors
    -- inv_allocate_document_number, so a later failure rolls the counter back
    -- together with the inserts.
    UPDATE public.inv_serial_sequence
       SET current_number = current_number + 1,
           updated_at     = now()
     WHERE product_id = v_product AND fy_label = v_fy
    RETURNING current_number INTO v_num;

    v_candidate := v_sku || v_ssep || v_fy || v_ssep || lpad(v_num::text, v_pad, '0');

    -- THE NAMESPACE IS ALREADY DIRTY, AND THIS IS NOT HYPOTHETICAL.
    -- 13 of the 25 live serials were hand-typed and follow no convention
    -- (1234, 123596, SUPPLIER-ALT-99, PASS6-PREVIEW-0001...). A counter-only
    -- generator would eventually mint a string that already exists and hand out
    -- a number inv_receive_serial is guaranteed to refuse later. Decision 3
    -- makes this permanent rather than a legacy artefact: vendor serials arrive
    -- in the same namespace forever. The clashing number is BURNED, not reused
    -- — see the never-recycle rule on the table comment.
    IF EXISTS (SELECT 1 FROM public.inv_stock_item si WHERE si.serial = v_candidate)
       OR EXISTS (SELECT 1 FROM public.inv_pending_serial ps WHERE ps.serial = v_candidate) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.inv_pending_serial (move_id, serial, generated_by)
    VALUES (p_move_id, v_candidate, auth.uid())
    RETURNING id INTO v_id;

    v_made := v_made + 1;
    pending_id    := v_id;
    serial_number := v_candidate;
    RETURN NEXT;
  END LOOP;

  RETURN;
END $fn$;

COMMENT ON FUNCTION public.inv_generate_serials(uuid,integer) IS
  'Generate N pending serials for a receipt line as {sku}{sep}{fy}{sep}{nnnn}. '
  'The counter is per (product, FY) and continues across receipts. Skips any '
  'number already taken by a hand-typed or vendor serial; never recycles.';

-- ===================== 5. voiding, and the auto-close =====================
-- DECISION 2: void is for GENUINE CANCELLATION only — the receipt was
-- cancelled, the goods never came. A misprint is reprinted under the same
-- number and never reaches this function.
CREATE FUNCTION public.inv_void_pending_serials(p_pending_ids uuid[], p_reason text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_consumed text[];
  v_n        integer;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to void serial numbers.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION
      'A reason is required to void a generated serial. A number retired without one is indistinguishable from a number that was lost.'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  SELECT array_agg(ps.serial ORDER BY ps.serial) INTO v_consumed
    FROM public.inv_pending_serial ps
   WHERE ps.id = ANY (p_pending_ids) AND ps.consumed_at IS NOT NULL;

  IF v_consumed IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot void %: already received into stock. A number that names a real unit is not a label that can be retired.',
      array_to_string(v_consumed, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotent: an already-voided row is skipped rather than erroring. Voiding
  -- twice is the same request twice, and the first reason is the true one.
  UPDATE public.inv_pending_serial
     SET voided_at   = now(),
         voided_by   = auth.uid(),
         void_reason = btrim(p_reason)
   WHERE id = ANY (p_pending_ids)
     AND voided_at   IS NULL
     AND consumed_at IS NULL;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;

COMMENT ON FUNCTION public.inv_void_pending_serials(uuid[],text) IS
  'Retire generated serials that will never be received. For CANCELLATION, not '
  'for misprints - a misprint is reprinted under the same number. Idempotent; '
  'refuses a number already received.';

-- DECISION 2 NEEDS A WRITER, OR print_count IS THE NEXT products.track_serials
-- — a column nobody sets, which CLAUDE.md already records as a flag that got
-- worked around rather than fixed. Reprinting is the SANCTIONED response to a
-- misprint, so it must be recorded rather than merely permitted.
CREATE FUNCTION public.inv_record_serial_print(p_pending_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_voided text[];
  v_n      integer;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to print serial labels.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT array_agg(ps.serial ORDER BY ps.serial) INTO v_voided
    FROM public.inv_pending_serial ps
   WHERE ps.id = ANY (p_pending_ids) AND ps.voided_at IS NOT NULL;

  IF v_voided IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot print %: voided. A voided number is never reissued, so printing a fresh label for one would put a serial into the warehouse that nothing can receive.',
      array_to_string(v_voided, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  -- A CONSUMED serial may be reprinted: the unit is real and its label can
  -- still fall off. Only voided numbers are refused.
  UPDATE public.inv_pending_serial
     SET print_count      = print_count + 1,
         first_printed_at = COALESCE(first_printed_at, now()),
         last_printed_at  = now()
   WHERE id = ANY (p_pending_ids)
     AND voided_at IS NULL;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;

COMMENT ON FUNCTION public.inv_record_serial_print(uuid[]) IS
  'Record that labels were printed. A misprint is REPRINTED under the same '
  'number (V, 2026-08-22), so this counts rather than retires. Refuses a '
  'voided number; permits reprinting a consumed one.';

-- A TRIGGER, NOT AN EDIT TO inv_complete_operation.
-- Closing happens through two paths: inv_complete_operation (done) and
-- inv_apply_operation_state (cancelled — there is no inv_cancel_operation).
-- One AFTER UPDATE OF state trigger covers both and edits NEITHER live RPC,
-- which keeps this migration's only function replacement the one that is
-- genuinely unavoidable.
CREATE FUNCTION public.inv_tg_void_pending_serials_on_close()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_reason text;
BEGIN
  -- DECISION 3 makes this the NORMAL case, not an error path. A line that
  -- arrived under vendor serials leaves every generated label unused, so the
  -- wording must not read like a failure or a count of missing goods.
  v_reason := CASE NEW.state
    WHEN 'cancelled'::public.inv_operation_state
      THEN format('%s was cancelled; these labels were never used.', NEW.number)
    ELSE
      format('%s was completed; these labels were not used (the units may have arrived under vendor serials).', NEW.number)
  END;

  UPDATE public.inv_pending_serial ps
     SET voided_at   = now(),
         voided_by   = auth.uid(),
         void_reason = v_reason
    FROM public.inv_move m
   WHERE m.id = ps.move_id
     AND m.operation_id = NEW.id
     AND ps.consumed_at IS NULL
     AND ps.voided_at   IS NULL;

  RETURN NULL;
END $fn$;

CREATE TRIGGER inv_operation_void_pending_serials
  AFTER UPDATE OF state ON public.inv_operation
  FOR EACH ROW
  WHEN (NEW.state IN ('done'::public.inv_operation_state,
                      'cancelled'::public.inv_operation_state)
        AND OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION public.inv_tg_void_pending_serials_on_close();

-- ================ 6. inv_receive_serial — ADDITIVE ONLY ===================
-- THE LARGEST RISK IN THIS MIGRATION, and the shape below exists to make it as
-- small as it can be.
--
-- THE FOUR EXISTING BRANCHES ARE BYTE-IDENTICAL, INCLUDING THEIR MESSAGES:
--   B1  serial exists, different origin operation      -> refuse
--   B2  serial exists, same operation, already on move -> clean re-run
--   B3  serial exists, same operation, not on move     -> resume the transfer
--   B4  serial does not exist                          -> create + transfer
--
-- The new code is ONE block inserted strictly BETWEEN the idempotency block and
-- the create, plus one UPDATE after the transfer. That placement is safe by
-- construction: every path through the idempotency block either RETURNs or
-- RAISEs, so the new block is reachable only when the serial is new — exactly
-- B4's territory, which is where the vendor/pending question lives.
--
-- B1's message is deliberately NOT improved to name the offending document,
-- even though it easily could be. Rule 3: do not bundle a readability change
-- with a behaviour change on the riskiest function in the module.
--
-- WHAT B4 SPLITS INTO. Before this migration "unknown serial" meant one thing:
-- create it. Decision 3 splits it in two, and only the pending table can tell
-- them apart:
--   * no pending row anywhere    -> A VENDOR SERIAL. Accept, exactly as B4
--                                   always did. Normal, not an error.
--   * pending row on another doc -> refuse. Without this, a label printed for
--                                   receipt A and scanned onto receipt B would
--                                   silently create the unit and burn the
--                                   number, and receipt A would later refuse
--                                   its OWN label through B1 — blaming the
--                                   wrong document for the wrong reason.
CREATE OR REPLACE FUNCTION public.inv_receive_serial(
  p_move_id uuid,
  p_serial text,
  p_cost numeric DEFAULT 0,
  p_status inv_stock_status DEFAULT 'quarantined'::inv_stock_status,
  p_batch_code text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op        public.inv_operation%ROWTYPE;
  v_kind      public.inv_operation_kind;
  v_product   uuid;
  v_existing  public.inv_stock_item%ROWTYPE;
  v_item_id   uuid;
  v_serial    text := trim(p_serial);
  v_pending   public.inv_pending_serial%ROWTYPE;
  v_p_op      uuid;
  v_p_opnum   text;
  v_p_product text;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to receive inventory.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_serial IS NULL OR v_serial = '' THEN
    RAISE EXCEPTION 'A serial number is required to receive a unit.'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Two lookups, not one. plpgsql will not accept a scalar and a %ROWTYPE in
  -- the same INTO list ("v_op is not a scalar variable"); a row variable must
  -- be the sole target. Both are primary-key lookups, so the cost is nil.
  SELECT o.* INTO v_op
    FROM public.inv_move m
    JOIN public.inv_operation o ON o.id = m.operation_id
   WHERE m.id = p_move_id;

  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Move % not found.', p_move_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT m.product_id INTO v_product
    FROM public.inv_move m WHERE m.id = p_move_id;

  SELECT ot.kind INTO v_kind
    FROM public.inv_operation_type ot WHERE ot.id = v_op.operation_type_id;

  IF v_kind <> 'receipt'::public.inv_operation_kind THEN
    RAISE EXCEPTION
      'Operation % is a % operation, not a receipt. Units are received only on receipts.',
      v_op.number, v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_op.state IN ('done','cancelled') THEN
    RAISE EXCEPTION
      'Receipt % is already % and cannot take further units.', v_op.number, v_op.state
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_op.source_location_id IS NULL OR v_op.dest_location_id IS NULL THEN
    RAISE EXCEPTION
      'Receipt % needs both a source and a destination location before units can be received.',
      v_op.number
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  ------------------------------------------------------------ idempotency
  SELECT * INTO v_existing FROM public.inv_stock_item WHERE serial = v_serial;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.origin_operation_id IS DISTINCT FROM v_op.id THEN
      RAISE EXCEPTION
        'Serial % already exists and was received on a different document. Serials are globally unique.',
        v_serial
        USING ERRCODE = 'unique_violation';
    END IF;

    IF EXISTS (SELECT 1 FROM public.inv_move_line
                WHERE move_id = p_move_id AND stock_item_id = v_existing.id) THEN
      RETURN v_existing.id;                            -- clean re-run
    END IF;

    -- Unit exists but was never transferred (an interrupted earlier run).
    -- Finish the job rather than leaving it stranded at the supplier.
    PERFORM public.inv_transfer_stock_item(
      v_existing.id, p_move_id, v_existing.location_id, v_op.dest_location_id,
      'inv_operation', v_op.id, 'receipt',
      jsonb_build_object('resumed', true));
    RETURN v_existing.id;
  END IF;

  ------------------------------------------------ pending / vendor (NEW)
  -- Reachable only when the serial is new: every branch above returns or raises.
  SELECT * INTO v_pending FROM public.inv_pending_serial WHERE serial = v_serial;

  IF v_pending.id IS NOT NULL THEN
    SELECT m.operation_id, o.number, p.name
      INTO v_p_op, v_p_opnum, v_p_product
      FROM public.inv_move m
      JOIN public.inv_operation o ON o.id = m.operation_id
      JOIN public.products p      ON p.id = m.product_id
     WHERE m.id = v_pending.move_id;

    IF v_pending.voided_at IS NOT NULL THEN
      RAISE EXCEPTION
        'Serial % was voided on % and must not be used. Reason recorded: %. A voided number is never reissued - receive this unit under a new label, or under the vendor''s own serial.',
        v_serial, to_char(v_pending.voided_at, 'YYYY-MM-DD'),
        COALESCE(v_pending.void_reason, '(none recorded)')
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_pending.consumed_at IS NOT NULL THEN
      -- The pending row says this number was received, but no stock item bears
      -- it. Only an admin DELETE on inv_stock_item can produce that. Refuse
      -- loudly rather than silently minting a second unit under one number.
      RAISE EXCEPTION
        'Serial % is recorded as received on %, but its stock item no longer exists. This is a data inconsistency; do not re-receive it until it has been investigated.',
        v_serial, COALESCE(v_p_opnum, '(unknown document)')
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_p_op IS DISTINCT FROM v_op.id THEN
      RAISE EXCEPTION
        'Serial % was generated for % and has not been received yet, so it cannot be received on % - the label belongs to another document. Scan it on %, or void it there first.',
        v_serial, v_p_opnum, v_op.number, v_p_opnum
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_pending.move_id IS DISTINCT FROM p_move_id THEN
      RAISE EXCEPTION
        'Serial % was generated on % for %, which is a different line of this receipt. Scan it against its own line.',
        v_serial, v_op.number, COALESCE(v_p_product, '(unknown product)')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- v_pending.id IS NULL falls through: a VENDOR SERIAL, received exactly as an
  -- unknown serial always has been. Decision 3 — normal, not an error.

  --------------------------------------------------------------- create
  INSERT INTO public.inv_stock_item (
    product_id, serial, location_id, status,
    origin_operation_id, batch_code, cost, received_at
  ) VALUES (
    v_product, v_serial, v_op.source_location_id, p_status,
    v_op.id, p_batch_code, COALESCE(p_cost, 0), now()
  ) RETURNING id INTO v_item_id;

  --------------------------------------------------------------- move it
  PERFORM public.inv_transfer_stock_item(
    v_item_id, p_move_id, v_op.source_location_id, v_op.dest_location_id,
    'inv_operation', v_op.id, 'receipt',
    jsonb_build_object('cost', COALESCE(p_cost, 0), 'status', p_status));

  ------------------------------------------------------ consume it (NEW)
  IF v_pending.id IS NOT NULL THEN
    UPDATE public.inv_pending_serial
       SET consumed_at = now(), stock_item_id = v_item_id
     WHERE id = v_pending.id;
  END IF;

  RETURN v_item_id;
END $function$;

-- ============================== 7. grants =================================
REVOKE ALL ON FUNCTION public.inv_generate_serials(uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inv_void_pending_serials(uuid[],text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inv_record_serial_print(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inv_generate_serials(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_void_pending_serials(uuid[],text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_record_serial_print(uuid[]) TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.inv_serial_sequence TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.inv_pending_serial  TO authenticated;

COMMIT;
