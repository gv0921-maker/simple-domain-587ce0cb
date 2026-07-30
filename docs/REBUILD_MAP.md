# Frontend Rebuild Map

Survey of the codebase as it stands at branch `rescaffold` (base commit `aa275c1`).
No code was changed to produce this document.

**Scale:** ~300 source files under `src/`, 144 tables, 7 views, 121 RPCs, 116 migrations,
5 edge functions.

---

## A. Module map

### A1. Business modules

| Module | Pages | Components | Hooks | Services / data |
|---|---|---|---|---|
| **CRM** 🔒 | `pages/crm/` (8) | `components/crm/` (9) | `hooks/crm/` (2), `hooks/useCRMPermissions.ts` | `lib/data/crm-supabase.ts`, `lib/services/crm.ts`, `lib/crm/` (5) |
| **Inventory** | `pages/inventory/` (37) + `setup/` | `components/inventory/` (7), `components/products/` | `hooks/inventory/` (17), `hooks/products/` | `lib/services/inventory/` (19), `lib/data/inventory/`, `lib/services/products/` |
| **Barcode** | `pages/barcode/` (4) | `components/barcode/` (2) | `hooks/barcode/` | `lib/services/barcode/`, `lib/barcode/` |
| **Sales** | `pages/sales/` (13) | `components/sales/` (17) | `hooks/sales/` (6) | `lib/services/sales/` (7), `lib/data/sales/`, `lib/sales/` |
| **Invoicing** | `pages/invoicing/` (7) | `components/invoicing/` (2) | `hooks/invoicing/` (2) | `lib/services/invoicing/` |
| **Manufacturing** | `pages/manufacturing/` (4) | — | `hooks/manufacturing/` | `lib/services/manufacturing/` (2) |
| **Shop Floor / Factory** | `pages/shopfloor/` (3) | — | `hooks/shopfloor/`, `hooks/factory-inventory/` | `lib/services/shopfloor/`, `lib/services/factory-inventory/` |
| **QC** | (embedded in Inventory/Returns) | `components/qc/` (2) | `hooks/qc/` | `lib/services/qc/` (2) |
| **Returns** | `pages/returns/` (3) | `components/returns/` (1) | `hooks/returns/` (2) | `lib/services/returns/` (2) |
| **Credit Notes** | `pages/credit-notes/` (2) | — | `hooks/credit-notes/` | `lib/services/creditNotes/` |
| **Refunds** | `pages/refunds/` (2) | — | `hooks/refunds/` | `lib/services/refunds/` |
| **Vendor Orders** | `pages/vendor-orders/` (3) | — | `hooks/vendor-orders/`, `hooks/vendors/` | `lib/services/vendor-orders/`, `lib/services/vendors/` |
| **HR / Employees** | `pages/employees/` (10) | — | `hooks/hr/` (8) | `lib/services/hr/` (12) |
| **Attendance** | `pages/attendance/` (10) | — | (`hooks/hr/`) | (`lib/services/hr/`) |
| **Leave** | `pages/leave/` (11), `pages/work-schedule/` (2) | — | (`hooks/hr/`) | (`lib/services/hr/`) |
| **Payroll** | `pages/payroll/` (9) | — | (`hooks/hr/`) | `lib/payroll/` |
| **Appraisals** | `pages/appraisals/` (11) | — | (`hooks/hr/`) | (`lib/services/hr/`) |
| **Chat** | `pages/chat/` (5) | `components/chat/` (14) | `hooks/chat/` | `lib/services/chat/` |
| **Dashboards** | `pages/dashboards/` (9) | `components/dashboard/` (7) | `hooks/dashboard/` | `lib/services/dashboard/` |
| **Reports** | `pages/reports/` (4) | `components/reports/` (1) | `hooks/reports/` | `lib/reports/` |
| **Settings / Admin** | `pages/settings/` (18), `pages/admin/` (1) | `components/customization/` (3) | `hooks/settings/`, `hooks/companySettings/`, `hooks/numbering/` | `lib/services/settings/`, `lib/services/companySettings/`, `lib/services/numbering/`, `lib/customization/` |
| **Notifications** | `pages/notifications/` (1) | — | `hooks/notifications/` | `lib/services/notifications/`, `lib/notifications/` |
| **Auth** | `pages/auth/` (1) | `components/auth/` (2) | `hooks/auth/` | `contexts/AuthContext.tsx` |
| **Calendar** | `pages/calendar/` (1) | — | — | — |
| **Print** | `pages/print/` (1) | `components/print/` (20) | — | `lib/print/` |

🔒 = protected, see `CLAUDE.md`.

### A2. Cross-cutting shared code

Everything here is consumed by **many** modules. Changing it is a cross-module change —
plan it as its own commit, and check the CRM boundary first.

| Area | Files | Notes |
|---|---|---|
| **Design system** | `components/ui/` (52) | shadcn/ui primitives. Foundation of everything. |
| **App shell** | `App.tsx`, `components/layout/` (6), `components/ProtectedRoute.tsx`, `components/SuperAdminRoute.tsx`, `components/ErrorBoundary.tsx`, `components/auth/RouteGuard.tsx` | Routing + guards. `App.tsx` is one 595-line route table for all modules. |
| **Supabase client** | `integrations/supabase/client.ts`, `types.ts` (10,521 lines, generated) | Single source of schema truth. |
| **Navigation registry** | `lib/navigation/` (18 files, one per module) | Sidebar/menu definitions. |
| **Filters** | `lib/filters/` + `lib/filters/modules/` , `components/filters/` (3) | Per-module filter schemas; 2 are CRM's. |
| **Import/Export** | `lib/importExport/` + `modules/`, `components/importExport/` (3) | Registry pattern; 2 modules are CRM's. Backed by `functions/import-data`. |
| **Reports registry** | `lib/reports/registry.ts` | **Single file** holding every report for every module, incl. 3 CRM reports. High-contention. |
| **Print framework** | `lib/print/`, `components/print/` (20), `pages/print/PrintRoute.tsx` | Universal `/print/:documentType/:documentId`. |
| **Contexts** | `contexts/` — Auth, Customization, Accessibility | |
| **Forms / shared** | `components/forms/` (4), `components/shared/` (3), `components/modules/` (1), `components/icons/` | |
| **PWA** | `lib/pwa/`, `components/pwa/` (2) | |
| **Service barrel** | `lib/services/types.ts` | Re-exports CRM types — boundary file. |

---

## B. Database dependencies per module

Derived from `.from('…')` / `.rpc('…')` calls in each module's pages, components, hooks
and services.

### CRM 🔒
- **Tables:** `crm_contacts`, `crm_companies`, `crm_opportunities`, `crm_leads`, `crm_activities`, `crm_notes`, `crm_tags`, `crm_pipelines`, `crm_pipeline_stages`, `crm_audit_logs`
- **RPCs:** `get_or_create_customer_for_contact`
- **Trigger:** `trg_sync_customer_from_contact` on `crm_contacts` → writes `customers`
- **Edge functions:** `crm-api`, `crm-openapi`

### Inventory
- **Tables:** `products`, `product_categories`, `product_attributes`, `product_attribute_values`, `product_attribute_assignments`, `warehouses`, `warehouse_locations`, `stock_moves`, `stock_move_lines`, `stock_reservations`, `serial_numbers`, `lots`, `units_of_measure`, `operation_types`, `inventory_adjustments`, `adjustment_lines`, `reorder_rules`, `stock_counts`, `stock_count_items`, `write_off_records`, `write_off_items`, `internal_movements`, `internal_movement_items`, `internal_transfer_orders`, `delivery_notes`, `goods_receipts`, `goods_receipt_lines`, `goods_receipt_serials`, `correction_orders`, `correction_order_items`, `correction_order_refunds`, `correction_qc_cycles`, `qc_inspections`, `activity_log`, `notifications`, `scan_queue`, `sales_orders`, `order_lines`, `invoices`, `work_orders`, `user_roles`
- **Views:** `v_available_serials`, `v_stock_summary`
- **RPCs:** `inv_save_stock_move`, `inv_validate_stock_move`, `inv_delete_stock_move`, `inv_approve_adjustment`, `reserve_quantity`, `reserve_serials`, `release_reservations`, `save_serial_number`, `update_serial_status`, `generate_serials_for_gr_line`, `get_product_stock_breakdown`, `initialize_stock_count`, `reconcile_stock_count`, `complete_stock_count`, `approve_count_skip`, `is_count_required_this_month`, `approve_write_off`, `cancel_write_off`, `complete_internal_movement`, `complete_pick_to_transit`, `complete_delivery_with_qc`, `complete_gr_line_qc`, `record_gr_item_qc`, `complete_correction_qc_cycle`, `close_correction_order`, `create_ito_from_so`, `suggest_ito_for_so`, `complete_ito_with_qc`, `check_so_ready_to_invoice`
- Largest module by far: 37 pages, 19 services, 17 hooks.

### Barcode
- **Tables:** `scan_queue`, `scan_records`, `label_prints`, `serial_counters` (via services)
- **RPCs:** `record_scan`, `complete_scan_queue`, `allocate_serial_numbers`

### Sales
- **Tables:** `sales_orders`, `quotations`, `quotation_lines`, `quotation_versions`, `order_lines`, `order_activities`, `sales_order_payments`, `subscriptions`, `subscription_lines`, `pricelists`, `pricelist_items`, `sales_fiscal_positions`, `sales_seasonal_promotions`, `sales_loyalty_transactions`, `customers`, `payment_accounts`, `delivery_notes`, `delivery_note_lines`, `invoices`, `serial_numbers`, `goods_receipt_serials`, `warehouse_locations`, `user_roles`
- **RPCs:** `calculate_so_advance_percent`, `check_advance_gate`, `get_sales_order_payment_summary`, `get_so_invoice_summary`, `get_invoice_delivery_summary`, `create_partial_invoice`, `create_partial_delivery_note`, `confirm_delivery`, `validate_invoice_type_against_so`, `sync_sales_order_paid_amount`, `check_so_closure_ready`, `is_sales_rep_for_record`, `_can_see_all_sales`, `portal_get_quotation`, `portal_list_quotations`, `portal_list_sales_orders`, `portal_update_quotation_status`, `portal_resolve_customer`, **`get_or_create_customer_for_contact`** ⚠ CRM boundary

### Invoicing
- **Tables:** `invoices`, `invoice_lines`, `payments`, `sales_orders`
- **RPCs:** (consumes Sales' invoice RPCs)

### Manufacturing
- **Tables:** `work_orders`, `work_order_components`, `work_order_bom_entries`, `bom`, `bom_lines`, `work_centers`, `wo_notifications`, `order_lines`, `sales_orders`, `employees`, `user_roles`
- **RPCs:** `place_work_order`, `approve_work_order`, `reject_work_order`, `cancel_work_order`

### Shop Floor / Factory Inventory
- **Tables:** `work_orders`, `work_order_bom_entries`, `factory_inventory_items`, `factory_stock_movements`, `factory_user_assignments`
- **RPCs:** `start_work`, `start_polishing`, `complete_factory_work`, `enter_bom`, `adjust_factory_stock`, `is_factory_user_for`, `get_factory_recipients`

### QC
- **Tables:** `qc_inspections`, `correction_qc_cycles`, `delivery_qc` ⚠, `goods_receipt_qc` ⚠
- **RPCs:** `record_gr_item_qc`, `record_return_qc`, `complete_delivery_with_qc`, `complete_gr_line_qc`
- ⚠ See "Open questions" below — these two tables are referenced in code but exist in
  neither `types.ts` nor any migration.

### Returns / Exchanges
- **Tables:** `return_requests`, `return_request_items`, `exchanges`, `order_lines`, `products`, `invoices`, `delivery_note_lines`, `goods_receipt_serials`, `sales_order_payments`
- **RPCs:** `create_return_request`, `validate_return_eligibility`, `approve_return_request`, `reject_return_request`, `complete_return_request`, `record_return_qc`, `apply_stock_action`, `process_refund_resolution`, `process_credit_note_resolution`, `process_exchange_resolution`

### Credit Notes / Refunds
- **Tables:** `credit_notes`, `credit_note_redemptions`, `refunds`
- **RPCs:** `redeem_credit_note`, `void_credit_note`, `expire_credit_notes`

### Vendor Orders
- **Tables:** `vendor_orders`, `vendor_order_lines`, `vendors`, `suppliers`, `goods_receipts`, `order_lines`
- **RPCs:** `place_vendor_order`, `approve_vendor_order`, `cancel_vendor_order`, `validate_so_linked_eta`

### HR (Employees / Attendance / Leave / Payroll / Appraisals)
- **Tables:** `employees`, `departments`, `contracts`, `attendance_sessions`, `attendance_locations`, `employee_rosters`, `employee_work_schedules`, `work_schedules`, `holidays`, `leave_requests`, `leave_types`, `leave_balances`, `leave_approval_log`, `employee_leave_entitlements`, `employee_monthly_leave_allotments`, `comp_off_credits`, `payroll_periods`, `payroll_settings`, `payslips`, `payslip_components`, `salary_components`, `tax_slabs`, `employee_loans`, `employee_advances`, `appraisals`, `appraisal_cycles`, `appraisal_criteria`, `appraisal_goals`, `appraisal_ratings`, `appraisal_templates`, `appraisal_attachments`
- **RPCs:** `get_employee_leave_balance`, `get_employee_schedule_for_date`, `calculate_attendance_metrics`, `bulk_set_monthly_allotments`, `assign_sunday_duty`, `get_unified_calendar`, `appraisal_user_can_access`, `is_manager_of`, `is_reviewer_for`, `is_employee_self`, `get_current_employee_id`, `payslip_self_view_enabled`, `is_admin_or_hr`, `get_hr_recipients`
- **Edge function:** `create-employee-with-login`

### Chat
- **Tables:** `chat_channels`, `chat_channel_members`, `chat_messages`, `chat_message_attachments`, `chat_message_mentions`, `chat_message_reads`, `chat_notifications`; reads `employees`, `customers`, `products`, `invoices`, `quotations`, `sales_orders`, `work_orders` for entity linking
- **RPCs:** `is_chat_channel_member`, `is_chat_channel_admin`

### Dashboards ⚠ CRM boundary
- **Tables:** `crm_opportunities`, `crm_contacts`, `crm_activities` ⚠, `customers`, `sales_orders`, `quotations`, `order_activities`, `invoices`, `delivery_notes`, `stock_moves`, `products`, `work_orders`, `employees`, `contracts`, `attendance_sessions`, `leave_requests`, `leave_balances`, `payslips`, `appraisals`, `chat_notifications`
- **RPCs:** `get_dashboard_role`

### Reports ⚠ CRM boundary
- `lib/reports/registry.ts` queries across **all** modules including `crm_opportunities`
  and `crm_activities`. Tables: `saved_reports`, `scheduled_reports` + ad-hoc reads.

### Settings / Admin / RBAC
- **Tables:** `app_roles`, `app_role_permissions`, `app_user_role_assignments`, `app_audit_logs`, `user_roles`, `company_settings`, `payment_accounts`, `numbering_settings`, `numbering_sequences`, `import_export_jobs`, `user_saved_filters`
- **RPCs:** `has_role`, `has_any_role`, `is_admin`, `is_admin_or_super`, `is_app_admin`, `is_super_admin`, `is_assigned_or_admin`, `can_write_inventory`, `get_users_with_role`, `ensure_user_has_at_least_one_role`, `insert_audit_log`, `log_activity`, `get_activity_log_with_users`, `generate_document_number`, `preview_next_document_number`, `get_current_fy_label`, `set_user_default_filter`, `set_system_default_filter`
- **Edge function:** `list-app-users`

### Notifications
- **Tables:** `notifications`, `notification_preferences`
- **RPCs:** `create_app_notification`, `broadcast_app_notification`, `mark_notification_read`, `mark_all_notifications_read`, `get_workflow_recipients`, `get_warehouse_recipients`, `get_factory_recipients`, `get_hr_recipients`

---

## C. Protected vs in scope

### 🔒 PROTECTED — CRM (do not touch without asking)

**Frontend:** `pages/crm/`, `components/crm/`, `hooks/crm/`, `hooks/useCRMPermissions.ts`,
`lib/crm/`, `lib/data/crm-supabase.ts`, `lib/services/crm.ts`, `lib/navigation/crm.ts`,
`lib/filters/modules/crm*.ts`, `lib/importExport/modules/crm*.ts`,
`pages/settings/CRMPipelinesSettings.tsx`, `test/crm/`

**Database:** the ten `crm_*` tables, `sync_customer_from_contact()` +
`trg_sync_customer_from_contact`, `get_or_create_customer_for_contact()`

**Edge functions:** `crm-api`, `crm-openapi`

### ⚠ SHARED BOUNDARY — ask before editing

Non-CRM files that depend on CRM:

- `lib/services/types.ts` — re-exports CRM types
- `lib/reports/registry.ts` — 3 CRM reports
- `lib/services/dashboard/api.ts` — reads 3 CRM tables
- `components/layout/GlobalSearch.tsx`
- `components/sales/CustomerSelector.tsx`
- `pages/sales/SalesOrderForm.tsx` — **writes** `crm_contacts` via `saveContact`
- `pages/sales/QuotationForm.tsx`, `SalesOverview.tsx`, `SalesReports.tsx`
- `lib/sales/loyaltyService.ts`

**Reverse dependency — CRM imports code that lives under `sales/`:**

- `lib/sales/customerCrmSync.ts` ← imported by `pages/crm/ContactForm.tsx`
- `lib/sales/contactPopulation.ts` ← imported by `pages/crm/ContactForm.tsx`
- `hooks/sales/useContactAutoPopulate.ts`

This is the sharpest risk in the whole rebuild: **the Sales module cannot be rebuilt
naively without breaking CRM.** Plan Sales around these three files explicitly.

`customers` is a shared table auto-synced from `crm_contacts` by trigger — read-mostly
for everything outside CRM.

### ✅ IN SCOPE for rebuild

Inventory, Barcode, Sales (with the boundary care above), Invoicing, Manufacturing,
Shop Floor / Factory Inventory, QC, Returns, Credit Notes, Refunds, Vendor Orders,
HR (Employees / Attendance / Leave / Payroll / Appraisals), Chat, Dashboards, Reports,
Settings / Admin / RBAC, Notifications, Auth, Calendar, Print, and the shared
app shell / design system.

### Suggested rebuild order

Dependency-driven, lowest-risk first:

1. **App shell + design system** — routing, guards, layout, `components/ui/`
2. **Inventory** — the foundation everything else reads (products, stock, warehouses)
3. **Barcode** — thin layer on Inventory
4. **Vendor Orders → Goods Receipts** — inbound flow
5. **Sales** — ⚠ CRM boundary; plan the three `lib/sales/` files first
6. **Invoicing → Payments → Credit Notes → Refunds** — financial chain
7. **Manufacturing → Shop Floor → Factory Inventory**
8. **Returns / Exchanges / QC** — depends on Sales + Inventory
9. **HR cluster** — largely self-contained, can move in parallel
10. **Chat, Notifications, Dashboards, Reports** — cross-cutting consumers, do last

---

## Open questions / risks to resolve before coding

1. ~~**`goods_receipt_qc` and `delivery_qc` tables.**~~ **ANSWERED — broken dead code.**

   Verified read-only against the linked project (`mdtwvuiakvxoqvksemyt`) on
   2026-07-27: a `pg_class`/`pg_namespace` lookup across all schemas returned **zero
   rows** for both names. A control sweep for `%qc%` relations correctly returned
   `qc_inspections`, `correction_qc_cycles`, `goods_receipts` and `delivery_notes`,
   so the probe was sound. `types.ts` and the migration folder agree: **neither table
   exists.**

   **The live QC feature runs on `qc_inspections` and `correction_qc_cycles`.** The six
   call sites below are dead code that fails at runtime, and should be taken out of the
   live code path during the **Inventory rebuild** (archived, not deleted — rule 4):

   | File | Function | Behaviour |
   |---|---|---|
   | `lib/services/qc/api.ts:100` | `createGoodsReceiptQCAsync` | throws |
   | `lib/services/qc/api.ts:110` | `getQCByReferenceAsync` | throws |
   | `lib/services/qc/api.ts:121` | `getQCByProductAsync` | throws |
   | `lib/services/qc/delivery.ts:60` | `getLatestDeliveryQCAsync` | throws |
   | `lib/services/qc/delivery.ts:83` | `createDeliveryQCAsync` | throws |
   | `lib/services/inventory/deliveryNotes.ts:176` | delivery-note QC block | ⚠ **swallows the error** |

   The last one destructures `{ data: qcRow }` and discards `error`, so the QC section
   of a delivery note renders silently empty instead of reporting failure — a live
   violation of rule 5. Fix that behaviour in the rebuild, not just the table reference.

   Still unverified: whether these features were ever reachable in the UI, and whether
   the `delivery-qc-images` storage bucket referenced by `qc/delivery.ts` exists.

2. **`App.tsx` is a single 595-line route table** covering every module. Rebuilding
   module-by-module means repeatedly editing one shared file. Worth deciding up front
   whether to split it into per-module route modules — that is itself a change to
   shared code that touches the CRM routes.

3. **`lib/reports/registry.ts` is one file for all modules' reports**, including CRM's.
   Same contention problem as `App.tsx`.

4. **Migration drift — quantified: 14 files unaccounted for.**

   `supabase db push` is blocked; migrations are applied with
   `supabase db query --linked --file`. Measured 2026-07-27:
   **`supabase_migrations.schema_migrations` holds 102 rows against 116 local
   migration files — 14 local files have no ledger entry.** Which 14, and whether
   their contents are nonetheless live in the database, is **not yet established**.

   **Investigate before any future backend or schema change — not now.** Nothing in
   the frontend rebuild depends on resolving it, and touching it means touching the
   backend (rule 2).

   ⚠ **Ledger lookups need care.** Lovable stamps `version` with the *apply* time and
   preserves the original filename in `name`, so the two differ by a few seconds:
   `20260725091614_37b61667-…sql` is recorded under `version = '20260725091618'`.
   Matching on `version` alone produces false "pending" results. **Match on `name`.**

   Worked example — that 195-line migration was confirmed **applied** two ways: its
   filename appears verbatim in the ledger's `name` column, and every object it creates
   exists live (`serial_counters` table with 1 seeded row; functions
   `allocate_serial_numbers`, `record_scan`, `complete_scan_queue`,
   `enforce_gr_discrepancy_approval`; trigger `trg_enforce_gr_discrepancy_approval`
   on `goods_receipts`).

   Assume the live schema may lead the migration folder — `types.ts` is the more
   reliable reference.

5. **Stale root-level audit docs** (`BUILD_COMPLETE.md`, `DEAD_CODE_REMOVED.md`,
   `INVENTORY_PLAN.md`, `RBAC_AUDIT.md`, `SETTINGS_AUDIT.md`,
   `SETTINGS_DEAD_CODE_REMOVED.md`, `WORKFLOW_AUDIT.md`) predate this re-scaffold and
   may contradict it. Left in place per the no-delete rule; treat as historical.

---

## Legacy pages pending removal

Rebuilt config pages are live and the Inventory **Setup** menu now points at them
(`src/lib/navigation.ts`). The legacy pages below are **still routed in `App.tsx`** and
reachable by direct URL — bypassed by the menu, not removed. Per rule 4 they are
deleted only when the module is explicitly signed off.

| Legacy route | Legacy file | Superseded by |
| --- | --- | --- |
| `/inventory/warehouses` | `src/pages/inventory/WarehousesList.tsx` | `/inventory/config/warehouses` |
| `/inventory/locations` | `src/pages/inventory/WarehouseLocations.tsx` | `/inventory/config/locations` |
| `/inventory/setup/operation-types` | `src/pages/inventory/setup/InventorySetupOperationTypes.tsx` → `src/components/inventory/config/OperationTypesConfig.tsx` | `/inventory/config/operation-types` |
| `/settings/numbering` | `src/pages/settings/NumberingSettings.tsx` | `/inventory/config/numbering` |
| `/inventory/setup/categories` | `src/pages/inventory/setup/InventorySetupCategories.tsx` → `src/components/inventory/config/CategoriesConfig.tsx` | `/inventory/config/categories` |

At sign-off, deleting each of these means: removing the route + lazy import from
`App.tsx`, and archiving the page file under `src/_archive/` rather than deleting it
outright.

Numbering is a partial exception: the rebuilt page is additive in the Inventory
**Setup** menu (that menu had no Numbering link before), while `SETTINGS_NAV` still
lists `/settings/numbering` at `src/lib/navigation/settings.ts:42`. Both menu paths are
live until you decide whether the Settings entry should also be repointed. Both routes
are Super Admin-gated.

Note the rebuilt Numbering page cannot fully replace the legacy one's remit: prefixes
are a hardcoded `CASE` in `generate_document_number` and `preview_next_document_number`,
not columns, so they are surfaced read-only. Making them configurable needs an approved
migration plus a rewrite of both functions — the numbering path 9 triggers and ~20
functions depend on.

Product Categories are **organisational only** — nothing reads the table yet. The product
form's category dropdown is a hardcoded array (`CATEGORIES` in `ProductDetail.tsx`),
`products.category` is free text, and `products.category_id` is NULL on every row. Making
categories real means repointing the product form, which pulls Products into scope and
needs a decision on the `category` text vs `category_id` FK duality. Deliberately deferred.

Still pointing at their existing pages, to be repointed as each is rebuilt:
Settings, Product Attributes, Units & Packagings, Reorder Rules, Adjustments.
