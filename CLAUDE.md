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

## TESTING — a test can pass without exercising what it claims to

This has now happened **three times**, each time going green while proving nothing:

| Pass | The test | Why it was worthless |
|---|---|---|
| 10B | Deferred-trigger success case | Ran inside one SQL transaction, where a `DEFERRABLE INITIALLY DEFERRED` constraint is satisfied. It could never have caught the real failure — a client doing two calls in two transactions. The bug shipped |
| 10B | `product_variant_auto_archive` feature guard | Asserted the "not safe to run yet" refusal, but the call was refused earlier by the `is_admin()` permission check. The guard under test was never reached |
| Pass A | `RESTRICT` on deleting a linked attribute value | The value was also referenced by a variant, so the delete was refused by `product_variant_values_value_matches_attribute`. The assertion checked only `SQLSTATE = '23503'`, so a refusal from an entirely different constraint passed |

**The rule:** assert on the **specific** constraint, function or error identity under test —
never on a generic SQLSTATE or a bare "it was refused". Where a refusal has more than one
possible cause, prove the others are absent.

In practice that means:

- Match the constraint or function **name** in the error text, not just the code.
- If a guard sits behind a permission check, satisfy the permission first so execution
  actually reaches the guard.
- If the mechanism under test only engages at COMMIT, a rolled-back test proves nothing —
  it has to commit, or be proved another way.
- Before trusting a refusal, check what *else* could have produced it. Use a fixture
  nothing else references.

A green suite is not evidence. Evidence is a test that would fail if the thing under test
were removed.

---

## DATABASE FINGERPRINT BASELINE — taken 2026-08-14, after Pass C

Around any applied migration the expected proof is a **before/after fingerprint**: md5
snapshots taken *before* applying and re-run *after*, showing the blast radius was exactly
what was approved. The baseline must be taken **BEFORE** the migration runs — it cannot be
reconstructed afterwards.

**The pre-Pass-C baseline was LOST.** The session that applied Pass C ended on a spend
limit and the editor closed; the baseline lived only in that session's context. Commit
`6f9df26` quotes a constraint fingerprint `b5901cff` and a trigger fingerprint `876e3880`,
but not the SQL that produced them, so those two digests **cannot be reproduced or checked**
and should not be trusted as comparable to anything computed later.

**No attempt was made to reconstruct it.** A fabricated proof is worse than a missing one.
What Pass C can honestly claim instead is inspection, not hashes: the migration body is
3 × `CREATE VIEW` + 3 × `COMMENT ON VIEW` and nothing else — no `ALTER`, `DROP`, `GRANT`
or DML — and the post-state counts match what the commit predicted (views 8 → 11,
functions 211 unchanged, policies 568 unchanged).

**These are the values to diff the NEXT migration against.** Captured 2026-08-14 on a
database with Pass A, B and C applied:

| Part | md5 | Count |
|---|---|---|
| schema, non-`inv_` base tables (`table.column:type:nullable:default`) | `81825307e130975fc64b72e7047a9ab2` | 160 base tables |
| policies, non-`inv_` (`tablename\|policyname\|cmd\|qual\|with_check\|roles`) | `4ed0b8182618a244fd061c91788ed0de` | 568 all schemas / 547 `public` |
| functions (`proname(identity_args)=md5(prosrc)`, all of `public`) | `863b01cfcb6f538ec8ded6ac1fdaf333` | 211 |
| constraints (`relation:conname:contype:def`) | `4a32dc578a4a12d66343f8e8bb5ce083` | 734 |
| triggers, non-internal (`relname:tgname:def`) | `498b81ea024c1441eff67a7e601e4335` | 188 |

The three legacy namesakes, which must stay byte-identical:

| Function | md5 | length |
|---|---|---|
| `inv_save_stock_move` | `d625abaf323a12e55d84c7a4c677ae84` | 3116 |
| `inv_validate_stock_move` | `4160c526a51e51534aa39e52cd9e91b6` | 1143 |
| `inv_delete_stock_move` | `6c37e9aedd167dd2f7c79628342c2cd8` | 135 |

**Record the exact SQL alongside any future digest.** The whole reason `b5901cff` is
useless is that its formula was not written down.

Note also that `supabase_migrations.schema_migrations` stops at `20260725091618`. Passes A,
B and C are absent from the ledger because they were applied with
`supabase db query --linked --file`, which does not record there. That is expected, not
drift — the migration files in `supabase/migrations/` are the record.

---

## INTERNAL TRANSFERS — the landscape, established 2026-08-14

**Three parallel legacy transfer models exist. Only one is live.**

| Model | Tables | Rows | Status |
|---|---|---|---|
| `transfers` + `transfer_lines` | Odoo-shaped picking | 0 / 0 | **Dead.** Never used |
| `internal_movements` + `internal_movement_items` | location→location, has an unused `operation_type_id` | 0 / 0 | **Dead schema, LIVE SCREENS** at `/inventory/internal-movements{,/new,/:id}` |
| `internal_transfer_orders` + `internal_transfer_order_lines` | keyed to `sales_order_id` | **4 / 4** | **LIVE** |
| `inv_operation` kind=`internal` | the new model | 0 | Type `ITEM ESTIMATE` exists, active, never used |

The live ITO rows are `ITO-2627-0002..0005`, all `confirmed`/`completed`, all carrying a
`sales_order_id`. Their `operation_type_id`, `source_location_id` and `dest_location_id` are
**NULL on every row** — bridge columns added toward `inv_` and never populated. The ITO also
drives a *fourth* scan system, `scan_queue` (5 rows) behind `pages/barcode/ScanWorkspace`,
which is separate from `/inventory2/barcode`.

### What an ITO is — V's definition, 2026-08-14

A **location-to-location move of units**, typically picking for a sales order — showroom →
transit/packing, godown → showroom.

| | |
|---|---|
| The operation TYPE carries fixed source and destination | "Showroom → Packing" and "Godown → Showroom" are **separate operation types**, not one type with variable locations |
| Consequence | Transfers are the **first real consumer of `locks_source`**, which has existed on `inv_operation_type` since Step 2 and is read by nothing |
| The sales-order link | A **reference on the document**, not the document's identity. Do **not** model an ITO as a child of a sales order the way legacy `internal_transfer_orders` does |

---

## PLANNED DOCUMENT TYPES — designed, not built

Not known issues. These are shapes the model is expected to grow, recorded so the design is
not re-derived from scratch.

### Return-to-vendor — how rejected stock leaves

**Movement is controlled by WHICH DOCUMENT TYPE is used, not by who is clicking.** This is
consistent with `locks_source` / `locks_destination`, which already constrain operations by
configuration rather than by role.

Rejected and quarantined units do **not** need a supervisor override to move, and no override
mechanism should be built. They leave via a **dedicated operation type** that sends units from
the quarantine/rejected location out to the vendor or factory for repair or replacement. The
unit re-enters stock later through a **normal Goods Receipt** when it comes back.

An override was considered and **explicitly rejected** on 2026-08-14. Do not reintroduce one.

**Two open questions, both business decisions, neither answered:**

1. **Is a returning unit the SAME unit or a NEW one?** A repair returns the same serial; a
   replacement is a new unit with the original written off. These need different handling and
   the choice cannot be inferred from the data.
2. **Does a replacement create a claim or credit against the vendor?** If so it reaches
   **purchasing**, not inventory, and the pass is larger than it looks.

---

## KNOWN ISSUES — deferred, do not fix opportunistically

Recorded so they are not rediscovered as surprises. Each one is deferred **on
purpose**; fixing one is its own approved pass, not a "while I'm here".

### `inv_test_result` has no `operation_id` — `requires_qc` MUST stay false on every non-receipt type, 2026-08-14

**This is a live constraint on configuration, not a someday-problem.** Turning on
`requires_qc` for an internal, outgoing or adjustment type today would silently corrupt
receipt history.

`inv_test_result` is `(stock_item_id, template_id, result, value, notes, attachments,
tested_by, tested_at, seq)`. There is **no `operation_id`**. An inspection is therefore
**unit-scoped, not document-scoped** — it is a permanent fact about the unit, with no record
of which document it was performed on.

`inv_record_qc_results(p_stock_item_id, p_results)` re-derives the unit's status against its
**entire** applicable checklist and marks prior rows not-latest. Run it from a transfer and
it **overwrites the receipt's verdict for that unit**. The Quality segment would then render
receipt-era results on a transfer document with nothing on screen saying they belong to a
different event.

| Decision (V, 2026-08-14) | |
|---|---|
| `requires_qc` on `internal` | **stays false** |
| Quality segment on the transfer page | **not adopted** |
| The eventual fix | Add a nullable `operation_id` to `inv_test_result`, make "latest" per (unit, template, operation), backfill the existing 25 rows to their origin receipt |
| Why it is deferred | It is a schema change to a table with live data, so it gets its own approved pass |

`QualitySegment` already refuses safely: `documentRequiresQc()` returns false and it renders
"not configured to require QC" rather than implying the units passed. **That refusal is the
marker for this issue** — it comes out when `operation_id` lands.

**Do not turn on `requires_qc` for a non-receipt type to "see what happens".** The damage is
to data, and it is not visible on the screen that causes it.

### `product_attribute_values.extra_price` has NO LIVE READER on the attribute path — Pass C applied, 2026-08-14

**This is now fact, not a prediction.** Pass C landed on 2026-08-14 (commits `6f9df26`
migration, `e88f84d`/`0763c7a`/`43a3e11`/`7c9ffb6` frontend) and the repoint is done.

Category-scoped attribute values put the price adjustment on the **category link**:
`product_category_attribute_values.extra_price`, `NOT NULL DEFAULT 0`, with **no fallback**
to the global column. The link row is the whole answer — a fallback would put the global
figure silently back in charge of any link nobody priced, which is the two-sources problem
the change exists to remove.

**What actually happens now.** `listAttributesForProduct()`
(`src/lib/services/inventory/attributes.ts`) overwrites `extraPrice` with the per-category
figure resolved by `product_category_values_resolved` before the value ever reaches the
picker. `CustomizationPicker` was **not** edited to follow it — it still reads
`attribute.values[].extraPrice` at `:96` (sums into `priceAdjustment`) and `:198` (the
`(+₹…)` label), and both now carry the category price. That was deliberate: the picker is
on the SHARED BOUNDARY list, so the repoint happened upstream of it.

**The predicted consequence has arrived.** An uncategorised product now offers **no**
values, so every value reaching the picker arrived through a category link. The global
column therefore has **no live reader at all on the attribute path**.

| Remaining users of the global column | What they do |
|---|---|
| `pages/inventory2/config/AttributeConfigForm.tsx`, `components/inventory/config/AttributesConfig.tsx` | **write** it |
| `listAttributes()` / `saveAttributeValue()` in `services/inventory/attributes.ts` | read/write it for those config editors |
| the `product_customization_options` path | **reads it — a different mechanism entirely** |

**DO NOT DROP IT.** Rule 4 aside, it is still the only price for the
`product_customization_options` path. It is marked superseded in a comment on
`ProductAttributeValue.extraPrice`. Being unread on one path is not the same as being dead.

**Related, and intentional:** `AttributeOption.values[]` in
`services/inventory2/variants.ts` carries `extra_price` and `source_category_name` that
nothing currently renders. That is not dead code — it is the data variant pricing will
need when it surfaces, and the resolver already has it in hand. Leave it.

### `products.category_id` is ON DELETE SET NULL — NOW LIVE, no longer cosmetic, 2026-08-13 / escalated 2026-08-14

**Status changed when Pass C applied.** This entry used to open "today this is cosmetic".
That is no longer true: scoping is now resolved and enforced, so deleting a category leaves
its products with `category_id = NULL`, which means **they can offer no attribute values at
all** — a silent failure of exactly the kind this module refuses everywhere else.

The one mercy is that it is no longer *silent* on screen: the Pass C messaging in
`VariantEditor`, `RequestVariantDialog` and `CustomizationPicker` names "this product has
no category" as the reason. The data damage is still silent, and still unreversed by that.

**RESTRICT is recommended**, deferred to its own pass because it alters an existing FK on a
shared table and Pass A was deliberately additive.

| | |
|---|---|
| Live delete path | `deleteCategory()` in `src/lib/services/inventory/categories.ts:53`, wired through `useDeleteCategory` in `hooks/inventory/config.ts:27` |
| What changes | That path starts failing loudly for a category that has products — which is the intent, but it is a behaviour change to a legacy path |
| Why it is coherent | `product_categories.is_active` already exists, so archive is available as the non-destructive alternative |

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
