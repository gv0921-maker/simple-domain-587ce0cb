# Inventory reset — Step 1 design pass

**Date:** 2026-08-06 · **Baseline tag:** `pre-inventory-reset` (`a0bdb09`)
**Preserved state:** `docs/inventory-preserved/`

Read-only analysis of the existing inventory module and a proposed target model,
using two MIT-licensed references as design models — [InvenTree](https://github.com/inventree/InvenTree)
(StockItem / StockItemTracking / StockItemTestResult / PartTestTemplate / StockStatus /
StockLocation) and [AureusERP](https://github.com/aureuserp/aureuserp) (Operation/Move/MoveLine
layering, enum state machines, LocationType). Odoo Enterprise remains the UX/behaviour target.

All existing inventory data is test data; no data migration is needed. Existing inventory
config is preserved as a **fallback**, not migrated.

---

## 1. Current inventory inventory

### Tables (47) — all data is test data

| Table | Purpose | Rows | Note |
|---|---|---|---|
| `products` | Product master | 1 | shared with Sales |
| `product_categories` / `_attributes` / `_attribute_values` | Config | 3 / 4 / 23 | live |
| `product_attribute_assignments` | Product↔attribute | 0 | **never populated** |
| `product_customization_options` | Per-product options | 0 | **dead** |
| `units_of_measure` | UoM config | 4 | live |
| `warehouses` / `warehouse_locations` | Location tree | 3 / 12 | live |
| `operation_types` | Odoo-style op types | 5 | live, 34 columns |
| `numbering_sequences` / `_settings` | Doc numbering | 7 / 1 | live |
| `serial_counters` | Serial counter | 1 | **not referenced in `src/`** |
| `serial_numbers` | *Intended* serial master | **0** | **dead — superseded** |
| `lots` | Lot/batch master | **0** | **dead** |
| `goods_receipts` / `_lines` / `_serials` | GR + de-facto stock | 15 / 15 / 18 | live core |
| `stock_moves` / `stock_move_lines` | Ledger | 10 / 10 | live |
| `stock_reservations` | SO reservations | 6 | 3 of 6 have no serial link |
| `internal_movements` / `_items` | Transfer model A | 0 / 0 | **dead** |
| `internal_transfer_orders` / `_lines` | Transfer model B | 4 / 4 | live |
| `transfers` / `transfer_lines` | Transfer model C | 0 / 0 | **dead**; `transfer_lines` unreferenced |
| `inventory_adjustments` / `adjustment_lines` | Adjustments | 0 / 0 | code live, never used |
| `stock_counts` / `stock_count_items` | Cycle counts | 1 / 0 | barely used |
| `delivery_notes` / `_lines` | Outbound | 0 / 0 | code live, never used |
| `correction_orders` + 3 children | Vendor corrections | 1 / 1 / 0 / 0 | live |
| `qc_inspections` | *Generic* QC | 5 | **parallel QC model** |
| `write_off_records` / `_items` | Write-offs | 0 / 0 | code live, never used |
| `reorder_rules` | Reorder | 0 | code live, never used |
| `label_prints` | Label audit | 9 | live |
| `scan_queue` / `scan_records` | Barcode | 5 / 0 | partly used |
| `factory_inventory_items` / `_stock_movements` / `_user_assignments` | Factory | 0 / 0 / 0 | **dead**; `_user_assignments` unreferenced |

### RPCs (50) — none orphaned

All 50 are reachable: 45 called from `src/`, 5 invoked by triggers
(`gr_fill_default_locations`, `ito_after_line_update`, `prevent_stock_move_mutation`,
`prevent_stock_move_line_mutation`, `scan_record_update_ito_line`).

### Frontend

| Surface | Count |
|---|---|
| Inventory routes in `App.tsx` | 54 |
| Pages under `src/pages/inventory/` | 35 + 19 config/setup |
| Barcode pages | 4 |
| Service modules (`lib/services/inventory/` + `qc/`) | 19 + 2 |
| Hook modules (`hooks/inventory/`) | 17 |
| Inventory components | 3 (+ `components/inventory/config`) |

**Dead frontend paths:** `lib/services/qc/api.ts` (3 calls to non-existent `goods_receipt_qc`),
`lib/services/qc/delivery.ts` + `deliveryNotes.ts:176` (3 calls to non-existent `delivery_qc`).

---

## 2. Known structural problems

### (a) Read/write split — confirmed live

`products.stock_on_hand numeric(14,3)` still exists.

| | |
|---|---|
| **Written by** | only `inv_approve_adjustment`, `inv_validate_stock_move` (adjustments: 0 rows; validate: unused) |
| **Never written by** | `record_gr_item_qc`, `complete_gr_line_qc` — the *only* path that puts stock in the building |
| **Read by** | `useInventoryOverview.ts:60`, `reports/registry.ts` (2 reports), `dashboard/api.ts` (2 places), `inventory/api.ts` (4 places) |

**Measured divergence at time of analysis:** `stock_on_hand` = **10**, actual available serials = **9**.
The inbound path writes the ledger and never touches the column; dashboards and both stock
reports read the column. Also `products.track_serials = false` on the one product, despite
every unit being serialised.

### (b) Dead tables referenced by live code — confirmed

`to_regclass` returns NULL for both `goods_receipt_qc` and `delivery_qc`. Six call sites
across three files will throw at runtime whenever reached.

### (c) Status strings — more nuanced than "no state machine"

Vocabulary **is** constrained: 54 CHECK constraints, ~20 on status/state columns. What is
missing is **transitions** — nothing prevents `completed → draft`, and there is no Postgres
enum type anywhere. Statuses are `text` + CHECK, enforced per-row, never per-transition.
Eight independent vocabularies exist across GR, moves, transfers, ITO, correction orders,
delivery notes, adjustments, scan queue.

### (d) Other divergence sources

| Problem | Evidence |
|---|---|
| **`goods_receipt_serials` is the de-facto StockItem** | 18 rows carry product + serial + location + QC + stock status, while the purpose-built `serial_numbers` sits at 0 rows. A document child table is acting as the global stock master. |
| **`current_location` is `text` holding a UUID, with no FK** | No referential guard to `warehouse_locations`. Currently 18/18 resolve — the integrity hole is structural, not yet realised. |
| **Misnamed FK** | `stock_reservations.serial_number_id` → **`goods_receipt_serials`**, not `serial_numbers`. Name implies the wrong table. |
| **Three parallel transfer models** | `transfers`, `internal_movements`, `internal_transfer_orders` — only the third is used. |
| **Two parallel QC models** | `goods_receipt_serials.qc_*` (real) vs `qc_inspections` (5 rows, generic, no per-product checklist). |
| **Location semantics in a free-text `type`** | `warehouse_locations.type` holds internal/vendor/customer/transit/production/**virtual** with no constraint — `virtual` is used for CORRECTION, LOSS, SCRAP. |
| **Duplicate location** | `CRT111` "CORRECTION" (virtual) and `CORRECTION` "Correction" (internal) both exist. |
| **Numbering split in two** | `numbering_sequences` (7 rows) *and* `operation_types.sequence_current_number` (per-op-type). GR uses the op-type counter, everything else the table. |

---

## 3. Target model vs current

| Reference pattern | Plays that role today | Missing |
|---|---|---|
| **InvenTree `StockItem`** | `goods_receipt_serials` (document child, 18 rows). `serial_numbers` was intended but is empty. | A first-class, document-independent physical-unit table. Today a unit cannot exist without a GR line, so nothing can be created by adjustment, transfer or manufacture. |
| **InvenTree `StockItemTracking`** | `stock_moves` + `stock_move_lines`; two triggers block mutation. | Per-unit granularity — moves are per-*line* with a `serial_numbers text[]`. No immutable per-unit history; the array makes "where has this serial been" a scan, not an index lookup. |
| **`StockItemTestResult` + `PartTestTemplate`** | `goods_receipt_serials.qc_status/qc_notes/qc_images` + orphan `qc_inspections`. | **The template half does not exist.** No per-product test checklist; QC is one boolean pass/fail with free-text notes. No repeatable named tests, no per-test results. |
| **InvenTree `StockStatus`** | Split across `qc_status` (pending/passed/failed) and `stock_status` (8 values mixing condition + lifecycle + location). | A single condition vocabulary. Today `reserved`/`sold` (lifecycle) sit in the same column as `rejected`/`written_off` (condition). No Attention / Quarantined / Lost. |
| **AureusERP `Operation`+`OperationType`+`Move`+`MoveLine`** | `operation_types` is a good OperationType. Below it: `goods_receipts`+`_lines`+`_serials`, plus `internal_transfer_orders`+`_lines`, plus `stock_moves`+`_lines` — parallel stacks per document type. | One Operation/Move/MoveLine spine. Every new document type currently means a new table trio. |
| **AureusERP enum state machines** | `text` + CHECK, 8 vocabularies. | Postgres enum types; transition rules; a single shared `OperationState`/`MoveState`. |
| **AureusERP `LocationType`** | `warehouse_locations.type text`, unconstrained. | An enum, and the *behaviour* attached to it — supplier/customer locations as the counterparty side of every move, `view` for non-stockable parents. |
| **First-class `NumberSequence` + go-live reset** | Two competing mechanisms (see above). | One sequence table owning all document types, with an explicit counter-reset operation for go-live. |

---

## 4. Proposed target schema

All new tables prefixed **`inv_`**.

### Core

| Table | Purpose | Key columns | From |
|---|---|---|---|
| `inv_stock_item` | **Single source of truth per physical unit.** One row = one serial. | `id`, `product_id→products`, `serial` (unique), `location_id→inv_location`, `status inv_stock_status`, `origin_operation_id`, `cost`, `received_at` | InvenTree StockItem |
| `inv_stock_tracking` | **Immutable per-unit ledger.** Append-only; every row names its source document. | `stock_item_id`, `entry_type`, `from_location_id`, `to_location_id`, `document_type`, `document_id`, `user_id`, `created_at`, `detail jsonb` | InvenTree StockItemTracking |
| `inv_location` | Location tree with typed behaviour. | `id`, `warehouse_id`, `parent_id`, `code`, `name`, `type inv_location_type`, `is_active` | AureusERP LocationType |
| `inv_warehouse` | Warehouse master. | `id`, `code`, `name`, `is_active` | both |

### Operations spine

| Table | Purpose | Key columns | From |
|---|---|---|---|
| `inv_operation_type` | Document behaviour config. | `id`, `name`, `kind`, `sequence_id`, `default_source_location_id`, `default_dest_location_id`, `locks_destination bool`, scan flags | AureusERP OperationType |
| `inv_operation` | Document header (receipt, delivery, transfer, adjustment, count). | `id`, `number`, `operation_type_id`, `state inv_operation_state`, `source_location_id`, `dest_location_id`, `partner_id`, `scheduled_at`, `effective_at` | AureusERP Operation |
| `inv_move` | Product-level demand line. | `id`, `operation_id`, `product_id`, `demand_qty`, `state inv_move_state` | AureusERP Move |
| `inv_move_line` | **Per-unit actual.** One row per serial moved. | `id`, `move_id`, `stock_item_id`, `from_location_id`, `to_location_id`, `done_at` | AureusERP MoveLine |

### QC

| Table | Purpose | Key columns | From |
|---|---|---|---|
| `inv_test_template` | Per-product QC checklist. | `id`, `product_id`, `name`, `required bool`, `requires_value bool`, `requires_attachment bool`, `sort_order` | InvenTree PartTestTemplate |
| `inv_test_result` | Per-unit, per-test outcome. | `id`, `stock_item_id`, `template_id`, `result bool`, `value text`, `notes`, `attachments jsonb`, `tested_by`, `tested_at` | InvenTree StockItemTestResult |

### Numbering

| Table | Purpose | Key columns | From |
|---|---|---|---|
| `inv_number_sequence` | One owner for all document numbering. | `id`, `document_type`, `prefix`, `fy_label`, `current_number`, `padding`, `separator`, `reset_policy` | AureusERP + GLF go-live reset |

### Enum types

`inv_stock_status` (ok, attention, damaged, destroyed, rejected, lost, quarantined) ·
`inv_location_type` (supplier, view, internal, customer, inventory_loss, production, transit, scrap) ·
`inv_operation_state` (draft, waiting, ready, done, cancelled) ·
`inv_move_state` (draft, confirmed, assigned, done, cancelled)

### GLF simplifications vs the references

| Simplification | Consequence |
|---|---|
| **All products serial-tracked** | `inv_stock_item` is always qty 1 — no quantity column, no split/merge, no partial-consumption branch. InvenTree's hardest code disappears. |
| **No lot/batch tracking** | No `lots` table. Optional `batch_code text` on `inv_stock_item` if ever needed. |
| **On-hand is derived** | No `stock_on_hand` column anywhere. On-hand = `COUNT(inv_stock_item WHERE status='ok' AND location_id=?)`. **Structurally eliminates bug class (a).** |
| **GR is the only entry point** | Only `kind='receipt'` may INSERT `inv_stock_item`; every other operation only UPDATEs `location_id`/`status`. Enforceable in one place. |
| **GR destination locked** | `locks_destination` on the operation type; the document copies it and the UI never offers the field. |
| **Factory separate** | Factory is its own warehouse with `production` locations, or stays out of scope entirely — not mixed into store on-hand. |

---

## 5. Coexistence plan

| Concern | Approach |
|---|---|
| **Naming** | Every new table/type/function `inv_` prefixed. Zero collisions with the 47 existing tables (none currently start with `inv_`; the existing `inv_*` *functions* are noted below). |
| **⚠ Real collision** | Functions `inv_approve_adjustment`, `inv_validate_stock_move`, `inv_save_stock_move` and `inv_delete_stock_move` already exist. Use a distinct function prefix (e.g. `invx_`) or accept those names as legacy and never reuse them. |
| **FK direction** | New→new freely. New→shared read-only anchors (`products.id`, `auth.users.id`) allowed. **No FK from old tables to new, and none from new to old inventory tables.** Either module can be dropped without touching the other. |
| **`products`** | Not rebuilt in this pass — it is shared with Sales. New module *reads* it and stops writing `stock_on_hand`. The column stays until sign-off (rule 4). |
| **RLS** | New policies mirror existing helpers (`can_write_inventory()`, `is_admin()`) so permissions stay consistent. New policy names `inv_*`. |
| **Routes** | New pages under `/inventory2/*` or feature-flagged, until cutover flips `/inventory/*`. Old routes untouched meanwhile. |
| **Cutover** | Config loaded from `05_config_data.sql` (mapped, not replayed). No operational data migrates. Old tables archived, not dropped. |

---

## 6. What carries over unchanged

The design system is **fully schema-agnostic** — verified: no file under `src/design-system/`
imports `@/lib/services`, `@/hooks`, or `@/integrations`.

| Component | Lines | Reusable as-is |
|---|---|---|
| `DocumentHeader` | 196 | ✅ breadcrumb, pager, actions, segments, ribbon, cog |
| `DocumentFields` | 63 | ✅ pure props |
| `DocumentTabs` | 94 | ✅ |
| `DocumentList` | 388 | ✅ list/filters/view modes |
| `CogMenu` | 376 | ✅ |
| `Chatter` | 217 | ✅ — entries are mapped by the page; `activity_log` is module-neutral |
| `primitives` (Button, StatusPill, **StatusRibbon**) | 315 | ✅ |
| `OverviewCard`, `BarChart` | 264 | ✅ |
| `BarcodeScanList`, `BarcodeSettingsSheet`, `BarcodeStatusScreen` | 605 | ✅ ready for Pass 3 |

**GR Pass-1 layout work carries over conceptually, not literally.** The state-map → ribbon
pattern, always-visible fields, the padded six-row line table, the Moves/Traceability views
and the day-grouped Chatter mapping are all directly reusable; `GoodsReceiptDetail.tsx`
itself is bound to `goods_receipt_*` types and would be re-pointed at
`inv_operation`/`inv_move_line`. Budget it as a re-point, roughly a day, not a rewrite.

`activity_log` itself is module-neutral (`record_type` + `record_id`) and needs no change.

---

## 7. CRM safety

| Check | Result |
|---|---|
| CRM-owned files referencing any inventory table | **Zero.** The one grep hit (`crm-supabase.ts:165`) is a JSONB field named `products` on `crm_opportunities`, not the `products` table. |
| Proposed tables vs CRM tables | Zero overlap — all `inv_*` vs `crm_*`. |
| CRM DB objects touched | None. The three protected CRM functions/triggers are untouched; `04_functions_rpcs.sql` explicitly excluded them. |
| `customers` table | Not touched. Nothing proposed writes it. |
| Design system | No CRM imports; changes are additive-only. |
| Shared-boundary files | `reports/registry.ts`, `dashboard/api.ts`, `GlobalSearch.tsx` read **inventory** (`products`/`stock_on_hand`) and separately read CRM. Retiring `stock_on_hand` will eventually require edits here — **that is a shared-boundary change and needs approval before it happens.** Not required to start. |

**Conclusion: the reset as proposed has zero CRM overlap.** The one future flashpoint is the
three shared-boundary files, and only at the point where `stock_on_hand` readers get re-pointed.

---

## 8. Risk list

| # | Risk | Severity | Honest note |
|---|---|---|---|
| 1 | **`products` is shared with Sales** | **High** | The biggest structural risk. Sales/invoices/quotations/BOM all reference `products`. Any change here reaches beyond inventory. Mitigation: don't touch it this pass. |
| 2 | **Retiring `stock_on_hand`** | **High** | 9 read sites across 4 files, two of which are shared-boundary. Bigger than it looks — needs approval and its own commit. |
| 3 | **Serial history is unreconstructible** | Medium | `stock_move_lines.serial_numbers` is a `text[]`. Backfilling per-unit history into `inv_stock_tracking` means array-unnesting 10 rows of test data — trivial now, impossible after go-live. **Do the reset before real data exists.** |
| 4 | **Two live modules, one truth** | **High** | During coexistence, both write stock. Either freeze the old module at cutover or accept the new one is read-only until switch. Do not run both writable. |
| 5 | **QC templates are new behaviour, not a port** | Medium | `PartTestTemplate` has no current equivalent. It's a genuine feature with its own UI, not a refactor. Easy to under-scope. |
| 6 | **`operation_types` has 34 columns of tuned behaviour** | Medium | Recently worked on (per-op-type sequences, locked locations). Re-deriving it is real work; port it deliberately. |
| 7 | **Numbering cutover + go-live reset** | Medium | Two mechanisms today. Getting FY labels and counters wrong produces duplicate document numbers — visible and embarrassing. |
| 8 | **54 routes / ~54 pages** | Medium | The frontend is the bulk of the effort, not the schema. |
| 9 | **RLS regressions** | Medium | 163 policies today. New ones must reuse the same helpers or permissions silently drift. |
| 10 | **Dead-code archaeology** | Low | ~12 tables are dead but their frontend still compiles. Rule 4 means archiving, not deleting — steady but low-risk. |

### Effort estimate — deliberately rough

| Area | Estimate | Confidence |
|---|---|---|
| Schema + enums + RLS + constraints (new `inv_*`) | 2–3 days | Medium-high — small, clean, greenfield |
| Ledger + state-machine functions | 3–4 days | Medium — the correctness-critical part |
| QC templates + results (schema + UI) | 3–4 days | **Low** — genuinely new behaviour |
| GR rebuild on new spine (re-point Pass 1) | 1–2 days | High — layout already done |
| Remaining operations (delivery, transfer, adjustment, count) | 5–8 days | Low — four documents, mostly unexercised today |
| Config UI re-point (19 pages) | 3–4 days | Medium |
| Barcode/scan (Pass 3) | 3–5 days | Low — least-explored area |
| Cutover, config load, archiving | 2–3 days | Medium |
| **Total** | **~22–33 working days** | Wide by design |

The estimate is wide because four of the eight areas rest on code paths with zero production
rows — they can be read, but have not been seen to run. Treat the low-confidence rows as the
ones most likely to double.

---

## Open decisions carried into Step 2

1. Confirm `products` stays out of scope this pass.
2. Confirm the `inv_` prefix, and the resolution for the colliding legacy function names.
3. Whether coexistence runs old-writable/new-readonly, or a hard freeze at cutover.
