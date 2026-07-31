-- Auto-fill a Goods Receipt's source/destination from its operation type.
-- Section 4 / design step 3a of docs/GR_CREATION_DESIGN.md.
--
-- WHY A TRIGGER RATHER THAN THE SERVICE: goods_receipts has two insert callers
-- today (the New GR wizard via createGoodsReceipt, and the vendor-order path at
-- vendor-orders/index.ts:238), both funnelling through the single insert at
-- src/lib/services/inventory/goodsReceipt.ts:126. Filling the locations here
-- means every caller — including any future one — gets correct routing without
-- repeating the logic, and it cannot be forgotten at a new call site.
--
-- operation_type_id itself is NOT set here. A trigger cannot invent it, and
-- trg_gr_set_number needs it already on NEW to number the receipt. It arrives in
-- the INSERT payload from the frontend; this trigger only derives locations from
-- whatever operation type the row carries.
--
-- OVERRIDE SEMANTICS: COALESCE(NEW.x, ot.default_x). An explicitly supplied
-- value always wins, so when the super-admin destination override arrives with
-- the roles work it needs no change here — it just passes a value. NULL means
-- "derive it".
--
-- BEFORE INSERT ONLY, never BEFORE UPDATE. An update that clears a location must
-- stay cleared rather than silently re-deriving from the operation type. This
-- also means the defaults are captured at creation: editing an operation type's
-- defaults later does NOT retroactively move an existing receipt, which is the
-- accounting-correct behaviour and the reason the completion RPCs will read the
-- document rather than the operation type.
--
-- TRIGGER FIRING ORDER: PostgreSQL fires BEFORE INSERT triggers in alphabetical
-- order by name. goods_receipts will then have:
--     trg_gr_fill_default_locations   (this one)
--     trg_gr_set_number               (numbering)
-- so locations are filled first. The two touch disjoint columns, so the order is
-- immaterial today — but it is now deliberate rather than accidental, and the
-- name was chosen to keep it that way.
--
-- CURRENT EFFECT: GOODS RECEIVED is configured VDR106 (VENDORS) -> STK103
-- (STOCK), so a receipt tagged with it gets those two locations. A receipt with
-- operation_type_id NULL — every receipt created before the frontend change — is
-- left entirely alone, both columns staying NULL, and the completion RPCs
-- continue to use their existing fallback logic.
--
-- NOT YET CONSUMED: complete_gr_line_qc and record_gr_item_qc do not read
-- dest_location_id yet (design steps 8-9). After this migration the destination
-- is stored and displayable but does not yet route stock.
--
-- ---------------------------------------------------------------------------
-- REVERSE / ROLLBACK
--
--   DROP TRIGGER IF EXISTS trg_gr_fill_default_locations ON public.goods_receipts;
--   DROP FUNCTION IF EXISTS public.gr_fill_default_locations();
--
-- Receipts already created keep the locations they were given; nothing reads
-- them yet, so removing the trigger simply stops new ones being filled.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.gr_fill_default_locations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_src uuid;
  v_dst uuid;
BEGIN
  -- Nothing to derive from.
  IF NEW.operation_type_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Both already supplied by the caller: nothing to do.
  IF NEW.source_location_id IS NOT NULL AND NEW.dest_location_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT default_source_location_id, default_dest_location_id
    INTO v_src, v_dst
    FROM public.operation_types
   WHERE id = NEW.operation_type_id;

  -- Operation type not found (FK is ON DELETE SET NULL, so this is possible in
  -- a race): leave the row exactly as supplied rather than guessing.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Caller-supplied values win; NULL means derive from the operation type.
  NEW.source_location_id := COALESCE(NEW.source_location_id, v_src);
  NEW.dest_location_id   := COALESCE(NEW.dest_location_id,   v_dst);

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.gr_fill_default_locations() IS
  'BEFORE INSERT on goods_receipts: derives source_location_id / dest_location_id from the row''s operation type when the caller left them NULL. COALESCE means an explicit value always wins, which is the per-document override mechanism.';

DROP TRIGGER IF EXISTS trg_gr_fill_default_locations ON public.goods_receipts;

CREATE TRIGGER trg_gr_fill_default_locations
  BEFORE INSERT ON public.goods_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.gr_fill_default_locations();

COMMIT;

-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFICATION (read-only)
--
--   -- trigger present, and firing order is fill-then-number
--   SELECT tgname, pg_get_triggerdef(t.oid)
--     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname='public' AND c.relname='goods_receipts' AND NOT t.tgisinternal
--    ORDER BY tgname;
--   -- expect trg_gr_fill_default_locations to sort before trg_gr_set_number
--
--   -- existing receipts untouched: this is BEFORE INSERT only
--   SELECT count(*) AS grs,
--          count(source_location_id) AS with_src,
--          count(dest_location_id)   AS with_dst
--     FROM public.goods_receipts;
--   -- expect 10 / 0 / 0 — no existing row is rewritten
--
--   -- what a newly tagged receipt will inherit
--   SELECT ot.name, src.code AS source, dst.code AS dest
--     FROM public.operation_types ot
--     LEFT JOIN public.warehouse_locations src ON src.id = ot.default_source_location_id
--     LEFT JOIN public.warehouse_locations dst ON dst.id = ot.default_dest_location_id
--    WHERE ot.name = 'GOODS RECEIVED';
--   -- expect VDR106 -> STK103
--
--   -- after creating a real receipt through the wizard:
--   SELECT gr_number, operation_type_id IS NOT NULL AS tagged,
--          src.code AS source, dst.code AS dest
--     FROM public.goods_receipts gr
--     LEFT JOIN public.warehouse_locations src ON src.id = gr.source_location_id
--     LEFT JOIN public.warehouse_locations dst ON dst.id = gr.dest_location_id
--    ORDER BY gr.created_at DESC LIMIT 1;
--   -- expect tagged = true, source = VDR106, dest = STK103
-- ---------------------------------------------------------------------------
