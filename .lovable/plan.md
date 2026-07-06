## Workflow 1 wiring — plan

Note: the earlier build error was transient S3 upload throttling from the preview host, not a code problem. No source change fixes it; the next build will retry.

### 1. Database (one migration)

Two Postgres RPCs and one helper. Everything scoped to `SECURITY DEFINER` with `search_path = public` and gated on `public.can_write_inventory()`.

- `public.complete_ito_with_qc(p_ito_id uuid)` returns `jsonb`
  - Reads `qc_inspections` for `document_type='ito', document_id=p_ito_id`.
  - Validates every expected line unit has a `pass` or `fail` inspection.
  - Resolves the ITO's destination warehouse's `transit` location from `warehouse_locations` (type `transit`).
  - For each passed unit: updates `goods_receipt_serials` (or the serial ledger the ITO source uses) `current_location = <transit id>`, `stock_status = 'reserved'` (bucket), and inserts a `stock_moves` row (source → transit).
  - For each failed unit: leaves stock, creates a `correction_orders` row referencing the ITO + failing serial (uses existing `correction_orders` service pattern).
  - If any failed units exist → raise exception `'ITO cannot complete: failed units require correction'`.
  - Sets ITO status to `completed`.
  - Inserts notifications for SO creator, `sales_manager`, `super_admin` roles.
  - Returns `{ moved: n, failed: n, correction_order_id }`.

- `public.complete_delivery_with_qc(p_dn_id uuid, p_signature_url text)` returns `jsonb`
  - Verifies related SO `payment_status = 'paid'` (or `amount_paid >= total_amount`). Raises if not.
  - Verifies every expected serial inspected + no un-photographed fails.
  - Moves each passed serial from transit → customer location (bucket `sold`, `stock_status='sold'`, `delivered_at=now()`, `delivered_to=<customer_id>`).
  - Inserts stock_moves rows for the transit-out.
  - Sets DN `status='delivered'`, stores signature url.
  - If SO now 100% delivered → sets SO `status='closed'`.
  - Notifies SO creator + `super_admin`.

Grants: `EXECUTE ... TO authenticated`.

### 2. Service layer

`src/lib/services/inventory/workflow1.ts` (new) — thin wrappers:
- `completeItoWithQc(itoId)`
- `completeDeliveryWithQc(dnId, signatureUrl)`
- `getTransitLocationForWarehouse(warehouseId)` (client-side helper for pre-flight UX)
- `canCreateDeliveryForSO(soId)` → `{ allowed, paidAmount, totalAmount, message }`

Corresponding hooks in `src/hooks/inventory/workflow1.ts` (TanStack Query).

### 3. UI wiring

**`src/pages/inventory/TransferDetail.tsx`**
- When ITO status is `confirmed`/`ready`, render `<ScanQCPanel documentType="ito" ... requirePhotos={false}>`.
- `onComplete` → call `completeItoWithQc`. On success toast, invalidate ITO, navigate refresh. On failed-unit error, show inline banner "N units failed QC — Correction Order #X created; resolve before completing."
- `expectedLines` derived from ITO lines; serials pulled from reserved `goods_receipt_serials` for that ITO's source.

**`src/pages/inventory/DeliveryNoteDetail.tsx`**
- Show a payment-gate banner sourced from `canCreateDeliveryForSO`. If not fully paid, disable QC panel + show "Delivery available after full payment. Current: ₹X paid of ₹Y".
- If paid, render `<ScanQCPanel documentType="delivery_note" ... requirePhotos={true}>`.
- `onComplete` → call existing signature-capture, then `completeDeliveryWithQc`.

**Sales Order detail (existing page)**
- Add `<Workflow1Tracker soId>` component (new, `src/components/sales/Workflow1Tracker.tsx`) showing 6 steps with status chips and links: SO Confirmed → ITO → Packed → Invoice Paid → Delivery → Closed.
- Add payment-gate "Create Delivery Order" button using `canCreateDeliveryForSO`.

### 4. Notes

- No changes to the `ScanQCPanel` engine itself.
- Correction Order creation reuses existing `correction_orders` service; only the trigger point is new (inside the RPC).
- Existing "part-delivery restricted to invoiced items" logic remains; the paid-in-full check layers on top in the SO detail + RPC.
- Stock Dashboard already reads serial `current_location` and `stock_status`, so the transit view lights up automatically.

### Files touched

New: 1 migration, `src/lib/services/inventory/workflow1.ts`, `src/hooks/inventory/workflow1.ts`, `src/components/sales/Workflow1Tracker.tsx`.
Edited: `src/pages/inventory/TransferDetail.tsx`, `src/pages/inventory/DeliveryNoteDetail.tsx`, SO detail page.

After migration + code changes: run `bunx tsgo --noEmit`.
