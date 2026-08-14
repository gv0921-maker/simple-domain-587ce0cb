-- =====================================================================
-- INTERNAL TRANSFERS — Pass B, commits 2 and 3
--
-- Generalise the create and complete RPCs over inv_operation_kind so a
-- transfer is not a second near-identical copy of the receipt path.
--
-- SCOPE: functions only. NO table, column, constraint, trigger, policy,
-- index, view, enum or grant is touched. Two functions are ADDED; the two
-- receipt functions are REWRITTEN AS THIN WRAPPERS and keep their exact
-- signatures, their kind guard and its wording (Rule 4 — neither is
-- dropped, and every existing caller keeps working unchanged).
--
-- Expected fingerprint effect: pg_proc 211 -> 213. Constraints, triggers,
-- policies, views and schema unchanged.
-- =====================================================================

-- ------------------------------------------------------------- CREATE ---

CREATE OR REPLACE FUNCTION public.inv_create_operation(
  p_operation_type_id   uuid,
  p_source_location_id  uuid                     DEFAULT NULL::uuid,
  p_dest_location_id    uuid                     DEFAULT NULL::uuid,
  p_partner_vendor_id   uuid                     DEFAULT NULL::uuid,
  p_partner_customer_id uuid                     DEFAULT NULL::uuid,
  p_purchase_order_id   uuid                     DEFAULT NULL::uuid,
  p_source_document     text                     DEFAULT NULL::text,
  p_scheduled_at        timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_notes               text                     DEFAULT NULL::text,
  p_fy_label            text                     DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ot          public.inv_operation_type%ROWTYPE;
  v_seq         public.inv_number_sequence%ROWTYPE;
  v_doc         text;
  v_fy          text;
  v_source      uuid;
  v_dest        uuid;
  v_src_locked  boolean := false;
  v_dst_locked  boolean := false;
  v_src_ignored boolean := false;
  v_dst_ignored boolean := false;
  v_number      text;
  v_id          uuid;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to create an inventory operation.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_ot FROM public.inv_operation_type WHERE id = p_operation_type_id;
  IF v_ot.id IS NULL THEN
    RAISE EXCEPTION 'Operation type % not found.', p_operation_type_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT v_ot.is_active THEN
    RAISE EXCEPTION 'Operation type % is not active.', v_ot.name
      USING ERRCODE = 'check_violation';
  END IF;

  -- Numbering. The type points at its sequence, and the sequence knows both
  -- its document type and its financial year, so the UI invents neither.
  --
  -- The fallback is the KIND, not a hardcoded 'receipt': every kind already
  -- has a sequence whose document_type is its own name (receipt/internal/
  -- outgoing/adjustment), so a type with no sequence still resolves sanely
  -- instead of silently drawing a receipt number.
  IF v_ot.sequence_id IS NOT NULL THEN
    SELECT * INTO v_seq FROM public.inv_number_sequence WHERE id = v_ot.sequence_id;
  END IF;

  v_doc := COALESCE(v_seq.document_type, v_ot.kind::text);
  v_fy  := COALESCE(p_fy_label, v_seq.fy_label);

  IF v_fy IS NULL THEN
    RAISE EXCEPTION
      'Cannot determine the financial year for %: the type has no number sequence and no fy_label was supplied.',
      v_ot.name
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- LOCATIONS.
  --
  -- locks_source is now honoured symmetrically with locks_destination. It has
  -- existed on inv_operation_type since Step 2 and been read by nothing;
  -- transfers are its first consumer. A "Showroom -> Packing" type fixes BOTH
  -- ends, so a caller cannot quietly draw stock out of somewhere else.
  --
  -- A locked end IGNORES the client value rather than rejecting it, and says
  -- so in the result, exactly as locks_destination already did for receipts.
  IF v_ot.locks_source THEN
    v_source      := v_ot.default_source_location_id;
    v_src_locked  := true;
    v_src_ignored := p_source_location_id IS NOT NULL
                 AND p_source_location_id IS DISTINCT FROM v_source;

    IF v_source IS NULL THEN
      RAISE EXCEPTION
        'Operation type % locks its source but has no default source location configured.',
        v_ot.name
        USING ERRCODE = 'null_value_not_allowed';
    END IF;
  ELSE
    v_source := COALESCE(p_source_location_id, v_ot.default_source_location_id);
  END IF;

  IF v_ot.locks_destination THEN
    v_dest        := v_ot.default_dest_location_id;
    v_dst_locked  := true;
    v_dst_ignored := p_dest_location_id IS NOT NULL
                 AND p_dest_location_id IS DISTINCT FROM v_dest;

    IF v_dest IS NULL THEN
      RAISE EXCEPTION
        'Operation type % locks its destination but has no default destination configured.',
        v_ot.name
        USING ERRCODE = 'null_value_not_allowed';
    END IF;
  ELSE
    v_dest := COALESCE(p_dest_location_id, v_ot.default_dest_location_id);
  END IF;

  IF v_source IS NULL OR v_dest IS NULL THEN
    RAISE EXCEPTION
      'A % operation needs both a source and a destination location. Configure them on operation type % or pass them in.',
      v_ot.kind, v_ot.name
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- NEW GUARD. No existing type is configured this way (all four have
  -- distinct defaults), so nothing live changes behaviour. It matters for
  -- transfers, where a mis-configured route would otherwise produce a
  -- document whose units move from a location to itself — which
  -- inv_transfer_stock_item would happily record as a real move.
  IF v_source = v_dest THEN
    RAISE EXCEPTION
      'Operation type % resolves to the same source and destination location (%). A move that goes nowhere is not a document.',
      v_ot.name, v_source
      USING ERRCODE = 'check_violation';
  END IF;

  -- PARTNERS. inv_operation_single_partner already forbids both being set;
  -- saying so here names the caller's mistake instead of surfacing a raw
  -- constraint violation.
  IF p_partner_vendor_id IS NOT NULL AND p_partner_customer_id IS NOT NULL THEN
    RAISE EXCEPTION
      'An operation may cite a vendor or a customer, not both.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_partner_vendor_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.vendors WHERE id = p_partner_vendor_id) THEN
    RAISE EXCEPTION 'Vendor % not found.', p_partner_vendor_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_partner_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_partner_customer_id) THEN
    RAISE EXCEPTION 'Customer % not found.', p_partner_customer_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- A purchase order is a receipt's upstream document and nothing else's.
  IF p_purchase_order_id IS NOT NULL
     AND v_ot.kind <> 'receipt'::public.inv_operation_kind THEN
    RAISE EXCEPTION
      'Operation type % is a % operation and cannot cite a purchase order. Only a receipt has one.',
      v_ot.name, v_ot.kind
      USING ERRCODE = 'check_violation';
  END IF;

  -- Everything that can fail has failed by now. Allocating last keeps the
  -- window between "number taken" and "row written" as small as possible;
  -- either way both are in this transaction, so a later failure rolls the
  -- counter back with the insert.
  v_number := public.inv_allocate_document_number(v_doc, v_fy);

  INSERT INTO public.inv_operation (
    number, operation_type_id, state,
    source_location_id, dest_location_id,
    partner_vendor_id, partner_customer_id,
    source_purchase_order_id, source_document,
    scheduled_at, created_by, notes
  ) VALUES (
    v_number, v_ot.id, 'draft'::public.inv_operation_state,
    v_source, v_dest,
    p_partner_vendor_id, p_partner_customer_id,
    p_purchase_order_id, p_source_document,
    p_scheduled_at, auth.uid(), p_notes
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id',                         v_id,
    'number',                     v_number,
    'kind',                       v_ot.kind,
    'state',                      'draft',
    'source_location_id',         v_source,
    'dest_location_id',           v_dest,
    'source_locked',              v_src_locked,
    'destination_locked',         v_dst_locked,
    'client_source_ignored',      v_src_ignored,
    'client_destination_ignored', v_dst_ignored);
END $function$;

COMMENT ON FUNCTION public.inv_create_operation(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,text,text) IS
  'Creates an inv_operation of ANY kind. Honours locks_source and locks_destination symmetrically. inv_create_receipt is a thin wrapper over this.';


-- The receipt entry point, kept (Rule 4) with its EXACT original signature,
-- its kind guard and that guard's exact wording, so every existing caller —
-- receiptWrites.createReceipt() among them — is unaffected. It returns the
-- generic result, which is a superset of the old keys.
CREATE OR REPLACE FUNCTION public.inv_create_receipt(
  p_operation_type_id  uuid,
  p_vendor_id          uuid                     DEFAULT NULL::uuid,
  p_purchase_order_id  uuid                     DEFAULT NULL::uuid,
  p_source_document    text                     DEFAULT NULL::text,
  p_scheduled_at       timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_notes              text                     DEFAULT NULL::text,
  p_dest_location_id   uuid                     DEFAULT NULL::uuid,
  p_source_location_id uuid                     DEFAULT NULL::uuid,
  p_fy_label           text                     DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ot public.inv_operation_type%ROWTYPE;
BEGIN
  SELECT * INTO v_ot FROM public.inv_operation_type WHERE id = p_operation_type_id;
  IF v_ot.id IS NULL THEN
    RAISE EXCEPTION 'Operation type % not found.', p_operation_type_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Wording preserved verbatim from the pre-generalisation function.
  IF v_ot.kind <> 'receipt'::public.inv_operation_kind THEN
    RAISE EXCEPTION
      'Operation type % is a % operation. inv_create_receipt creates receipts only.',
      v_ot.name, v_ot.kind
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN public.inv_create_operation(
    p_operation_type_id   => p_operation_type_id,
    p_source_location_id  => p_source_location_id,
    p_dest_location_id    => p_dest_location_id,
    p_partner_vendor_id   => p_vendor_id,
    p_partner_customer_id => NULL,
    p_purchase_order_id   => p_purchase_order_id,
    p_source_document     => p_source_document,
    p_scheduled_at        => p_scheduled_at,
    p_notes               => p_notes,
    p_fy_label            => p_fy_label);
END $function$;

COMMENT ON FUNCTION public.inv_create_receipt(uuid,uuid,uuid,text,timestamptz,text,uuid,uuid,text) IS
  'Receipt-only entry point. Thin wrapper over inv_create_operation, kept for existing callers (Rule 4).';


-- ----------------------------------------------------------- COMPLETE ---

CREATE OR REPLACE FUNCTION public.inv_complete_operation(p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op        public.inv_operation%ROWTYPE;
  v_kind      public.inv_operation_kind;
  v_type_name text;
  v_move      record;
  v_units     integer;
  v_quar      integer;
  v_state     public.inv_operation_state;
  v_po_state  public.inv_order_state;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to complete an inventory operation.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_op FROM public.inv_operation WHERE id = p_operation_id FOR UPDATE;
  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Operation % not found.', p_operation_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT ot.kind, ot.name INTO v_kind, v_type_name
    FROM public.inv_operation_type ot WHERE ot.id = v_op.operation_type_id;

  IF v_op.state = 'cancelled' THEN
    RAISE EXCEPTION '% % is cancelled and cannot be completed.', v_type_name, v_op.number
      USING ERRCODE = 'check_violation';
  END IF;

  -- Generic for every kind: a move that processed at least one unit is done.
  -- A move with no units is left alone rather than forced, so an untouched
  -- line does not silently claim completion.
  FOR v_move IN
    SELECT m.id,
           (SELECT count(*) FROM public.inv_move_line ml WHERE ml.move_id = m.id) AS lines
      FROM public.inv_move m
     WHERE m.operation_id = p_operation_id
       AND m.state NOT IN ('done','cancelled')
  LOOP
    IF v_move.lines > 0 THEN
      PERFORM public.inv_apply_move_state(v_move.id, 'done'::public.inv_move_state);
    END IF;
  END LOOP;

  v_state := public.inv_derive_operation_state(p_operation_id);

  -- THE ONLY PER-KIND SIDE EFFECT IN THE WHOLE COMPLETION PATH, and it is
  -- already self-selecting: only a receipt ever carries a purchase order, so
  -- this needs no kind test. A transfer's upstream document is a SALES order,
  -- which inv_operation does not reference at all — see CLAUDE.md, the
  -- sales-order link is a reference on the document, not its identity.
  IF v_op.source_purchase_order_id IS NOT NULL THEN
    v_po_state := public.inv_sync_purchase_order_progress(v_op.source_purchase_order_id);
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE si.status = 'quarantined')
    INTO v_units, v_quar
    FROM public.inv_move_line ml
    JOIN public.inv_move       m  ON m.id  = ml.move_id
    JOIN public.inv_stock_item si ON si.id = ml.stock_item_id
   WHERE m.operation_id = p_operation_id;

  -- Key names are held stable for the receipt wrapper's existing callers.
  -- 'units_received' counts units PROCESSED on the document, which on a
  -- transfer means units moved.
  RETURN jsonb_build_object(
    'operation',            v_op.number,
    'kind',                 v_kind,
    'operation_state',      v_state,
    'units_received',       v_units,
    'units_awaiting_qc',    v_quar,
    'purchase_order_state', v_po_state);
END $function$;

COMMENT ON FUNCTION public.inv_complete_operation(uuid) IS
  'Completes an inv_operation of ANY kind. The purchase-order sync is self-selecting: only a receipt carries one. inv_complete_receipt is a thin wrapper over this.';


-- The receipt entry point, kept (Rule 4) with its exact signature and its
-- kind guard's exact wording.
CREATE OR REPLACE FUNCTION public.inv_complete_receipt(p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op   public.inv_operation%ROWTYPE;
  v_kind public.inv_operation_kind;
BEGIN
  SELECT * INTO v_op FROM public.inv_operation WHERE id = p_operation_id;
  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Operation % not found.', p_operation_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT ot.kind INTO v_kind
    FROM public.inv_operation_type ot WHERE ot.id = v_op.operation_type_id;

  -- Wording preserved verbatim from the pre-generalisation function.
  IF v_kind <> 'receipt'::public.inv_operation_kind THEN
    RAISE EXCEPTION 'Operation % is a % operation, not a receipt.', v_op.number, v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN public.inv_complete_operation(p_operation_id);
END $function$;

COMMENT ON FUNCTION public.inv_complete_receipt(uuid) IS
  'Receipt-only entry point. Thin wrapper over inv_complete_operation, kept for existing callers (Rule 4).';
