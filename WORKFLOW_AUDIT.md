# GLF ERP — Comprehensive Workflow & Quality Audit

_Generated: 2026-06-12. Read-only audit; no code changes were made._

**Severity legend**

- **CRITICAL** — data-loss, security, or fully broken workflow
- **HIGH** — significant gap users will hit regularly
- **MEDIUM** — workflow gap affecting efficiency
- **LOW** — cosmetic / minor UX

---

## Executive Summary — Top 12 Critical Findings

| # | Severity | Area | Finding |
|---|---|---|---|
| E1 | 🔴 CRITICAL | Sales / Payments | Any partial payment flips `sales_orders.status` to `paid`; `payment_status='partial'` is never written. `paid_amount` is overwritten (not accumulated) per `RecordPaymentDialog` save. |
| E2 | 🔴 CRITICAL | Sales / Cancellation | Cancelling an order only sets status; **no reservations released, no stock moves cancelled, no invoice voided**. The confirm dialog's promise ("release reserved stock") is false. |
| E3 | 🔴 CRITICAL | Manufacturing | Completing a work order does **not** consume BOM raw materials and does **not** receive the finished good into stock. The ledger is silently inconsistent. |
| E4 | 🔴 CRITICAL | Inventory / Transfers | Inter-warehouse transfer "Validate" button has **no `onClick`**. No stock moves are created; `stock_on_hand` never updates. |
| E5 | 🔴 CRITICAL | HR | Creating an employee never creates an `auth.users` login. `UsersManagement` "Add User" `handleSave` is a no-op (no Supabase call). The whole onboarding chain is manual. |
| E6 | 🔴 CRITICAL | HR | Employee hard-delete cascades to `payslips`, `attendance_sessions`, `leave_requests`, `contracts` — destroys legally retained records. |
| E7 | 🔴 CRITICAL | RBAC | `admin` role has no `settings` module permission, so `canAccessRoute('/settings/*')` returns false — admins are locked out of Settings. |
| E8 | 🔴 CRITICAL | RBAC / RLS | `sales_rep` `scope: 'own'` is unenforced. RLS on `sales_orders`, `quotations`, `customers`, and all `crm_*` tables is `USING (true)` — every authenticated user can read every record. |
| E9 | 🔴 CRITICAL | Inventory | No negative-stock prevention: no DB `CHECK (stock_on_hand >= 0)`, no guard in `inv_validate_stock_move` / `inv_approve_adjustment` / app layer. |
| E10 | 🔴 CRITICAL | Sales / Routes | "Edit" item on `QuotationsList` navigates to `/sales/quotations/:id/edit` which is **not registered** — 404. |
| E11 | 🔴 CRITICAL | Pages | `src/pages/plm/PLMOverview.tsx` and `src/pages/sales/FiscalPositionsPage.tsx` exist but have **no route in App.tsx and no link anywhere**. Entirely dead code paths. |
| E12 | 🔴 CRITICAL | Audit / Compliance | `payslips`, `salary_components`, `contracts`, `invoices`, `price_approval_requests` have **no audit trail**. CRM `create` operations are unaudited (`logCRM` fires only on update/delete). |

---

## Section 1 — Broken or Dead UI Elements

### CRITICAL

1. **Sales › QuotationsList — "Edit" dropdown** (`src/pages/sales/QuotationsList.tsx:411`)
   Navigates to `/sales/quotations/${id}/edit` — route is not registered in `src/App.tsx`. Only `/sales/quotations/:id` exists. Clicking 404s.
2. **PLM module entirely unreachable** — `src/pages/plm/PLMOverview.tsx` has no `<Route>` in `App.tsx` and no `<Link>`/`navigate()` anywhere. Dead module.
3. **Sales › FiscalPositionsPage entirely unreachable** — `src/pages/sales/FiscalPositionsPage.tsx` has no route and no inbound link.
4. **Inventory navigation typos** — Several navigations target `/inventory/barcode` and `/inventory/barcode-labels` and `/inventory/products/new`, but the actual routes are `/barcode`, `/barcode/labels`, and `/inventory/products/:id` (no `/new` route — relying on `:id === 'new'` semantics that `ProductDetail` may or may not handle).

### HIGH

5. **Inventory › ProductsList "Duplicate" menu item** (`src/pages/inventory/ProductsList.tsx:272`) — `onClick={(e) => e.stopPropagation()}`. No duplication logic. Dead button.
6. **CRM › OpportunityDetail chatter buttons** (`src/pages/crm/OpportunityDetail.tsx:983, 995, 1068`) — `"Send message"`, `"Log note"`, `"Schedule"` write to local component state only; no API persistence.
7. **Inventory › TransferDetail "Validate" button** (`src/pages/inventory/TransferDetail.tsx:109`) — `<Button>Validate</Button>` has **no `onClick`**. The promised state transition never happens. (Also see §3, §4.)
8. **Reorder Rules › "Create Order" button** (`src/pages/inventory/ReorderRules.tsx:151`) inside triggered-rules alert card — no `onClick`. Reorder rules detect low stock but never create POs/transfers.
9. **Inventory › BarcodeOperations** (`src/pages/inventory/BarcodeOperations.tsx:241`) — Empty-state scan branch executes `{}`; no toast/error when no matching move is found.

### MEDIUM

10. **CRM › CRMContactsList three-dot menu** (`src/pages/crm/CRMContactsList.tsx:344`) — Only renders "Delete" if `canDeleteContacts`. Without permission, opening shows an empty dropdown.
11. **Leave › AdminLeaveTypes inline row inputs** (`src/pages/leave/AdminLeaveTypes.tsx:25–30`) — Uses uncontrolled `<Input defaultValue>` with `onBlur` save; failures are silent and value snaps back without feedback.
12. **Form fields with empty placeholders policy** — applied globally; not a bug per project memory. Noted for accuracy only.

### Tabs / Empty content

13. `SalesReports.tsx` and `CustomizationSettings.tsx` tabs verified non-empty (cleared). No other empty `<TabsContent>` blocks found.

---

## Section 2 — Sales Workflow Gaps

### CRITICAL

1. **Partial payment not modeled** (`src/components/sales/RecordPaymentDialog.tsx:59–103`) — `update sales_orders set status='paid', paid_amount=amount` is hard-coded regardless of amount vs `grandTotal`. `payment_status='partial'` is never written anywhere.
2. **Multiple payments per order** — Schema (`payments` table, migration `20260608201302`) supports it; UI overwrites `paid_amount` on each new payment instead of summing. Previous payments are silently lost from the order record. `PaymentsList` is a global list; no per-order payment history component exists.
3. **Cancellation has no side-effects** (`SalesOrderForm.tsx:357`, `SalesOrdersList.tsx:118–158`) — Plain `UPDATE sales_orders SET status='cancelled'`. Reservations not released (`rg cancel.*reservation` returns zero hits). Stock moves not cancelled. Invoice not voided. The alert dialog (`SalesOrdersList.tsx:498`) text "release any reserved stock" is **false**.

### HIGH

4. **No `rejected` quotation status** — `QuotationStatus` (`src/lib/data/sales/types.ts:3`) has only `draft|sent|accepted|converted|expired|cancelled`. The "Reject" button (`QuotationForm.tsx:411–419`) writes `cancelled`, indistinguishable from internal cancel.
5. **Partial delivery UI missing** — `delivered_qty` column exists on `order_lines` (`api.ts:227`) and `SalesOrder.deliveryStatus` supports `'partial'`, but `OrderLinesTable.tsx` has no per-line delivered-qty input. `DeliveryNoteDetail` stores `products_json` blob, not linked to `order_lines.id`, so the ledger cannot reconcile partial deliveries.
6. **No credit-note / refund / invoice adjustment** — `src/pages/invoicing/` has no `CreditNoteForm`, no `credit_notes` table. Invoice CHECK constraint (`20260609115823`) has no `'credit_note'` status. Once invoiced, there is no documented unwind path.
7. **Orphan-state risk: paid order without invoice** — `sales_orders.invoice_id` is nullable; `RecordPaymentDialog` never writes it. Order can sit `status='paid', invoice_id=NULL` indefinitely.

### MEDIUM

8. **No order edit after `confirmed`** (`SalesOrderForm.tsx:362`: `isEditable = status==='estimate'||'draft'`) — No admin override / unlock mode. Customers cannot request late changes without cancel+re-create.
9. **QC failure has no rework branch** (`PreDeliveryQCSection.tsx:151–160`) — On fail, banner shows but the QC form re-renders below it. A second submission with `status='passed'` will silently override the gate (the hook returns one record). No structured rework / re-QC state.
10. **Quotation sent-tracking incomplete** — `sent_at` exists (`api.ts:866`); **`sent_by` and `viewed_at` are missing**. The portal `portal_get_quotation` RPC does not record a view timestamp. `accepted_at` not set on portal accept either.
11. **Customer portal accept** (`CustomerPortalQuotation.tsx:68–84`) — Works, but: decline writes `cancelled` (not `rejected`), no email/webhook on accept, anyone with the URL+token can act (no second-factor / customer identity verification beyond opaque token).

---

## Section 3 — Inventory Edge Cases

### CRITICAL

1. **Insufficient-stock sales orders not blocked** — `useOrderReservationBadge` (`SalesOrderForm.tsx:363`) only colors the form border yellow on `'partial'`. There is no save-time guard. `ReserveStockDialog` is not even rendered from `SalesOrderForm`. Backorder columns (`back_order_of`) exist in DB but no code writes them.
2. **Inter-warehouse transfers do not move stock** — `TransferForm` saves to `transfers`/`transfer_lines` only. `TransferDetail.tsx:109` "Validate" button has no `onClick`. `handleStatusChange` (`:61–76`) only updates `transfers.state` — never calls `validateStockMoveAsync`, never creates outgoing/incoming `stock_moves`, never touches `products.stock_on_hand` for either warehouse.
3. **Negative stock prevention missing at every layer** — `products.stock_on_hand numeric(14,3) NOT NULL DEFAULT 0` (`20260608105411:17`) has no `CHECK (>= 0)`. `inv_validate_stock_move` (`:323–368`) and `inv_approve_adjustment` (`:373–415`) apply differences with no floor check. No app-layer guard.

### HIGH

4. **RMA / customer return UI missing** — DB supports `operation_type='return'` (`20260608105411:114`) and the validator handles sign correctly (`:350`). `writeSalesReturnContext` (`src/lib/sales/contactPopulation.ts:74`) only pre-populates a new SO form. No `ReturnForm.tsx`, no RMA list, no UI ever writes a return stock move.
5. **Damage / loss / write-off partially reachable** — `REASON_LABELS` in `InventoryAdjustments.tsx:56–63` includes `damage`, `theft`, `expiry`. But the "New Adjustment" button (`:111`) navigates to `/inventory/barcode` (count workflow). `MobileCountScreen.tsx:63` hard-codes `reason: 'count'`. There is no form path that lets a user post a "damage" adjustment.

### MEDIUM

6. **Physical count works but lacks resume / per-line review** — `MobileCountScreen` computes diff vs `theoreticalQty` and submits `pending_approval`; `inv_approve_adjustment` correctly posts. But `BarcodeOperations.tsx:159` never passes `adjustmentId`, so in-progress counts cannot be resumed.

---

## Section 4 — Manufacturing → Inventory Link

### CRITICAL

1. **No raw-material consumption on WO complete** — `WorkOrderForm.tsx:108–119` (`handleCompleteWithQC`) calls `saveWO.mutateAsync(updated)` which is `saveWorkOrder` in `src/lib/services/manufacturing/api.ts:217–252`. The function UPSERTs `work_orders` only. It does not read `bom_lines`, does not insert into `stock_moves` / `stock_move_lines`, and does not decrement `products.stock_on_hand`. The `work_order_components` table (`20260608140249:99`) is never populated. **Should live in** a new `consumeWorkOrderMaterials(workOrderId)` in `src/lib/services/manufacturing/api.ts`, called from `saveWorkOrder` when state transitions to `'done'`.
2. **No finished-good receipt on WO complete** — Same path. No positive `stock_moves` row is created for the produced product. **Should live in** the same function (or sibling `receiveWorkOrderOutput`).
3. **No availability guard on WO completion** — `handleCompleteWithQC` only checks `state !== 'done' && !== 'cancelled'`. Neither the app nor any DB trigger blocks completion when components are short. The "Required Components" panel (`WorkOrderForm.tsx:154–164`) is display-only.

### HIGH

4. **Reorder rules are advisory only** — `checkReorderRulesAsync` (`api.ts:725–738`) returns a list. `ReorderRules.tsx:66–73` only shows a toast count. `lastTriggered` field is mapped but never written. The in-card **"Create Order"** button is dead (Section 1 #8). No scheduled job / Edge Function fires PO or transfer creation.

---

## Section 5 — HR Onboarding Lifecycle

### CRITICAL

1. **No auth user created with employee** — `EmployeeForm.tsx:88` → `createMut` → `employees` insert only. No `supabase.auth.admin.createUser()` anywhere in `src/lib/services/hr/api.ts` or `src/lib/data/hr.ts`. `employees.user_id` is nullable with no FK to `auth.users`.
2. **UsersManagement "Add User" is fake** — `src/pages/settings/UsersManagement.tsx:248` `handleSave` closes the dialog without any Supabase call. The user list is read from hardcoded `DEMO_USERS` (`src/lib/storage.ts:58`). There is no path that creates an `auth.users` row and links it to `employees.user_id`.
3. **Employee termination leaves dangling references** — Setting `employees.status='terminated'` (`EmployeeForm.tsx:195–198`) is a column update only. Pending `leave_requests`, active `appraisals`, `chat_channel_members` rows persist. `employees.reports_to` continues pointing at terminated managers. There is no `salesperson_id` column on `quotations`/`sales_orders` (so reassignment isn't possible — but the data model also lacks this attribution entirely).

### HIGH

4. **No probation auto-transition** — `contracts.probation_period_months` exists (`20260609201107:149`); no `pg_cron`, trigger, or Edge Function transitions `contract_type` from `probation` → `permanent`.
5. **No activation gate** — Once `user_id` is linked, login depends on Supabase email-confirm setting only. No app-level "HR must activate" flag exists.

---

## Section 6 — Cross-Module Data Integrity

### CRITICAL

1. **Employee hard-delete cascades to payroll** — `payslips.employee_id`, `payslip_components`, `contracts`, `attendance_sessions`, `leave_requests`, `leave_balances`, `appraisal_submissions` all `ON DELETE CASCADE`. A single delete wipes years of compliance-mandated records. `employees` has no soft-delete column.
2. **Warehouse hard-delete cascades to stock** — `warehouse_locations` (`20260608105411:53`) and `stock_quants` (`:202`) cascade. Deleting a warehouse silently destroys all quantity-on-hand records. `stock_moves.source/destination_location_id` RESTRICT will block but only because the locations themselves were deleted first by the cascade — leaving inconsistent partial states possible if the FKs are loosened later.

### HIGH

3. **Customer delete is `SET NULL` with no UI warning** — `sales_orders.customer_id`, `quotations.customer_id`, `invoices.customer_id`, `subscriptions.customer_id`, `delivery_notes.customer_id` all `ON DELETE SET NULL`. RLS permits delete for `sales_manager|admin|super_admin`. No confirmation dialog warns about orphaning. Deleted customers cannot be traced from their old orders.
4. **Product delete inconsistent** — Some refs RESTRICT (`stock_move_lines`, `transfer_lines`, `bom_components`, `reorder_rules`, `lot_serials`), others SET NULL (`order_lines`, `quotation_lines`). UI throws raw Postgres FK errors via toast — no graceful prevention. No `is_active` soft-delete in `ProductsList`.

### MEDIUM

5. **Soft- vs hard-delete inconsistencies** —
   - Soft (`is_active` toggle): `salary_components`, `attendance_locations`.
   - Status field (cosmetic soft-delete only): `employees` (`active/terminated/resigned`).
   - Soft-archived: `chat_channels.is_archived`.
   - Hard-delete (RLS-gated): `customers`, `products`, `warehouses`, `departments`, `contracts` (via cascade).
   No project-wide convention; deletion semantics differ per module.

---

## Section 7 — Notification Gaps

### Persisted notifications exist for (chat only):

| Event | Trigger | Source |
|---|---|---|
| `@mention` in chat | `chat_notify_on_mention()` | `20260610140025:89` |
| Thread reply | `chat_notify_on_thread_reply()` | `:106` |
| Pin | `chat_notify_on_pin()` | `:124` |
| Channel member added | `chat_notify_on_member_added()` | `:141` |

### HIGH — No persisted notification for any of these business events

`use-toast` is fired client-side at action time only; the recipient sees nothing unless they were on screen.

- New CRM lead created
- Quotation sent to customer
- Customer accepts/rejects quotation (no notify to salesperson)
- Sales order created
- Payment received (no notify to accountant / salesperson)
- Invoice generated (no notify to customer)
- Delivery marked complete
- Stock falls below reorder threshold
- Work order completed
- Leave applied / approved / rejected (applicant + manager + HR — none persisted)
- Price approval requested / decided

`src/lib/crm/notifications.ts` is client-side reminder logic for CRM activities; does **not** write to `chat_notifications` or any persisted table.

### Silent failures noted

- `RecordPaymentDialog` errors caught and toasted; partial-payment misclassification (E1) happens with no error at all.
- `AdminLeaveTypes` row save (uncontrolled inputs) — no error feedback on failure.
- Cancel order — toast says "Cancelled"; reservations/inventory side-effects are silently skipped.

---

## Section 8 — Permissions and Role Gaps

### Role → modules (from `src/lib/data/rbac.ts` `DEFAULT_ROLES`)

| Role | Modules | Notes |
|---|---|---|
| `super_admin` | All + `settings` (admin) | OK |
| `admin` | All EXCEPT `settings` | 🔴 CRITICAL: cannot open `/settings/*` because `canAccessRoute` requires `settings` permission. |
| `sales_manager` | sales/admin, crm/admin, inventory/view, reports/view-dept | OK |
| `sales_rep` | sales/edit/own, crm/edit/own, inventory/view | 🔴 `scope: 'own'` is **not enforced** by RLS (`USING (true)` on `sales_orders`, `quotations`, `customers`, `crm_*`). Rep can read all reps' data. |
| `warehouse_operator` | inventory/edit, manufacturing/view | No PO module exists — cannot perform receiving (Section 4 / Section 8 #3). |
| `hr_manager` | hr/admin, reports/view-dept | OK |
| `accountant` | accounting/admin, sales/view, inventory/view, reports/view-all | OK |
| `pos_operator` | pos/edit/own, inventory/view | POS module not built. |
| `employee` | **NOT DEFINED in `DEFAULT_ROLES`** | Users with only an employee row but no assigned role get zero permissions and see only `/`. |

### CRITICAL findings

1. **Admin locked out of Settings** (above).
2. **`sales_rep` scope unenforced** — RLS uses `USING (true)` for SELECT on `sales_orders`, `quotations`, `customers` (`20260608130023:26,67,145`) and all `crm_*` tables (`20260422052034:286–313`). UI queries do not filter by `created_by = auth.uid()`.
3. **No PO module** — `warehouse_operator` cannot receive goods because purchase orders are not implemented. Only references to `'purchase_order'` are icon mappings (`chat/ResourceCard.tsx:15`, `chat/api.ts:451`, `qc/api.ts:3`).
4. **No `employee` role definition** — Frontline employees with only an `employees` row but no `app_user_role_assignments` get no nav.

### MEDIUM

5. **`pos_operator` role exists but POS is unbuilt** — Permission grants access to nonexistent pages.
6. **Commission visibility** — No commission table exists; `SalesRepDashboard` reads aggregate sales orders that all reps can already see (per #2). No per-rep isolation.

---

## Section 9 — Audit Trail Completeness

### Two parallel audit systems (fragmentation risk)

- `crm_audit_logs` — written by `src/lib/crm/audit.ts` `logCRM()` (client-side)
- `app_audit_logs` — written by `src/lib/data/rbac.ts addAuditLog()` and `src/lib/services/settings/api.ts:208`

**No DB-side AFTER-triggers populate either table.** All audit writes are client-initiated, fire-and-forget, and skippable by API consumers that bypass the UI.

### Tables WITH audit coverage (call-site evidence)

`crm_contacts`, `crm_companies`, `crm_opportunities`, `crm_activities`, `crm_notes`, `crm_pipelines` (update/delete only — **not create**); `quotations` and `subscriptions→sales_orders` via `src/lib/sales/automation.ts:18,97`; `app_user_role_assignments` on role change.

### Tables with NO audit (severity-ranked)

| Severity | Table | Risk |
|---|---|---|
| 🔴 CRITICAL | `payslips`, `payslip_components` | Finalized payroll edits untracked |
| 🔴 CRITICAL | `invoices` | Financial document changes untracked |
| 🟠 HIGH | `salary_components` | Pay structure changes untracked |
| 🟠 HIGH | `contracts` | Salary/employment-term changes untracked |
| 🟠 HIGH | `employees` (create/update/terminate) | HR record changes untracked |
| 🟠 HIGH | `price_approval_requests` | Price override decisions untracked |
| 🟠 HIGH | `app_user_role_assignments` delete path | Revocations may not be logged |
| 🟡 MEDIUM | `leave_requests` approve/reject | |
| 🟡 MEDIUM | `attendance_sessions` admin adjustments | |
| 🟡 MEDIUM | `appraisal_submissions` | |
| 🟡 MEDIUM | `customers`, `products` | |
| 🟡 MEDIUM | `warehouses`, `warehouse_locations` | |
| 🟡 MEDIUM | All CRM **create** operations (`crm_contacts`, `crm_companies`, `crm_opportunities`, etc.) — confirmed by `src/test/crm/crm-audit.test.ts:16` |

---

## Section 10 — Workflow Hand-offs Missing

### CRITICAL

1. **Cancel handoff to inventory / invoicing missing** — see §2.3.
2. **Work-order → stock-ledger handoff missing** — see §4.1–§4.3.
3. **Transfer → stock-ledger handoff missing** — see §3.2.
4. **Payment → invoice link not enforced** — see §2.7.

### HIGH

5. **Quotation sent-tracking partial** — `sent_at` present; `sent_by`, `viewed_at` missing.
6. **Customer portal accept → internal notify missing** — RPC updates status only; no notification to salesperson / SO auto-creation linkage.
7. **QC failure → rework state missing** — see §2.9.
8. **Delivery note `in_transit` state missing** — CHECK constraint allows only `draft|confirmed|delivered` (`20260609115823:25`). No `driver_id`, `driver_name`, `eta`, `actual_delivery_at` columns. Only `delivery_date` exists.
9. **Invoice payment follow-up automation missing** — No overdue scanner, no reminder email/notification job. `invoices.status='overdue'` is allowed by CHECK constraint but no code path sets it.
10. **Reorder-rule → PO/transfer creation missing** — see §4.4.

---

## Appendix — File / Symbol Index

- Routes: `src/App.tsx`
- RBAC matrix: `src/lib/data/rbac.ts` (DEFAULT_ROLES, canAccessRoute)
- Route guard: `src/components/ProtectedRoute.tsx`
- Sales API: `src/lib/services/sales/api.ts`
- Sales automation: `src/lib/sales/automation.ts`
- Inventory API: `src/lib/services/inventory/api.ts`
- Inventory RPCs: `supabase/migrations/20260608105411_*.sql` (`inv_validate_stock_move`, `inv_approve_adjustment`)
- Manufacturing API: `src/lib/services/manufacturing/api.ts`
- HR API: `src/lib/services/hr/api.ts`
- Chat notification triggers: `supabase/migrations/20260610140025_*.sql`
- Audit helpers: `src/lib/crm/audit.ts`, `src/lib/sales/audit.ts`, `src/lib/data/rbac.ts addAuditLog`

_End of audit. No source code was modified._