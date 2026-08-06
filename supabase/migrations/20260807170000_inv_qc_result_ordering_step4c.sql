-- =====================================================================
-- INVENTORY RESET - STEP 4, MIGRATION C: deterministic QC result ordering
-- =====================================================================
--
-- FIXES A REAL BUG found by smoke test D5.
--
-- inv_record_qc_results decides a unit's status from "the latest result per
-- template", which it resolved with:
--
--     DISTINCT ON (template_id) ... ORDER BY template_id, tested_at DESC, id DESC
--
-- tested_at defaults to now(), and now() is the TRANSACTION timestamp - it does
-- not advance during a transaction. Two results for the same template written
-- in one transaction therefore carry an identical tested_at, and the tiebreaker
-- becomes id DESC: a random UUID. Which result counts as "latest" was decided
-- by coin toss.
--
-- Observed: a unit failed a required test, was retested to passing in the same
-- transaction, and stayed 'rejected' because the older failing row happened to
-- sort first. A wrong status, arrived at silently.
--
-- FIX: give inv_test_result a strictly monotonic ordinal and order by it. An
-- identity column cannot tie, so "latest" becomes a fact rather than a
-- probability. tested_at also moves to clock_timestamp() so the recorded time
-- is the real one rather than the transaction's start.
--
-- Touches inv_* objects only. No products, no CRM, no old module, no legacy
-- function names.
--
-- Depends on: step2, step3, step4a, step4b.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. MONOTONIC ORDINAL
-- ---------------------------------------------------------------------
-- GENERATED ALWAYS: the ordinal is the database's to assign, never a caller's
-- to supply. The table is empty, so backfill is not a concern.

ALTER TABLE public.inv_test_result
  ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY;

COMMENT ON COLUMN public.inv_test_result.seq IS
  'Strictly monotonic insertion ordinal. THIS, not tested_at, decides which result is the latest for a template - tested_at defaults to now(), which is constant within a transaction and cannot order rows written together.';

-- Supports the DISTINCT ON that resolves the latest result per template.
CREATE INDEX IF NOT EXISTS inv_test_result_latest_idx
  ON public.inv_test_result (stock_item_id, template_id, seq DESC);


-- ---------------------------------------------------------------------
-- 2. REAL WALL-CLOCK TIMES
-- ---------------------------------------------------------------------
-- clock_timestamp() advances during a transaction; now() does not. This makes
-- the displayed QC time honest when several tests are recorded together. It is
-- NOT what decides ordering - seq does - but a timeline that shows four tests
-- at the identical instant is misleading.

ALTER TABLE public.inv_test_result
  ALTER COLUMN tested_at SET DEFAULT clock_timestamp();


-- ---------------------------------------------------------------------
-- 3. THE QC GATE, ORDERING CORRECTED
-- ---------------------------------------------------------------------
-- Identical to the Migration B version except:
--   * the `latest` CTE orders by seq DESC instead of tested_at DESC, id DESC
--   * the INSERT sets tested_at = clock_timestamp() explicitly
-- Every rule, message and outcome is unchanged.

CREATE OR REPLACE FUNCTION public.inv_record_qc_results(
  p_stock_item_id uuid,
  p_results       jsonb
) RETURNS public.inv_stock_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item        public.inv_stock_item%ROWTYPE;
  v_res         jsonb;
  v_template    public.inv_test_template%ROWTYPE;
  v_required    integer;
  v_req_passed  integer;
  v_req_failed  integer;
  v_adv_failed  integer;
  v_target      public.inv_stock_status;
BEGIN
  IF NOT public.can_write_inventory() THEN
    RAISE EXCEPTION 'Not permitted to record QC results.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_item FROM public.inv_stock_item WHERE id = p_stock_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Stock item % not found.', p_stock_item_id USING ERRCODE = 'no_data_found';
  END IF;

  ------------------------------------------------------- record each result
  FOR v_res IN SELECT * FROM jsonb_array_elements(COALESCE(p_results, '[]'::jsonb))
  LOOP
    SELECT * INTO v_template
      FROM public.inv_test_template
     WHERE id = (v_res->>'template_id')::uuid;

    IF v_template.id IS NULL THEN
      RAISE EXCEPTION 'QC template % does not exist.', v_res->>'template_id'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NOT v_template.is_active THEN
      RAISE EXCEPTION 'QC template "%" is not active.', v_template.name
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_template.product_id IS NOT NULL
       AND v_template.product_id <> v_item.product_id THEN
      RAISE EXCEPTION
        'QC template "%" belongs to a different product and does not apply to serial %.',
        v_template.name, v_item.serial
        USING ERRCODE = 'check_violation';
    END IF;

    IF (v_res->>'result') IS NULL THEN
      RAISE EXCEPTION 'QC result for "%" must say pass or fail.', v_template.name
        USING ERRCODE = 'null_value_not_allowed';
    END IF;

    IF v_template.requires_value
       AND COALESCE(trim(v_res->>'value'), '') = '' THEN
      RAISE EXCEPTION 'QC test "%" requires a measured value.', v_template.name
        USING ERRCODE = 'null_value_not_allowed';
    END IF;

    IF v_template.requires_attachment
       AND COALESCE(jsonb_array_length(COALESCE(v_res->'attachments', '[]'::jsonb)), 0) = 0 THEN
      RAISE EXCEPTION 'QC test "%" requires at least one attachment.', v_template.name
        USING ERRCODE = 'null_value_not_allowed';
    END IF;

    INSERT INTO public.inv_test_result (
      stock_item_id, template_id, result, value, notes, attachments, tested_by, tested_at
    ) VALUES (
      p_stock_item_id, v_template.id, (v_res->>'result')::boolean,
      v_res->>'value', v_res->>'notes',
      COALESCE(v_res->'attachments', '[]'::jsonb), auth.uid(), clock_timestamp()
    );
  END LOOP;

  ------------------------------------------------- evaluate the whole checklist
  WITH applicable AS (
    SELECT t.id, t.is_required
      FROM public.inv_test_template t
     WHERE t.is_active
       AND (t.product_id = v_item.product_id OR t.product_id IS NULL)
  ),
  latest AS (
    -- seq is strictly monotonic, so the newest row per template is exact.
    SELECT DISTINCT ON (r.template_id) r.template_id, r.result
      FROM public.inv_test_result r
     WHERE r.stock_item_id = p_stock_item_id
     ORDER BY r.template_id, r.seq DESC
  )
  SELECT
    count(*) FILTER (WHERE a.is_required),
    count(*) FILTER (WHERE a.is_required     AND l.result IS TRUE),
    count(*) FILTER (WHERE a.is_required     AND l.result IS FALSE),
    count(*) FILTER (WHERE NOT a.is_required AND l.result IS FALSE)
    INTO v_required, v_req_passed, v_req_failed, v_adv_failed
    FROM applicable a
    LEFT JOIN latest l ON l.template_id = a.id;

  v_target :=
    CASE
      WHEN v_req_failed > 0            THEN 'rejected'
      WHEN v_req_passed < v_required   THEN 'quarantined'   -- incomplete
      WHEN v_adv_failed > 0            THEN 'attention'
      ELSE                                  'ok'
    END::public.inv_stock_status;

  IF v_item.status IN ('destroyed','lost') THEN
    RETURN v_item.status;
  END IF;

  IF v_target <> v_item.status THEN
    UPDATE public.inv_stock_item
       SET status = v_target, updated_at = now()
     WHERE id = p_stock_item_id;
  END IF;

  RETURN v_target;
END $$;

COMMENT ON FUNCTION public.inv_record_qc_results IS
  'The QC gate. Records results against the product checklist and sets the unit status: ok when every required test passed, attention when an advisory test failed, rejected when a required test failed, quarantined while the checklist is incomplete. Latest-result-per-template is resolved by the monotonic seq column, never by timestamp.';

COMMIT;
