# RLS status

_Ground truth as of 2026-07-24._

Earlier audits counted permissive policies by grepping the migration files.
That over-counts: policies get dropped and replaced across 100+ migrations, and
`INSERT` policies store their condition in `with_check`, not `qual`, so they
look permissive to a grep.

The numbers here come from replaying every migration against a real Postgres
and querying `pg_policies` directly:

```sql
SELECT tablename, policyname FROM pg_policies
WHERE schemaname='public' AND cmd IN ('SELECT','ALL') AND qual='true';
```

## Already correctly scoped

These were hardened by earlier RBAC work and are **not** open, contrary to what
`WORKFLOW_AUDIT.md` (2026-06-12) reported:

`sales_orders`, `quotations`, `customers`, `invoices`, `delivery_notes`,
`payments`, `payslips`, `employees`, `crm_contacts`, `crm_companies`,
`crm_opportunities`.

They use the helper predicates `_can_see_all_sales()`,
`is_sales_rep_for_record()`, `has_any_role()`, `is_super_admin()`,
`get_current_employee_id()`. Reuse these rather than writing new predicates.

## Fixed (migration 20260724120300)

Child tables that leaked what their parents protect. Postgres applies a
referenced table's RLS inside a policy's `EXISTS` subquery, so each child now
inherits its parent's scoping — and keeps inheriting it if the parent policy
changes.

| Table | Now gated by |
| --- | --- |
| `invoice_lines` | parent `invoices` |
| `delivery_note_lines` | parent `delivery_notes` |
| `quotation_versions` | parent `quotations` |
| `order_activities` | parent `sales_orders` |
| `subscription_lines` | parent `subscriptions` |
| `subscriptions` | `_can_see_all_sales()` or creator |

Verified with two sales reps and a sales manager: each rep sees only their own
lines, the manager sees both. Before the change a rep could read another rep's
invoice lines despite being unable to open the invoice.

## Remaining — needs a business decision

53 tables still have `USING (true)` on SELECT. They are not all wrong; several
are meant to be readable. Grouped by the decision each one needs.

### Commercially sensitive — probably should be scoped

| Table | Question |
| --- | --- |
| `crm_leads` | Should every authenticated user see the whole lead pipeline? `crm_contacts` and `crm_opportunities` are already scoped, so this is inconsistent. |
| `pricelists`, `pricelist_items` | Customer-specific pricing readable by all staff. |
| `sales_seasonal_promotions`, `sales_loyalty_transactions` | Loyalty history is per-customer. |
| `goods_receipts`, `goods_receipt_lines`, `goods_receipt_serials` | Purchase costs and supplier detail. |
| `payment_accounts` | Bank account names and last-4 digits. |
| `company_settings` | Read by print templates for letterhead — probably fine, but confirm nothing sensitive lives here. |

### Operational — read-open is defensible

`products`, `warehouses`, `warehouse_locations`, `stock_moves`,
`stock_move_lines`, `serial_numbers`, `lots`, `inventory_adjustments`,
`adjustment_lines`, `reorder_rules`, `qc_inspections`, `scan_queue`,
`scan_records`, `correction_qc_cycles`, `departments`, `employee_rosters`,
`attendance_locations`, `import_export_jobs`.

Staff generally need these. Worth confirming writes are restricted even where
reads are not.

### Lookup / configuration — leave read-open

`units_of_measure`, `product_categories`, `product_attributes`,
`product_attribute_values`, `product_attribute_assignments`,
`product_customization_options`, `operation_types`, `leave_types`, `holidays`,
`numbering_sequences`, `numbering_settings`, `tax_slabs`,
`sales_fiscal_positions`, `salary_components`, `crm_tags`, `crm_pipelines`,
`crm_pipeline_stages`.

Note `salary_components` is a catalogue of component *definitions* (Basic, HRA,
PF rules), not per-employee pay — no personal data.

### Blocked on a client change

`app_roles`, `app_role_permissions` — `src/lib/data/rbac.ts` hydrates the
client-side permission cache by reading these directly. Restricting them
requires moving that read behind an RPC first.

### Dead tables

`bom`, `bom_lines`, `work_centers`, `work_orders` (legacy columns),
`work_order_components`, `transfers`, `transfer_lines` belonged to the
manufacturing and transfer subsystems removed in this branch. The tables still
exist. Decide whether to drop them rather than write policies for them.

## Also unenforced

`sales_rep` carries `scope: 'own'` in `src/lib/data/rbac.ts`, and
`is_sales_rep_for_record()` implements it for the tables that use it — but the
UI does not filter by it and several tables above ignore it entirely.

## Reproducing this

The migrations replay against stock Postgres with a small Supabase shim (roles,
`auth.users`, `auth.uid()`, `storage.foldername`, the `supabase_realtime`
publication). 94 of 103 applied cleanly. The failures worth knowing about:

- two migrations reference `public.suppliers`, which no migration creates
- two reference `stock_moves.reference_document_type`, which no migration adds

Both suggest the live database has drifted from this migration history — worth
reconciling before trusting the migrations as the schema's source of truth.
