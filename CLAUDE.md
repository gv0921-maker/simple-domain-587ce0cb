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

---

## KNOWN ISSUES — deferred, do not fix opportunistically

Recorded so they are not rediscovered as surprises. Each one is deferred **on
purpose**; fixing one is its own approved pass, not a "while I'm here".

### A new REQUIRED QC check retroactively un-completes past inspections — INTENDED, warned, 2026-08-13

**This is correct behaviour, not a bug.** It is recorded here because it is genuinely
surprising, and someone reading the code later should find the reasoning rather than
rediscover it as a mystery.

`inv_record_qc_results` does not evaluate only the results being submitted. It
re-derives the unit's status against the **entire applicable checklist** every time it
runs:

```
WHEN v_req_failed > 0          THEN 'rejected'
WHEN v_req_passed < v_required THEN 'quarantined'   -- incomplete
WHEN v_adv_failed > 0          THEN 'attention'
ELSE                                'ok'
```

Add a **required** template and `v_required` rises for every applicable unit while
`v_req_passed` does not, so a previously complete inspection becomes incomplete and the
unit drops to `quarantined`.

**The delay is the surprising part.** Nothing changes when the check is saved. The status
is only rewritten the *next time QC is recorded for that unit* — possibly days later, by
someone with no connection to the config change.

**Advisory checks carry no such risk**, and the same CASE is why: `v_adv_failed` counts
`NOT is_required AND l.result IS FALSE`. An unanswered advisory has no latest row, so
`l.result` is NULL, `NULL IS FALSE` is false, and it contributes nothing. An advisory can
only move a unit to `attention` by being actively failed; it can never un-pass one.
`destroyed` and `lost` units are exempt — the RPC returns their status before the CASE.

**What was built instead of a fix:** `RequiredCheckWarning` warns and asks for
confirmation on every path that can put a required check into the applicable set —
creating one, promoting an advisory one, un-archiving from the edit form, and the Restore
button on the config list. It shows how many units are affected and how many are
currently OK. It never blocks, and **no RPC was changed**. Archiving needs no warning:
removing a check can only make an inspection more complete.

If the RPC is ever changed here, this warning is the thing to revisit.

### Orphaned QC attachment uploads (Inventory 2) — found Pass 6, FIXED Pass 11, 2026-08-13

**The cause is fixed.** `QcRunner` now holds the chosen `File` in memory and uploads
only inside `submit()`, after pre-checking the same `requires_attachment` rule the RPC
enforces. An abandoned dialog, a killed tab or a retaken photo now uploads **nothing**.
Verified live: choosing a photo and closing the dialog left the bucket at 6 objects;
submitting uploaded exactly 1, and it is referenced by the recorded result.

A narrow window remains and is worth knowing: the RPC needs the attachment URLs in its
payload, so a strict "upload only after the RPC succeeds" is impossible — the attachment
is part of what the RPC validates. If a submit uploads and is then refused for a reason
the client cannot anticipate (a permission error, a race), those objects are orphaned.
The client-side pre-check removes the common rejection; it cannot remove all of them.

**The one existing orphan below is NOT removed** — deleting a stored object is a rule-4
deletion and it goes at the go-live wipe.

---

**Original entry, kept for the record:**

### Orphaned QC attachment uploads (Inventory 2) — found Pass 6, 2026-08-12

`uploadQcAttachment()` in `src/lib/services/inventory2/qc.ts` puts the file in the
`qc-images` bucket under `inv2/<stock_item_id>/` **as soon as the inspector picks
it**, before `inv_record_qc_results` is called. If the submission is then abandoned
— the dialog is closed, the tab dies, the RPC rejects the checklist — the file
stays in the bucket with nothing referencing it. Nothing cleans it up, and nothing
detects it: the only way to find one is to diff bucket objects against the URLs in
`inv_test_result.attachments`.

There is one such orphan today, from the Pass 6 crash:
`inv2/8d2751c2-5f45-42fc-a7bb-575cfb248bb9/1786473217403-PASS6-PREVIEW-condition.png`
(450 bytes, referenced by zero test results).

**Deliberately not fixed.** It is a few hundred bytes of preview litter and the
bucket is wiped at go-live, so cleanup buys nothing today. It matters at real
volume, where inspectors retake photos routinely and every abandoned attempt is a
permanent orphan.

Worth knowing when it *is* addressed: deleting a stored object is a rule-4 deletion
and needs sign-off, so the likely fix is upload-on-submit (hold the File in memory,
upload only once the RPC succeeds) rather than a sweeper that deletes.

### `products.track_serials` is obsolete, and Inventory 2 has no non-serial path — found Pass 9, 2026-08-12

The flag is not merely inconsistent, it is **outside the Inventory 2 model entirely**.
`inv_receive_serial` never reads it — no RPC in `public` references the column at all —
and `inv_stock_item.serial` is `NOT NULL` with a `length(trim(serial)) > 0` check. Every
unit that enters Inventory 2 stock is serial-identified by construction. That is why the
one product in the database carries 24 serial-identified units while its `track_serials`
reads `false`: nothing consulted the flag on the way in.

**The consequence is the part that matters.** Inventory 2 currently has **no path for
non-serial stock**. Consumables — screws, polish, packaging, glue — cannot be modelled
at all, because there is no way to receive a quantity rather than a set of identified
units. This is a modelling gap, not a display bug.

`src/pages/inventory2/ProductForm.tsx` therefore shows `track_serials` read-only with a
note, rather than offering a toggle that would change nothing.

Note that `src/components/sales/ReserveStockDialog.tsx:51-52` **already works around the
flag** — it computes `usesSerials = availableSerials.length > 0 || product?.trackSerials`
with a comment saying the flag "is not consistently set". Someone hit this before and
routed around it.

**Deliberately not fixed.** Resolving it means one of two passes, both larger than a
patch: retire the column alongside `stock_on_hand`, or build a genuine quantity-tracked
path for consumables. Do not add a `track_serials` toggle to any screen in the meantime.

### `useProducts()` has no `is_active` filter — archived products still appear in Sales — found Pass 9, 2026-08-12

`getProductsAsync()` in `src/lib/services/inventory/api.ts:368` selects every product with
no `is_active` filter, and `useProducts()` (`src/hooks/inventory/index.ts:16`) feeds the
pickers on Sales order lines, invoices, pricelists, subscriptions, promotions, work orders
and labels.

**Archiving a product therefore does not hide it anywhere.** This matters because archiving
is the *only* deactivation available: RLS policy `products_no_delete` is `USING(false)` and
37 foreign keys reference `products.id`, so products genuinely cannot be deleted. Setting
`is_active = false` records intent and changes nothing a salesperson sees.

**Deliberately not fixed.** The change is Sales-side — filtering those pickers is a Sales
decision about which products may still be sold, not an Inventory one. Adding the filter
from an inventory pass would silently remove options from live Sales screens.

### The attribute service cannot move under `inventory2/` — found Pass 10C, 2026-08-13

The config pages moved to `/inventory2/config` in the consolidation pass, but their
service and hooks did not, because **legacy still imports them heavily**:

| Module | Legacy importers |
|---|---|
| `src/lib/services/inventory/attributes.ts` | `components/inventory/config/AttributesConfig.tsx` (the legacy shadcn editor), plus the hooks barrel below |
| `src/hooks/inventory/config.ts` | `pages/inventory/GoodsReceiptDetail.tsx`, `GoodsReceiptWizard.tsx`, `InventoryOverview.tsx`, `InventoryOperationsOverview.tsx`, five `components/inventory/config/*` components, `_archive/`, and — **importantly — `components/sales/CustomizationPicker.tsx`** |

`hooks/inventory/config.ts` is also a barrel exporting the category, UoM and
operation-type hooks, so moving it wholesale would break ten importers at once.

**The consequence to know about:** the new module reads the same data under a
different TanStack query key (`inv2VariantKeys.assigned(productId)`) from the one
the legacy hooks invalidate (`['product-attribute-assignments', productId]`). Saving
an assignment through the legacy hook therefore leaves the new module's copy stale —
the variant editor said "no attributes assigned" immediately after they were.

`src/components/inventory2/AttributeAssignment.tsx` reconciles the two key spaces by
hand, in one place, with a comment saying so. **That reconciliation is the marker for
this issue** — when the service finally moves, it comes out.

**Deliberately deferred.** Moving the service means either updating ten legacy
importers (a legacy-module change, outside an Inventory 2 pass) or splitting the
barrel. Both are their own approved pass. Until then, anything in Inventory 2 that
writes attribute assignments must invalidate `inv2VariantKeys` as well.
