# GLF ERP — Inventory + Barcode Module Plan

> **Audience:** Claude Code. Read this file fully before touching inventory or barcode code.
> **Scope:** Inventory + Barcode modules ONLY, built together as one standalone, self-testable unit.
> **Out of scope:** Wiring to Sales, Invoicing, Returns, Manufacturing, HR. Those touchpoints are documented as interface stubs in §8 and must NOT be built from this plan.

---

## 1. Goal & design philosophy

### 1.1 The goal

Build GLF's Inventory module modeled on **Odoo Enterprise Inventory**, which the owner (V) has used extensively and likes for its features, UI, configurability, and ease of setup. Replicate the Odoo *experience* — then layer GLF's furniture-business rules on top. Wherever a GLF rule conflicts with an Odoo default, **the GLF rule wins**.

The Barcode module is built together with Inventory, exactly as Odoo pairs its Barcode app with Inventory: a dedicated scanning workspace that fulfills inventory operations.

### 1.2 Project context

| Item | Value |
|---|---|
| Repo | `https://github.com/gv0921-maker/simple-domain-587ce0cb.git` |
| Supabase project ID | `mdtwvuiakvxoqvksemyt` |
| Stack | React 18 + Vite + TypeScript + Tailwind + shadcn/ui + Supabase (Postgres, RLS, edge functions) |
| Owner profile | Non-coder. Furniture manufacturing + showroom + warehouse business (Karnataka, India). 15+ staff. |
| Design reference | Odoo Enterprise Inventory + Odoo Barcode app |

### 1.3 Process rules (mandatory)

1. **Verify before claiming.** After any batch of work, verify against the actual repo (grep/read files). Past sessions repeatedly hit "claimed done but not done."
2. **Work in batches.** Large changes are split into reviewable batches; each ends with a clean `tsc --noEmit` and a commit.
3. **No phantom data paths.** Never let a UI accept input that has no valid backing data (see the phantom-serial scanner bug, §9.2). Fail loudly with a clear user-facing message instead.
4. **Client-side completion logic is acceptable** at GLF's scale (single site, low concurrency), but multi-step stock mutations should prefer Postgres RPCs (SECURITY DEFINER, `SET search_path = public`) for atomicity when practical.
5. **Storage buckets are created manually** in the Supabase dashboard. Required for this plan: `qc-photos` (public). If missing, photo uploads fail — remind the user.
6. **FY-based document numbering** goes through `public.generate_document_number(p_document_type)` (exists). Never hand-roll numbering.
7. **RBAC:** UI checks via `useRoleCheck()` hook only (never `user.role`). DB via `is_admin()`, `has_any_role()`, `is_super_admin()` helpers against `user_roles`. Super admin bypasses everything.

---

## 2. Odoo reference map

### 2.1 REPLICATE (the parts V liked)

| Odoo pattern | GLF implementation |
|---|---|
| **Overview = operation-type kanban cards** | `/inventory` Overview shows one card per active `operation_types` row: colored by `card_color`, live counts by status (To Process / Late / Completed), `+ New` button routing to the right operation wizard, `View All` to a filtered list. New custom operation types appear automatically. |
| **Operations menu** | Dropdown: Receipts, Internal Transfers, Deliveries (inventory-side operation), plus Correction Orders, Stock Counts, Write-offs under a Quality group. |
| **Configuration depth** | Setup dropdown, grouped with section headers (Odoo style): **Settings** · *Warehouse Management:* Warehouses, Locations, Operation Types · *Products:* Product Categories, Product Attributes, Units & Packagings · *Replenishment:* Reorder Rules, Adjustments. Warehouses live INSIDE Setup, not as a top-level tab. |
| **Operation Type form, 3 tabs** | General / Hardware / Barcode tabs (see §5 of data model, §4.1). |
| **Location form** | Odoo-style: name, warehouse, parent location, type, code, barcode, aisle/shelf/bin, removal strategy (FIFO default), cyclic counting (frequency days, last/next count), notes. |
| **Product Attributes** | Global reusable attributes (Size, Colour, Fabric, Polish) with typed display (radio/select/color/pills), values with extra price, assignable per product. |
| **Barcode app pairing** | Separate Barcode workspace that lists open operations and completes them by scanning (§5). |
| **List/form UX** | Clean list views with the app's Odoo-style FilterBar (search + unified dropdown with Filters/Group By/Favorites columns), responsive card fallback on mobile, breadcrumbless headers, single active tab highlight. |

### 2.2 SKIP (consciously excluded — do not build)

- Storage Categories, Putaway Rules (enterprise capacity management)
- Multi-step routes (2/3-step receipts and deliveries) beyond the GLF flows in §4
- Landed costs, dropshipping, batch/wave/cluster picking
- Multi-company, multi-currency
- FIFO/LIFO *costing valuation* (average cost only; FIFO applies only as a **removal strategy** for picking order)
- Automated replenishment PO generation (Reorder Rules display triggers only)
- IoT box / hardware printer drivers (labels render in browser; user prints)

---

## 3. GLF prerequisites & locked business rules

These are non-negotiable and override Odoo defaults.

1. **GLF generates labels at receipt.** Vendors/factory do NOT pre-label. At Goods Receipt, GLF generates a unique serial number + barcode per physical unit, prints labels (A4 sheet or thermal — user toggle), and pastes them. Every unit is individually tracked by its GLF serial forever after.
2. **Stock buckets.** Every serial is in exactly one bucket at all times:
   `Available · Under Correction · Reserved · Sold · Returned · Written-off · Rejected`
   - *Under Correction* counts as on-hand but displays separately. (When sales wiring lands later, it shows a "Minor Damages" badge — badge only, no acknowledgement flow.)
3. **QC on every operation** that moves physical goods: per-unit pass/fail + optional notes + photo evidence. Photos mandatory on FAIL; configurable per operation type for pass.
4. **Correction Orders are per QC-failed ITEM**, not per batch. Each failed unit gets its own CO. QC cycle history is **append-only** (every re-inspection is a new record; nothing is overwritten). Resolutions: fixed → back to Available; vendor refund → CO closed (a replacement is a fresh vendor order, never a reopened CO); unsalvageable → write-off draft.
5. **Monthly FULL stock count** (not cyclic-partial by default). Counter chain: Warehouse Manager → optional Sales Manager → fallback Super Admin. **Skipping a month requires Super Admin approval with a reason.** Discrepancies reconciled with logged adjustments. (Per-location cyclic counting frequency exists as an optional extra, from the Location form.)
6. **Write-offs / scrap: Super Admin only.** Mandatory reason + photo evidence. Serial → Written-off bucket.
7. **Internal movement reason codes:** `Rearrangement · Display Sold · Damage Quarantine · Return to Vendor · Cycle Count Reconciliation` (plus the transit pick covered in §4.2).
8. **Scanning lives in the Barcode workspace and inline ScanQCPanel** — never a third pattern. The old "Legacy Scanner" path is removed and must not return.
9. **Audit trail everywhere.** `log_row_change()` triggers + `activity_log`; ActivityChatter component on detail pages; user names resolved server-side via `get_activity_log_with_users` RPC.

---

## 4. Core operations (inventory-internal)

Every operation is an instance of an **Operation Type** (§7.4) and inherits its defaults: source/destination locations, sequence prefix, lot/serial rules, print-on-validation settings, scan requirements. All operations complete through the shared Scan+QC engine (§6).

> **Recast note:** The formerly SO-driven flow (SO → ITO → Delivery) is recast here as generic, standalone operations. They can be created manually with any free-text/nullable external reference. The sales-driven trigger is an interface stub (§8) — do not build it.

### 4.1 Receipt (Goods Receipt)

4-step wizard, status-driven:

1. **Source** — where goods come from: Vendor / Factory / Return / Transfer. (Vendor and Factory are just source labels here; PO/WO linkage is a §8 stub.)
2. **Quantity** — expected vs received per line. Discrepancy (wrong qty or wrong product) requires **Super Admin approval** to accept.
3. **Labels** — generate one serial + barcode per unit (`useGenerateSerialsForLine` exists). Print via label engine (A4 grid or thermal single). User pastes labels.
4. **QC** — per-unit pass/fail + photos via ScanQCPanel.

**On completion (critical, currently broken — see §9):** every passed serial must be finalized:
- `stock_status = 'available'`
- `current_warehouse_id` = receiving warehouse
- `current_location` = operation type's default destination location (or the warehouse's main stock location)
- Failed serials → `stock_status = 'rejected'` + auto-create a Correction Order per unit.
- Receipt status → `completed`. Stock dashboard and buckets reflect immediately.

### 4.2 Internal Transfer

Moves serials between locations within/between warehouses. Two flavors, one mechanism:

- **General movement** with a reason code (§3.7).
- **Pick-to-transit**: move specific serials to the warehouse's `transit`-type location (packing area). This is the standalone version of the former ITO. Completion = scan each expected serial + QC pass → serial's `current_location` = transit location; failed units block completion and auto-create COs.

Rules:
- Transit location is resolved per warehouse: `warehouse_locations WHERE warehouse_id = ? AND type = 'transit' AND is_active`. If none exists → **hard error**: `No transit location configured for warehouse "X". Create one in Setup → Locations with type = "transit".` No silent fallback.
- The transfer's expected-serial pool is explicit (chosen at creation from Available serials of the product, FIFO by `created_at` per the source location's removal strategy). The scanner accepts ONLY that pool.

### 4.3 Delivery operation (inventory side)

Scans serials OUT of the transit location to a customer/handoff. Standalone: created manually against any reference; the payment gate is a §8 stub.

- ScanQCPanel with `requirePhotos = true` (proof-of-condition at handoff protects against "damaged on delivery" disputes).
- On completion: each scanned+passed serial → `stock_status = 'sold'`, `current_location = null` (left the building), delivered_at timestamp. Physical customer signature remains an offline artifact; the printable delivery document includes a signature line.

### 4.4 Adjustment

Manual quantity/serial corrections with reason, admin+ only, fully logged. Backs the count-reconciliation flow.

### 4.5 Scrap / Write-off

Super Admin only. Reason + photo(s) mandatory. Serial → `written_off`.

### 4.6 Stock Count

Monthly full count per §3.5. Initialize (snapshot expected serials per location) → count by scanning in the Barcode workspace → reconcile discrepancies via Adjustments → complete. Skip-month = Super Admin approval record with reason.

---

## 5. Barcode module (built together with Inventory)

Modeled on Odoo's Barcode app: a focused, mobile-first scanning workspace at `/barcode`.

### 5.1 Structure

- **Home / Scan Queue** — lists OPEN operations that need scanning (receipts in Labels/QC step, transfers pending, deliveries pending, active stock counts), each a big tappable card with type color + progress (e.g. "3/10 scanned").
- **Operation scanning screen** — opening a queue item embeds the same **ScanQCPanel** (§6) bound to that operation. Completing here = completing on the operation's own detail page; both write to the same records. No duplicate logic.
- **Label station** — generate + print labels: pick a receipt line or product+serials → render barcode labels via `jsbarcode` → A4 grid layout or thermal single-label layout (toggle) → browser print.
- **Ad-hoc lookup** — scan any barcode/serial to see the unit's product, status bucket, current warehouse/location, and history.

### 5.2 Input methods

- USB/Bluetooth scanner: autofocused text input, Enter submits.
- Camera: `html5-qrcode` dialog (`CameraScannerDialog` exists — reuse).
- Feedback: audio beep + vibration on accept, distinct error tone on reject.

### 5.3 Binding rules

- Operation detail pages show an "Open in Barcode" affordance; the Barcode queue deep-links back. One engine, two entry points.
- The Barcode module never invents its own validation — it calls the same `qcEngine` functions.

---

## 6. Shared Scan+QC engine (already built — the contract)

### 6.1 Pieces (verified in repo)

- Table `public.qc_inspections` — `document_type` ('receipt' | 'internal_transfer' | 'delivery' | 'return' — extendable), `document_id`, `document_line_id`, `serial_number`, `product_id`, `qc_status` (pending/pass/fail), `qc_notes`, `photo_urls jsonb`, `inspected_by`, `inspected_at`. Unique on `(document_type, document_id, serial_number)`. RLS: authenticated read; warehouse/admin write.
- Service `src/lib/services/inventory/qcEngine.ts` — `getQCInspections`, `recordScan`, `recordQCResult`, `uploadQCPhoto` / `removeQCPhoto` (path `{type}/{docId}/{serial}_{ts}.{ext}` in bucket `qc-photos`), `computeProgress` / `getCompletionProgress`, `validateReadyToComplete`.
- Hooks `src/hooks/inventory/useQCEngine.ts` (TanStack Query).
- Component `src/components/inventory/ScanQCPanel.tsx` — progress header, scan input (USB + camera), per-unit Pass/Fail with big tap targets, photo thumbnails + capture, awaiting-scan list, sticky Complete button that explains why it's blocked.

### 6.2 Validation rules (hard requirements)

1. A scanned serial MUST be in the operation's expected-serial pool. Otherwise reject: `Serial [X] is not part of this document`.
2. If the expected pool is EMPTY, the scanner is **locked** with: `No stock is available/expected for this operation. Ensure goods have been received and stock exists.` It must never fall through to accepting arbitrary input. (This was the phantom-serial bug — see §9.2.)
3. Duplicates rejected (client check + DB unique index backstop).
4. Completion requires: all expected units scanned, all QC'd, photos present where required. Failed units block completion (per-flow behavior: receipts finalize failures as rejected+CO; transfers/deliveries must resolve or remove the failed unit first).

---

## 7. Data model & serial lifecycle

### 7.1 Serial lifecycle (state machine on `goods_receipt_serials.stock_status`)

```
pending ──(receipt QC pass + completion)──▶ available
available ──(reservation, §8 stub)────────▶ reserved
available/reserved ──(transfer to transit)▶ [location = transit] (status: reserved or available; bucket display "Reserved/In Transit")
transit ──(delivery completion)───────────▶ sold
any ──(QC fail at receipt)────────────────▶ rejected ──(CO resolved)──▶ available | written_off
any on-hand ──(damage found later)────────▶ under_correction ──(CO resolved)──▶ available | written_off
any on-hand ──(super-admin write-off)─────▶ written_off
sold ──(return intake, §8 stub)───────────▶ returned ──(grading)──▶ available | under_correction | written_off
```

Columns that must always be maintained: `stock_status`, `current_warehouse_id`, `current_location`, `reserved_for_so_id` (nullable stub, §8).

### 7.2 Existing tables (verified — extend, don't recreate)

`products` · `product_categories` · `product_attributes` / `product_attribute_values` / `product_attribute_assignments` · `units_of_measure` · `warehouses` · `warehouse_locations` (incl. `type='transit'`, `removal_strategy`, cyclic-count fields, aisle/shelf/bin) · `operation_types` · `goods_receipts` / `goods_receipt_lines` / `goods_receipt_serials` · `internal_transfer_orders` / `internal_transfer_order_lines` · `qc_inspections` · correction-order tables · stock-count tables · write-off tables · `stock_moves` (low-level ledger) · `numbering_settings` / `numbering_sequences`.

### 7.3 Stock Moves vs Operations (settled — keep the distinction)

- **Stock Moves** (`/inventory/stock-moves`) = the granular per-serial/per-line movement **ledger**. Keep. `TransferDetail.tsx` is its row viewer (do not delete; unrelated to the ITO page).
- **Operations** = the Overview's operation-type cards (§2.1). The old standalone `OperationsList` stat page is redundant and stays removed.

### 7.4 Operation Types (3-tab form — fields)

- **General:** name, kind (receipt / delivery / internal_transfer / manufacturing), sequence prefix (feeds FY numbering), card color, Lots/Serials (create new, use existing), default source + destination locations, returns-type link, create-backorder policy (ask/always/never).
- **Hardware (print on validation):** delivery slip, product labels, lot/serial labels.
- **Barcode:** mandatory scan product, mandatory scan lot/serial, allow extra products.
- Seeded: Receipts (RCP), Deliveries (DEL), Internal Transfers (INT). Custom types allowed; each automatically gets an Overview card.

### 7.5 Numbering

All operations number via `generate_document_number()`: `internal_transfer → ITO`, `internal_movement → IM`, plus receipt/delivery prefixes from the operation type. **Never insert an operation row without its number** (this exact bug shipped once — `create_ito_from_so` omitted `ito_number`; a later migration must never overwrite RPCs without preserving number generation).

---

## 8. External interface stubs — documented, NOT built

These are the contract points where other modules will plug in later. Building any of these now is out of scope.

| Stub | Contract |
|---|---|
| **Sales reservation** | `goods_receipt_serials.reserved_for_so_id uuid NULL`. A later sales wiring will reserve Available serials (FIFO) to an order and set `stock_status='reserved'`. Inventory treats a non-null value as read-only context. |
| **Delivery payment gate** | The Delivery operation exposes a `gate` check hook (currently `canCreateDeliveryForSO` exists from prior work). Standalone deliveries pass the gate trivially; the sales wiring later injects the full-payment predicate. |
| **Return intake** | A `document_type='return'` in `qc_inspections` + a receipt-with-source='Return'. Condition grading (Like New / Minor Damage / Unsalvageable → Available / Under Correction+CO / Write-off draft) is the returns module's job later. |
| **Factory / Work Orders** | Receipt source='Factory' is a label only. WO-completion → auto-GR handoff is Manufacturing wiring, later. Factory's own `factory_inventory_items` is a separate parallel stock system by design — never merge. |
| **Vendor Orders** | Receipt source='Vendor' is a label only. VO linkage + reorder-rule automation later. |

**Supersession notice:** an older plan (June session) specified `stock_reservations` and `delivery_qc` tables plus a separate "Pre-delivery QC" step. That design is **superseded** by the serial-status machine + unified `qc_inspections` engine. Do not create or resurrect those tables.

---

## 9. Current state, work queue, test sequence

### 9.1 Verified in repo (do not rebuild)

- Scan+QC engine complete (§6.1). Config features + tables (§7.2, §7.4) built. Locations Supabase-backed with transit type. Setup dropdown restructured with grouped sections; Warehouses moved into Setup. Overview dashboard converted from hardcoded numbers to real queries + empty states. `create_ito_from_so` RPC fixed (number generation, duplicate guard, warehouse/display-source lines only, valid statuses). Payment-gate predicate exists in two layers. `Workflow1Tracker` exists. Legacy Scanner button removed from FulfillmentSection. ModuleNav supports grouped dropdowns + overflow scroll. `log_row_change()` trigger type-safe. FilterBar (Odoo-style unified search dropdown) available for list views.

### 9.2 Known broken (root causes identified in live testing)

1. **GR completion does not finalize serials** → nothing ever reaches `available` with a real location. This is THE prerequisite bug; everything downstream starved.
2. **Scanner accepted phantom serials** when the expected pool was empty (validation fall-through). Must implement §6.2 rule 2 strictly.
3. **Transfer completion reported "No passed units to move"** — consequence of 1+2 (scanned serials never matched a reserved/expected pool).
4. **Source/Destination displayed category labels ("Warehouse") instead of real location names** — must resolve actual `current_location` → location name, and destination = transit location name.
5. A dependency-chain fix covering 1–4 was sent to the previous builder at session end — **first task: verify in the repo whether it landed**, then fix whatever is missing.

### 9.3 Work queue (priority order)

1. Verify §9.2 fix status in repo; complete any missing parts (GR finalization, scanner hardening, real location display).
2. Make Receipt → Available fully correct and idempotent (prefer an RPC for the finalization step).
3. Internal Transfer standalone creation UI (pick product + qty → FIFO-suggest Available serials → explicit expected pool) + pick-to-transit completion.
4. Delivery operation standalone (manual creation, transit → sold, photos required).
5. Barcode workspace: scan queue fed by open operations of all kinds; label station consolidation; ad-hoc serial lookup.
6. Stock Count end-to-end with Barcode counting + Adjustment reconciliation; monthly skip-approval flow.
7. Correction Order lifecycle polish (per-item, append-only cycles, resolutions per §3.4).
8. Overview cards driven by `operation_types` dynamically (custom types appear automatically).
9. Deferred (do not do unless asked): sticky right-column ActivityChatter layout; per-button inline RoleGate wrapping.

### 9.4 Mandatory standalone test sequence (no other modules required)

1. **Setup:** warehouse with ≥1 stock location AND 1 `transit` location; verify seeded operation types; add a category, an attribute (Size: King/Queen), UoM check.
2. **Product:** create one product with category + UoM + Size attribute.
3. **Receipt:** new Receipt (source Vendor), qty 3 → generate serials → print labels → QC: pass 2, fail 1 with photo → complete.
   *Assert:* 2 serials `available` with real warehouse+location; 1 serial `rejected` with an auto-created Correction Order; receipt `completed`; Overview card counts update.
4. **Scanner hardening:** open a new empty transfer → scanner is locked with the no-stock message. Scan a wrong serial on a valid operation → rejected.
5. **Internal Transfer (pick-to-transit):** create for 2 units → expected pool = the 2 available serials → scan both, QC pass → complete. *Assert:* both serials' `current_location` = transit; ledger rows in `stock_moves`; source/destination show real location names.
6. **Delivery:** create standalone delivery for those 2 → scan out with photos → complete. *Assert:* both `sold`; printable delivery doc renders with signature line.
7. **Stock Count:** run a count on the stock location → introduce a fake discrepancy → reconcile via Adjustment → complete.
8. **Write-off:** super admin scraps the rejected unit's CO outcome with reason + photo. *Assert:* `written_off`.
9. **Barcode workspace:** repeat step 5 entirely from `/barcode` (queue → scan → complete) and confirm identical results.

---

*End of plan. When in doubt: match Odoo's UX, obey GLF's rules, keep the module standalone, and verify in the repo before reporting done.*
