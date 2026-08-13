-- =====================================================================
-- INVENTORY RESET — PASS 10C: inv_create_variant
-- =====================================================================
--
-- FOR REVIEW. Approved by V on 2026-08-13.
--
-- WHY THIS EXISTS
-- A variant is two rows in two tables: the parent in product_variants and one
-- product_variant_values row per attribute. 10B guards that pairing with
-- `product_variants_require_values`, a DEFERRABLE INITIALLY DEFERRED constraint
-- trigger — it fires at TRANSACTION COMMIT, by which time the child rows must
-- exist.
--
-- PostgREST runs every HTTP request in its own transaction. A client doing
-- "insert parent, then insert values" therefore commits the parent alone, the
-- deferred trigger fires against a variant with no values, and the insert is
-- refused. Correctly refused — the guard is doing exactly its job. The mistake
-- was mine: 10B's smoke suite inserted parent and children inside a single
-- DO block, which is one transaction, so it proved the constraint works under
-- SQL and never proved a two-call client write could satisfy it. It cannot.
--
-- This RPC puts both inserts in one transaction, which is what the guard always
-- required and what every other Inventory 2 write already does
-- (inv_create_receipt, inv_receive_serial, inv_record_qc_results).
--
-- WHAT THIS MIGRATION CHANGES
-- One new function. NOTHING ELSE. No table, column, constraint, index, policy
-- or trigger is created, altered or dropped. product_variants_require_values
-- stays exactly as it is — this satisfies it rather than working around it.
--
-- PERMISSIONS
-- SECURITY DEFINER with an explicit check, mirroring the RLS split 10B already
-- established: product_variants_insert_write admits sales_rep, _update_inv does
-- not. So a salesperson may bring a version into existence when a customer asks
-- for one, and still cannot reprice, rename or archive it. This function only
-- ever inserts, so definer rights cannot be used to reach the update path.

BEGIN;

CREATE OR REPLACE FUNCTION public.inv_create_variant(
  p_product_id uuid,
  p_sku        text,
  p_name       text,
  p_barcode    text,
  p_sale_price numeric,
  p_cost_price numeric,
  p_status     public.product_variant_status,
  p_values     jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_variant_id uuid;
  v_count      integer;
BEGIN
  IF NOT (public.can_write_inventory()
          OR public.has_role(auth.uid(), 'sales_rep'::public.app_role)) THEN
    RAISE EXCEPTION 'Not permitted to create product variants.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION
      'The attribute values must be supplied as a JSON object of attribute id to value id.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT count(*) INTO v_count FROM jsonb_object_keys(p_values);

  IF v_count = 0 THEN
    RAISE EXCEPTION
      'A variant must state the combination it stands for — choose a value for at least one attribute.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_sku IS NULL OR length(trim(p_sku)) = 0 THEN
    RAISE EXCEPTION 'A variant needs a reference (SKU).'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'A variant needs a name.'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  ------------------------------------------------------------------ parent
  INSERT INTO public.product_variants (
    product_id, sku, name, barcode, sale_price, cost_price, status, created_by
  ) VALUES (
    p_product_id,
    trim(p_sku),
    trim(p_name),
    NULLIF(trim(COALESCE(p_barcode, '')), ''),
    COALESCE(p_sale_price, 0),
    COALESCE(p_cost_price, 0),
    COALESCE(p_status, 'provisional'::public.product_variant_status),
    auth.uid()
  )
  RETURNING id INTO v_variant_id;

  ------------------------------------------------------------------ values
  -- Same transaction as the parent, so the deferred require-values trigger sees
  -- a complete variant at COMMIT. The composite FK on (value_id, attribute_id)
  -- rejects a value filed under the wrong attribute, and the unique index on
  -- (product_id, combo_key) rejects a duplicate combination — both without any
  -- checking done here.
  INSERT INTO public.product_variant_values (variant_id, attribute_id, value_id)
  SELECT v_variant_id, key::uuid, value::uuid
    FROM jsonb_each_text(p_values);

  RETURN v_variant_id;
END $function$;

COMMENT ON FUNCTION public.inv_create_variant(uuid, text, text, text, numeric, numeric, public.product_variant_status, jsonb) IS
  'Creates a product variant and its combination in ONE transaction, which is '
  'what the deferred product_variants_require_values trigger requires. A '
  'two-call client write cannot satisfy that trigger because PostgREST commits '
  'each request separately. Callers pass p_status explicitly: Sales creates '
  'provisional, inventory surfaces create permanent.';

COMMIT;
