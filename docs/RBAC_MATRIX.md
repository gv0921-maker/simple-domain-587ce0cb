# GLF ERP — Canonical Role × Permission Matrix

_Phase 8 Batch 1 — source of truth for RLS policy authors._

Legend: **R**=SELECT, **C**=INSERT, **U**=UPDATE, **D**=DELETE, **—**=no access, **own**=scoped to record owned by user, **🚫D**=hard delete forbidden (soft-delete only).

## Roles

| Role | Purpose |
|---|---|
| `super_admin` | Full access, payroll/appraisals owner, only role that can revoke roles. |
| `admin` | Full operational access, no payroll/appraisal writes. |
| `sales_manager` | All sales/CRM data + team approval. |
| `sales_rep` | Own customers/quotations/orders/opportunities. |
| `warehouse_operator` | Full inventory + GR/ITO/counts/write-offs (write-off needs super_admin approval gate). |
| `pos_operator` | POS-only (module not built; role reserved). |
| `accountant` | Invoices/payments/refunds/credit-notes (RW). Payroll READ. |
| `hr_manager` | Employees, attendance, leaves. **No payroll/appraisal writes.** |
| `factory_incharge` | Shop Floor + own factory inventory + assigned work orders. |
| `employee` | Self attendance (today), self leaves, own payslips (if toggle), own chat. |

## Sales / CRM

| Table | super | admin | sales_mgr | sales_rep | accountant | wh_op | hr | factory | employee |
|---|---|---|---|---|---|---|---|---|---|
| `customers` | RCU🚫D | RCU🚫D | RCU🚫D | R(own)C U(own) | R | R | — | — | — |
| `quotations`, `quotation_lines` | RCU🚫D | RCU🚫D | RCU🚫D | R(own)C U(own) | R | — | — | — | — |
| `sales_orders`, `order_lines` | RCU🚫D | RCU🚫D | RCU🚫D | R(own)C U(own) | R | R(for fulfillment) | — | R(for WO link) | — |
| `delivery_notes` | RCU🚫D | RCU🚫D | RCU | R(own) | R | RCU | — | — | — |
| `crm_contacts/companies/opportunities/activities/notes` | RCU🚫D | RCU🚫D | RCU🚫D | R(assigned)C U(assigned) | — | — | — | — | — |

`own` for sales tables = `salesperson_id = get_current_employee_id()`. `assigned` for CRM = `assigned_to = auth.uid()`.

## Invoicing / Finance

| Table | super | admin | sales_mgr | sales_rep | accountant | others |
|---|---|---|---|---|---|---|
| `invoices`, `invoice_lines` | RCU🚫D | RCU🚫D | R | R(own SO) | RCU🚫D | — |
| `payments`, `sales_order_payments` | RCU🚫D | RCU🚫D | R | R(own SO) | RCU🚫D | — |
| `credit_notes`, `refunds`, `credit_note_redemptions` | RCU🚫D | RCU🚫D | R | R(own SO) | RCU🚫D | — |

## Inventory

| Table | super | admin | wh_op | factory | sales_mgr/rep | accountant | hr |
|---|---|---|---|---|---|---|---|
| `products`, `pricelists`, `pricelist_items` | RCU🚫D | RCU🚫D | R | R | R | R | — |
| `warehouses`, `warehouse_locations` | RCU🚫D | RCU🚫D | RCU | R | R | R | — |
| `goods_receipts`, `stock_moves`, `stock_counts`, `transfers`, `internal_movements` | RCU🚫D | RCU🚫D | RCU | R(own factory) | R | R | — |
| `write_off_records` | RCU🚫D | RCU🚫D | C (req. super approval) | — | — | — | — |
| `factory_inventory_items`, `factory_stock_movements` | RCU🚫D | RCU🚫D | R | RCU(own factory) | — | — | — |

## Manufacturing

| Table | super | admin | factory | wh_op | others |
|---|---|---|---|---|---|
| `bom`, `bom_lines` | RCU🚫D | RCU🚫D | R | R | — |
| `work_centers` | RCU🚫D | RCU🚫D | RCU | R | — |
| `work_orders`, `work_order_components` | RCU🚫D | RCU🚫D | RCU(assigned) | R | sales_mgr R |

## HR

| Table | super | admin | hr | sales_mgr / others | employee |
|---|---|---|---|---|---|
| `employees` | RCU🚫D | RCU🚫D | RCU🚫D | R(directory subset) | R(directory subset) U(self-safe fields) |
| `departments` | RCU🚫D | RCU🚫D | RCU | R | R |
| `attendance_sessions` | RCU | RCU | RCU | — | C(today) R(own) |
| `attendance_locations` | RCU | RCU | RCU | — | R |
| `leave_requests`, `leave_balances`, `employee_monthly_leave_allotments` | RCU | RCU | RCU | manager-R for team | C R(own) |
| `employee_work_schedules`, `employee_rosters` | RCU | RCU | RCU | — | R(own) |
| `holidays` | RCU | RCU | RCU | R | R |
| `comp_off_credits` | RCU | RCU | RCU | — | R(own) |

## Payroll / Appraisals (super_admin lock — Phase 7 B4)

| Table | super | accountant | hr | employee |
|---|---|---|---|---|
| `payroll_periods`, `payroll_settings`, `salary_components`, `payslip_components` | RCU🚫D | R | — | — |
| `payslips` | RCU🚫D | R | — | R(own, if `payslip_self_view_enabled`) |
| `employee_advances`, `employee_loans` | RCU | — | R | R(own) |
| `appraisal_*`, `appraisals` | RCU🚫D | — | R | R(own) |

## System / Settings

| Table | super | admin | others |
|---|---|---|---|
| `app_roles`, `app_role_permissions`, `app_user_role_assignments` | RCU🚫D | RC U (no super_admin grant/revoke) | — |
| `numbering_settings`, `numbering_sequences`, `tax_slabs`, `company_settings` | RCU | RCU | R |
| `payment_accounts` | RCU | RCU | accountant RCU |
| `activity_log`, `app_audit_logs`, `crm_audit_logs` | R🚫D🚫U | R🚫D🚫U | C (own action) R (records they can see) |
| `notifications` | R(own)🚫D | R(own)🚫D | R(own) U(own read flag) |

## Cross-cutting rules

1. **Hard delete is forbidden** on any table marked 🚫D above — enforce with `FOR DELETE USING (false)`.
2. **Scope helper**: `sales_rep` ownership uses `salesperson_id = public.get_current_employee_id()`. CRM uses `assigned_to = auth.uid()`.
3. **HR ≠ payroll**: hr_manager has zero payroll writes. Verified Phase 7 B4.
4. **Employee self-service**: only specific safe employee columns (avatar_url, phone, address) may be self-updated. Enforced via column-level guard in Batch 3.
5. **Audit immutability**: `activity_log`, `app_audit_logs`, `crm_audit_logs` are append-only.

## Implementation pointers

- Helper functions live in `public` schema, SECURITY DEFINER, `SET search_path = public`, STABLE.
- Always use `public.has_any_role(auth.uid(), ARRAY[...])` — never re-query `user_roles` inline (recursion risk).
- DELETE-blocking policy template: `CREATE POLICY "<table>_no_delete" ON public.<table> FOR DELETE USING (false);`
---

## UI gating in place (Phase 8 Batch 2)

The following route guards are enforced in `src/App.tsx`. Component-level
gating uses `<RoleGate>` (see `src/components/auth/RoleGate.tsx`) and the
`useRoleCheck()` hook (see `src/hooks/auth/useRoleCheck.ts`) as the single
source of truth for capability flags.

| Route prefix                       | Required roles                       |
| ---------------------------------- | ------------------------------------ |
| `/payroll/*`                       | super_admin                          |
| `/appraisals/*`                    | super_admin                          |
| `/settings/payroll`                | super_admin                          |
| `/settings/company`                | super_admin                          |
| `/settings/numbering`              | super_admin                          |
| `/settings/payment-accounts`       | super_admin                          |
| `/settings/work-schedules`         | super_admin                          |
| `/settings/holidays`               | super_admin                          |
| `/settings/audit`, `/audit-logs`   | super_admin                          |
| `/settings/vendors`                | admin, super_admin                   |
| `/leave/admin/*`                   | super_admin                          |
| `/attendance/admin/*`              | admin, super_admin, hr_manager       |
| `/shop-floor/*`                    | factory_incharge, admin, super_admin |

Capabilities exposed by `useRoleCheck()` (consume these from `<RoleGate capability=… />`
or directly in components):

`isSuperAdmin`, `isAdminOrSuper`, `isAdminOrHR`, `isFactoryIncharge`,
`canAccessPayroll`, `canAccessAppraisals`, `canAccessAuditLogs`,
`canManageSettings`, `canManagePayrollSettings`, `canManageCompanySettings`,
`canManageNumbering`, `canManageHolidays`, `canManageWorkSchedules`,
`canManagePaymentAccounts`, `canManageVendors`, `canAccessShopFloor`,
`canApproveLeave`, `canVoidInvoice`, `canVoidCreditNote`,
`canProcessRefund`, `canApproveReturn`, `canApproveWriteOff`,
`canApproveSkipStockCount`, `canOverrideAdvanceGate`.

---

## Phase 8 Batch 3 — Final state

### New data-integrity primitives
- **Soft-delete columns**: `employees.is_active/terminated_at/termination_reason`, `customers.is_active/archived_at/archive_reason`, `products.is_active/discontinued_at/discontinuation_reason`. Lists should filter `is_active=true` by default and offer an admin-only "Show archived" toggle.
- **`employees.auth_user_id`**: links an employee row to its `auth.users` account. Populated by the `create-employee-with-login` edge function.
- **`factory_user_assignments(user_id, factory_id, is_active)`** + helper `public.is_factory_user_for(factory_id)`. Used by `work_orders` RLS to scope `factory_incharge` users to their assigned factories.

### Audit triggers (field-level diffs into `activity_log`)
`payslips`, `salary_components`, `contracts`, `refunds`, `credit_notes`, `app_user_role_assignments`, `crm_leads`, `crm_opportunities`, `holidays`, `payroll_settings`, `company_settings`.

### Cascade policy
- Sensitive parents (employees, customers, products, warehouses, sales_orders) → child FKs are now `ON DELETE RESTRICT`.
- Combined with the DELETE-deny RLS policies from Batch 1, hard deletion of these records is blocked at both the policy and constraint layer.

### Role-check consolidation
- `useRoleCheck()` is the single source of truth for capability flags.
- `useIsSuperAdmin()` is retained as a thin deprecated wrapper (`{ isAdmin: isAdminOrSuper, loading }`).
- Prefer named capability flags (e.g. `canVoidInvoice`, `canApproveReturn`, `canManagePayrollSettings`) over raw role checks in new code.

### Edge functions
- `create-employee-with-login` — super_admin / hr_manager only. Creates auth user with `password_must_change` metadata, inserts employee row with `auth_user_id`, assigns role, returns temporary credentials for one-time display.
