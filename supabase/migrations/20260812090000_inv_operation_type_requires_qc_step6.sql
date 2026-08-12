-- =====================================================================
-- INVENTORY RESET — STEP 6: requires_qc on inv_operation_type
-- =====================================================================
--
-- Approved by V on 2026-08-12 as Pass 8 Part A decision 1 (Option A).
--
-- Adds ONE column. No function is created, altered or dropped; no policy, no
-- trigger, no view, no index. The only data written is the UPDATE in Section 2,
-- which touches operation types of kind 'receipt' (1 row today: GOODS RECEIVED).
--
-- WHY A FLAG AND NOT INFERENCE
-- The alternative considered was deriving visibility from "does this product
-- have an active test template". V rejected it, correctly: a type that requires
-- QC but has no checklist configured yet would then show NO Quality segment at
-- all — the same silent-omission failure as the Pass 6 no-checklist hole, and
-- compounding it. With an explicit flag the segment appears and says
-- "QC required for this document type, but no checklist is defined for this
-- product": a visible, fixable misconfiguration instead of an invisible one.
--
-- WHAT THIS FLAG IS NOT
-- It is UI policy, exactly like mandatory_scan_product and its neighbours. It
-- decides whether the Quality segment is offered. It does NOT gate anything in
-- the database: the real QC gate is inv_record_qc_results deriving
-- inv_stock_item.status, and that is unchanged by this migration. Nothing here
-- makes a unit more or less sellable.
--
-- REVERSIBILITY
-- Additive with a default, so no existing row changes shape and no existing
-- query breaks. Rule 4: nothing is dropped or deleted.

BEGIN;

-- 1 ------------------------------------------------------------- the column
ALTER TABLE public.inv_operation_type
  ADD COLUMN requires_qc boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.inv_operation_type.requires_qc IS
  'UI policy: whether the Quality segment appears on documents of this type. '
  'Not enforced by any trigger or RPC — the QC gate itself lives in '
  'inv_record_qc_results and inv_stock_item.status.';

-- 2 --------------------------------------------------------- receipts opt in
-- Goods arriving from a supplier are the case QC exists for. Every other kind
-- stays false until someone deliberately turns it on.
UPDATE public.inv_operation_type
   SET requires_qc = true, updated_at = now()
 WHERE kind = 'receipt';

COMMIT;
