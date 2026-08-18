-- ============================================================================
-- ROUTE ENFORCEMENT — the document's route becomes a RULE, not a label
--
-- THE DEFECT. inv_transfer_stock_item asserted the unit's location against a
-- value derived from that same location, so the assertion could never fail for
-- a routing reason. NOTHING anywhere -- no RPC, trigger, constraint, adapter or
-- screen -- compared a scanned unit's location to inv_operation.source_location_id.
-- DEL/2627/0001 declares DELIVERY ORDER -> CUSTOMERS and shipped two units
-- straight out of GODOWN, while the two units a transfer had staged into
-- DELIVERY ORDER sat there untouched. 2 of 29 ledger rows diverged.
--
-- WHY HERE. inv_transfer_stock_item is the ONLY function in the module that
-- updates inv_stock_item.location_id or writes inv_stock_tracking. Every path --
-- receipt create, receipt resume, transfer, delivery, future adjustment --
-- funnels through it, so one check covers all of them and none can be forgotten.
--
-- Blast radius: 1 new view, 3 new functions, 1 function replaced.
--   - no schema change, no policy, no trigger, no constraint
--   - no existing row is written or revalidated
-- ============================================================================

BEGIN;

-- ============================ 1. the hierarchy ============================
-- Modelled line-for-line on product_category_ancestors, INCLUDING its seen[]
-- cycle guard: inv_location.parent_id has NO cycle constraint, so an unguarded
-- recursion would hang the server rather than return a wrong answer.
--
-- Includes self at distance 0, so "reaches" needs no special case for "the
-- unit is exactly at the document's source".
--
-- This is not hypothetical geometry: GODOWN's parent is STOCK, live, with 23
-- units in the child. A plain equality check would refuse every one of them on
-- a document sourced at STOCK.
CREATE VIEW public.inv_location_ancestors AS
WITH RECURSIVE walk AS (
  SELECT l.id AS location_id, l.id AS ancestor_id, 0 AS distance, ARRAY[l.id] AS seen
    FROM public.inv_location l
  UNION
  SELECT w.location_id, parent.parent_id, w.distance + 1, w.seen || parent.parent_id
    FROM walk w
    JOIN public.inv_location parent ON parent.id = w.ancestor_id
   WHERE parent.parent_id IS NOT NULL
     AND NOT (parent.parent_id = ANY (w.seen))
)
SELECT w.location_id, w.ancestor_id, w.distance, a.name AS ancestor_name
  FROM walk w JOIN public.inv_location a ON a.id = w.ancestor_id;

COMMENT ON VIEW public.inv_location_ancestors IS
  'Every location paired with itself (distance 0) and each of its ancestors. '
  'The single definition of location containment. GODOWN is a child of STOCK, '
  'so a document sourced at STOCK must accept units sitting in GODOWN.';

-- ======================= 2. "or a descendant of it" =======================
-- One named definition. Four call sites need this test; inlining EXISTS four
-- times is how one of them ends up written differently.
CREATE FUNCTION public.inv_location_reaches(p_candidate uuid, p_anchor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.inv_location_ancestors a
     WHERE a.location_id = p_candidate AND a.ancestor_id = p_anchor);
$$;

COMMENT ON FUNCTION public.inv_location_reaches(uuid,uuid) IS
  'True when p_candidate IS p_anchor or sits underneath it. Directional: a unit '
  'in a child is reachable from the parent, never the reverse.';

-- ========================= 3. THE AUTHORITY ==============================
CREATE FUNCTION public.inv_route_is_legal(p_operation_id uuid, p_from uuid, p_to uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN ot.kind = 'adjustment'::public.inv_operation_kind THEN
      -- BIDIRECTIONAL ALONG ITS DECLARED AXIS, and this is a rule rather than
      -- an exemption. inv_tg_adjustment_counterparty already forces exactly one
      -- virtual side (inventory_loss/scrap/production) and one internal side,
      -- so the document declares an AXIS and only the direction varies: a
      -- write-off runs internal->virtual, a found-stock correction runs
      -- virtual->internal. STOCK ADJUSTMENT is configured INVENTORY LOSS ->
      -- STOCK and a write-off runs the other way; a one-directional rule would
      -- have broken adjustments the day they were built.
      --
      -- A PAIR CHECK, NOT TWO INDEPENDENT MEMBERSHIP TESTS. Testing "from is in
      -- the allowed set AND to is in the allowed set" separately would also
      -- admit internal->internal and virtual->virtual, neither of which is an
      -- adjustment. The two ends must be OPPOSITE ends of the same axis.
         (public.inv_location_reaches(p_from, o.source_location_id)
          AND public.inv_location_reaches(p_to,   o.dest_location_id))
      OR (public.inv_location_reaches(p_from, o.dest_location_id)
          AND public.inv_location_reaches(p_to,   o.source_location_id))
    ELSE
      -- ONE-DIRECTIONAL. Reversing a receipt is a return-to-vendor and
      -- reversing a delivery is a customer return: separate document types, per
      -- CLAUDE.md. Movement is controlled by WHICH DOCUMENT is used, not by who
      -- is clicking, and not by letting one document run backwards.
         public.inv_location_reaches(p_from, o.source_location_id)
     AND public.inv_location_reaches(p_to,   o.dest_location_id)
  END
  FROM public.inv_operation o
  JOIN public.inv_operation_type ot ON ot.id = o.operation_type_id
 WHERE o.id = p_operation_id;
$$;

COMMENT ON FUNCTION public.inv_route_is_legal(uuid,uuid,uuid) IS
  'THE AUTHORITY on whether a movement is permitted by its document. '
  'receipt/internal/outgoing: source -> destination, one way. adjustment: '
  'either way along its own declared axis, as a pair check.';

-- ==================== 4. messaging superset for the screen ===============
-- A SUPERSET of what inv_route_is_legal permits, deliberately.
--
-- The screen needs a SET to test one unit against before any round trip; the
-- authority above is a PAIR check and cannot answer that question. For an
-- adjustment this returns descendants(source) UNION descendants(dest), which is
-- strictly more than the pair check allows.
--
-- The asymmetry is safe in exactly one direction. TOO GENEROUS is safe: the
-- server still refuses, and the operator gets a late message instead of an
-- early one. TOO NARROW would refuse a lawful unit at the bay with no way past
-- it. So this may be widened but MUST NEVER BE NARROWED, and it is never the
-- thing that decides whether a movement happens.
CREATE FUNCTION public.inv_document_allowed_from(p_operation_id uuid)
RETURNS TABLE (location_id uuid) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT a.location_id
    FROM public.inv_operation o
    JOIN public.inv_operation_type ot ON ot.id = o.operation_type_id
    JOIN public.inv_location_ancestors a
      ON a.ancestor_id = o.source_location_id
       OR (ot.kind = 'adjustment'::public.inv_operation_kind
           AND a.ancestor_id = o.dest_location_id)
   WHERE o.id = p_operation_id;
$$;

COMMENT ON FUNCTION public.inv_document_allowed_from(uuid) IS
  'Locations a unit may be scanned FROM, for the scan screen early refusal. '
  'A deliberate SUPERSET of inv_route_is_legal -- may be widened, never narrowed. '
  'The authority is inv_route_is_legal; this only decides message timing.';

-- ===================== 5. the check, at the choke point ==================
CREATE OR REPLACE FUNCTION public.inv_transfer_stock_item(
  p_stock_item_id uuid,
  p_move_id uuid,
  p_expected_from_location_id uuid,
  p_to_location_id uuid,
  p_document_type text,
  p_document_id uuid,
  p_entry_type text DEFAULT 'transfer'::text,
  p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_item          public.inv_stock_item%ROWTYPE;
  v_move_product  uuid;
  v_dest_active   boolean;
  v_dest_exists   boolean;
  v_move_line_id  uuid;
  v_operation_id  uuid;
  v_op_number     text;
  v_kind          public.inv_operation_kind;
  v_src_name      text;
  v_dst_name      text;
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

  -- ================= ACCURACY, AND IT RUNS FIRST ==========================
  -- Unchanged, and deliberately ahead of the legality check below.
  --
  -- This is what makes the ledger's from_location_id TRUE: the recorded origin
  -- is proven to be where the unit actually was at commit time. It catches
  -- time-of-check/time-of-use races (the scan resolved location X, something
  -- moved the unit before commit) and stale closures.
  --
  -- ORDER MATTERS. If a unit moved between resolve and commit, the operator
  -- must be told "it is in X, you expected Y" -- precise and actionable -- not
  -- a route error that misdescribes the cause. Legality is only a meaningful
  -- question once the recorded origin is known to be true.
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

  -- ================= LEGALITY (added 2026-08-18) ==========================
  -- THE OPERATION IS DERIVED FROM p_move_id, NEVER FROM p_document_id.
  -- The move id is already trusted -- its product was asserted immediately
  -- above, so a bogus move id has already failed. p_document_id is the caller's
  -- unverified word, which is precisely the hole being closed.
  SELECT m.operation_id INTO v_operation_id
    FROM public.inv_move m WHERE m.id = p_move_id;

  SELECT o.number, ot.kind, sl.name, dl.name
    INTO v_op_number, v_kind, v_src_name, v_dst_name
    FROM public.inv_operation o
    JOIN public.inv_operation_type ot ON ot.id = o.operation_type_id
    LEFT JOIN public.inv_location sl ON sl.id = o.source_location_id
    LEFT JOIN public.inv_location dl ON dl.id = o.dest_location_id
   WHERE o.id = v_operation_id;

  IF NOT public.inv_route_is_legal(
           v_operation_id, p_expected_from_location_id, p_to_location_id) THEN
    RAISE EXCEPTION
      'Route not permitted on % (%): this document moves stock % -> %, but unit % would move % -> %. %',
      v_op_number, v_kind, COALESCE(v_src_name,'(none)'), COALESCE(v_dst_name,'(none)'),
      v_item.serial,
      COALESCE((SELECT name FROM public.inv_location WHERE id = p_expected_from_location_id),'(unknown)'),
      COALESCE((SELECT name FROM public.inv_location WHERE id = p_to_location_id),'(unknown)'),
      CASE WHEN v_kind = 'adjustment'::public.inv_operation_kind
           THEN 'An adjustment may run either way along its own axis, but not between other locations.'
           ELSE 'Move the unit onto this document''s source first, or use a document type whose route matches.'
      END
      USING ERRCODE = 'check_violation';
  END IF;

  -- The ledger's citation of the document is no longer the caller's word.
  IF p_document_type = 'inv_operation'
     AND p_document_id IS DISTINCT FROM v_operation_id THEN
    RAISE EXCEPTION
      'Ledger citation mismatch: move % belongs to operation %, but the caller cited document %. Refusing to write a ledger row that names the wrong document.',
      p_move_id, v_operation_id, p_document_id
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
END
$fn$;

REVOKE ALL ON FUNCTION public.inv_location_reaches(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inv_route_is_legal(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inv_document_allowed_from(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inv_location_reaches(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_route_is_legal(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_document_allowed_from(uuid) TO authenticated;
GRANT SELECT ON public.inv_location_ancestors TO authenticated;

COMMIT;
