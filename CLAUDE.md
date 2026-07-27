# CLAUDE.md — Permanent working rules for this repository

This is a React + Supabase ERP for a furniture business, migrated out of Lovable.
We are doing a **clean re-scaffold: the Supabase backend is KEPT as-is; the frontend
is rebuilt module by module.**

These rules apply to **every session, without exception**. They are not defaults to
be weighed against convenience — they are constraints. If a rule blocks the task,
stop and ask; do not work around it.

---

## ABSOLUTE RULES

### 1. NEVER modify the CRM module

CRM is finished and off-limits: not its frontend, not its backend, not its database
tables, not the shared code it depends on.

**If a change would touch anything in the "CRM — PROTECTED" inventory below, or any
file in the "SHARED BOUNDARY" list, STOP and ask first.** Describe what you want to
change and why, and wait for an explicit go-ahead.

This includes indirect breakage. Renaming an export, changing a shared type, moving a
file, or altering a function signature that CRM imports counts as modifying CRM even
if you never open a file under `src/pages/crm/`.

### 2. NEVER modify the database without explicit approval

No schema changes, no new/edited RPCs, no view changes, no trigger changes, no RLS
changes — unless you have shown me the **exact SQL** and I have said yes.

The backend is considered **proven and correct**. When frontend and backend disagree,
the frontend is wrong. Fix the frontend.

If a rebuilt module seems to need a schema change, that is a signal to stop and ask,
not a licence to write a migration.

> Migration mechanics: `supabase db push` is blocked by Lovable-era drift. Migrations
> are applied with `supabase db query --linked --file <path>` — and only after approval.

### 3. Every change is a small, reviewable commit

One logical change per commit, with a clear message explaining *why*. Never a giant
sweep. Never bundle a refactor with a behaviour change. If you find yourself touching
twenty files for one goal, stop and split it.

Prefer many small commits over one large one. I need to be able to read each commit
on its own and revert it on its own.

### 4. NEVER delete anything

When replacing old code, **move it aside so it can be restored** — rename it
(`Foo.legacy.tsx`) or move it under `src/_archive/`. Do not delete files, exports,
routes, or database objects.

Deletion happens **only** when I explicitly say a module is signed off.

This applies to "obviously dead" code too. If it looks dead, archive it and tell me
why you think it's dead — don't remove it.

### 5. Surface every error — never swallow it

When something breaks or you make a mistake, **say so plainly and show the actual
error text**. Never:

- catch an error and continue as if it worked
- report a task complete when a step failed or was skipped
- summarise an error instead of quoting it
- hide a failing test, type error, or build error

If a command fails, paste the real output. If you got something wrong earlier, correct
it directly. A surfaced error is useful; a swallowed one costs hours.

The codebase already encodes this rule at the data layer (`src/App.tsx` — global
TanStack Query `MutationCache`/`QueryCache` `onError` handlers surface Postgres/RPC
messages verbatim). Keep that behaviour in anything you rebuild.

---

## CRM — PROTECTED INVENTORY

### Frontend files owned by CRM (do not touch)

```
src/pages/crm/                        (8 files)
  CRMOverview.tsx  CRMPipeline.tsx  CRMContactsList.tsx  CRMContactDetail.tsx
  ContactForm.tsx  LeadsPage.tsx  OpportunityForm.tsx  OpportunityDetail.tsx

src/components/crm/                   (9 files)
  CRMDashboard.tsx  CRMKanbanBoard.tsx  CRMPipelineListView.tsx
  CRMActivityTimeline.tsx  CRMFormDialogs.tsx  CRMImportExport.tsx
  CRMSearchDropdown.tsx  ContactSearchCombobox.tsx  PipelineToolbar.tsx

src/hooks/crm/                        (index.ts, useCRMQueries.ts)
src/hooks/useCRMPermissions.ts

src/lib/crm/                          (types.ts, fieldMask.ts, audit.ts, csvExport.ts, ics.ts)
src/lib/data/crm-supabase.ts          ← the CRM data layer
src/lib/services/crm.ts               ← CRM service barrel
src/lib/navigation/crm.ts

src/lib/filters/modules/crmContacts.ts
src/lib/filters/modules/crmOpportunities.ts
src/lib/importExport/modules/crmContacts.ts
src/lib/importExport/modules/crmOpportunities.ts

src/pages/settings/CRMPipelinesSettings.tsx   ← CRM config that lives under settings/
src/test/crm/crm-permissions.test.ts
```

### CRM routes (do not change or re-point)

`/crm`, `/crm/pipeline`, `/crm/contacts`, `/crm/contacts/new`, `/crm/contacts/:id`,
`/crm/contacts/:id/edit`, `/crm/opportunities/new`, `/crm/opportunities/:id`,
`/crm/leads`, `/crm/reports`, `/crm/reports/:reportKey`, `/dashboards/crm`

Also protected: the Sales→CRM redirects in `src/App.tsx`
(`/sales/customers*` → `/crm/contacts*`).

### CRM database objects (do not touch)

**Tables**
```
crm_contacts  crm_companies  crm_opportunities  crm_leads
crm_activities  crm_notes  crm_tags
crm_pipelines  crm_pipeline_stages  crm_audit_logs
```

**Trigger / function on CRM tables**
```
trg_sync_customer_from_contact  ON crm_contacts   (AFTER INSERT OR UPDATE)
public.sync_customer_from_contact()               one-way sync crm_contacts → customers
public.get_or_create_customer_for_contact(uuid)   resolver RPC
```

**Edge functions**
```
supabase/functions/crm-api/
supabase/functions/crm-openapi/
```

### `customers` — special status

`public.customers` is **not** a CRM table, but every row is auto-populated from
`crm_contacts` by `trg_sync_customer_from_contact`. Treat `customers` as
**read-mostly**: sales documents may reference `customers.id`, but nothing outside CRM
may write the CRM-derived columns or the `crm_contact_id` link.

---

## SHARED BOUNDARY — touch only with permission

These files are **not** CRM-owned, but they read CRM data, import CRM code, or are
imported *by* CRM. Changing them can break CRM. Ask before editing any of them.

**Non-CRM code that depends on CRM:**

| File | CRM dependency |
|---|---|
| `src/lib/services/types.ts` | re-exports CRM types (`Contact`, `Opportunity`, `Activity`, `Note`, `Pipeline`, `CRMStats`) |
| `src/lib/reports/registry.ts` | 3 CRM reports query `crm_opportunities`, `crm_activities` |
| `src/lib/services/dashboard/api.ts` | reads `crm_opportunities`, `crm_contacts`, `crm_activities` |
| `src/components/layout/GlobalSearch.tsx` | `useContacts`, `useOpportunities` |
| `src/components/sales/CustomerSelector.tsx` | wraps CRM's `ContactSearchCombobox`, `useContacts` |
| `src/pages/sales/SalesOrderForm.tsx` | **writes CRM** — imports `getContact`, `saveContact` from `crm-supabase` |
| `src/pages/sales/QuotationForm.tsx` | contact population helpers |
| `src/pages/sales/SalesOverview.tsx`, `SalesReports.tsx` | `useContacts` |
| `src/lib/sales/loyaltyService.ts` | CRM `Contact` type |

**⚠ Reverse dependency — CRM imports these, but they live under `sales/`:**

```
src/lib/sales/customerCrmSync.ts     ← imported by src/pages/crm/ContactForm.tsx
src/lib/sales/contactPopulation.ts   ← imported by src/pages/crm/ContactForm.tsx
src/hooks/sales/useContactAutoPopulate.ts
```

**Rebuilding the Sales module can break CRM through these three files.** They must be
treated as protected even though their path says `sales`. When Sales is rebuilt, these
either stay exactly as they are, or the change is approved explicitly.

---

## IN SCOPE FOR REBUILD

Everything not listed above. See `docs/REBUILD_MAP.md` for the full module map,
per-module database dependencies, and shared-code inventory.

---

## Working agreement

- **Read before writing.** This codebase is large (144 tables, 121 RPCs, ~300 source
  files). Assume there is context you haven't seen yet.
- **The database is the spec.** `src/integrations/supabase/types.ts` is generated from
  the live schema — trust it over the code's assumptions.
- **No unrequested scope.** Rebuild the module asked for. Don't "while I'm here" into
  neighbouring modules.
- **Verify, don't assume.** If you claim something works, say how you checked. If you
  didn't check, say that.
