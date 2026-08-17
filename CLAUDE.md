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

## DATABASE FINGERPRINT BASELINE — re-taken 2026-08-15, after the transfer line RPCs

Around any applied migration the expected proof is a **before/after fingerprint**: md5
snapshots taken *before* applying and re-run *after*, showing the blast radius was exactly
what was approved. The baseline must be taken **BEFORE** the migration runs — it cannot be
reconstructed afterwards.

### The Pass C digests were DELETED, not superseded

They are gone from this file on purpose. They were unreproducible, and **two competing sets
of numbers is worse than one missing set** — someone eventually diffs against the wrong one
and reports a false match or a false alarm.

What was established before deleting them, on 2026-08-15:

| | |
|---|---|
| The **counts** were recovered exactly | 160 base tables, 568 policies across all schemas, 547 in `public`. So the Pass C set was computed over **everything**, and its "non-`inv_`" label was simply wrong — 147 non-`inv_` + 13 `inv_` = 160, and 497 + 50 = 547 |
| The **digests** were NOT recovered | Re-running the recovered scope produces `1c5220c4…` for schema and `90148e0e…` for policies, against the recorded `81825307…` and `4ed0b818…`. The separator or column set differs and cannot be guessed |
| Therefore | the scope is known, the formula is not, and the digests stay uncheckable |

Nothing was fabricated to close the gap. This is exactly the failure the rule below exists
to prevent, and it cost two passes' worth of proof.

### The rule, restated because it was learned the expensive way

**Record the exact SQL alongside any digest, in the same place as the digest.** A hash
without its formula is not evidence — it is a number that cannot be argued with or checked.

**Do not filter by name in a fingerprint.** The `inv_`/non-`inv_` split is precisely what
made the old set ambiguous: the label said one thing and the query did another, and nobody
could tell which from the recorded value. Every part below covers **all of `public`,
unfiltered**. Scope questions get answered by reading the migration, not by pre-filtering
the proof.

### The SQL — run this whole block before and after, and diff the output

Also saved runnable at `supabase/smoke/fingerprint.sql`. Do not edit it without re-taking
the baseline, because editing the formula invalidates every value below.

```sql
select 'schema' as part,
 (select md5(string_agg(x, E'\n' order by x)) from (
    select c.table_name||'.'||c.column_name||':'||c.data_type||':'||c.is_nullable||':'||coalesce(c.column_default,'') as x
    from information_schema.columns c
    join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name
    where c.table_schema='public' and t.table_type='BASE TABLE') s) as md5,
 (select count(*) from information_schema.tables
   where table_schema='public' and table_type='BASE TABLE')::text as cnt
union all
select 'policies',
 (select md5(string_agg(x, E'\n' order by x)) from (
    select tablename||'|'||policyname||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')||'|'||array_to_string(roles,',') as x
    from pg_policies where schemaname='public') s),
 (select count(*)::text from pg_policies where schemaname='public')
union all
select 'functions',
 (select md5(string_agg(x, E'\n' order by x)) from (
    select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')='||md5(p.prosrc) as x
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') s),
 (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public')
union all
select 'constraints',
 (select md5(string_agg(x, E'\n' order by x)) from (
    select rel.relname||':'||con.conname||':'||con.contype::text||':'||pg_get_constraintdef(con.oid) as x
    from pg_constraint con join pg_class rel on rel.oid=con.conrelid
    join pg_namespace n on n.oid=rel.relnamespace where n.nspname='public') s),
 (select count(*)::text from pg_constraint con join pg_class rel on rel.oid=con.conrelid
    join pg_namespace n on n.oid=rel.relnamespace where n.nspname='public')
union all
select 'triggers',
 (select md5(string_agg(x, E'\n' order by x)) from (
    select c.relname||':'||t.tgname||':'||pg_get_triggerdef(t.oid) as x
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname='public') s),
 (select count(*)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname='public')
union all
select 'views',
 (select md5(string_agg(x, E'\n' order by x)) from (
    select c.relname||'='||md5(pg_get_viewdef(c.oid)) as x
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('v','m')) s),
 (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('v','m'))
order by 1;
```

**A fingerprint part must not depend on WHO RAN IT**, and one of these nearly did. The
`views` part first used `information_schema.views.view_definition`, which returns **NULL**
when the querying role lacks privileges on the view. Read as `supabase_read_only_user` — the
role the MCP tool connects as — all 11 definitions came back NULL and the digest was the
md5 of eleven empty strings: a stable, confident, entirely meaningless number that would
have matched itself forever while the views changed underneath it. It was caught only
because the same block was run through two different connections and disagreed.
`pg_get_viewdef` reads `pg_rewrite` and returns identical text from both roles.

**Run the block through both connections when changing it.** Agreement between two roles is
what proves a part is measuring the database rather than the observer.

### The values — captured 2026-08-15, `inv_` passes A/B/C + transfers 2/4 and 5/8 applied

| Part | md5 | Count |
|---|---|---|
| `constraints` | `43cb8bba80af67a333f3ab39423b1019` | 734 |
| `functions` | `45cd80ad7e904e9a5c089d477d302d33` | 215 |
| `policies` | `8c3880435cc42863a322d5a311b3a660` | 547 |
| `schema` | `1c5220c4fdccc51b2b2831016e41c1f8` | 160 base tables |
| `triggers` | `aed332b408c333ddc08ac93d3b9dc7f9` | 188 |
| `views` | `9c9ed35a60fb0f2c363dec46c7917c38` | 11 |

The three legacy namesakes, which must stay byte-identical. Formula is plain
`md5(prosrc)` / `length(prosrc)` for the named function in `public` — these three DID
survive the Pass C loss, because that formula is unambiguous enough to have been guessed
correctly:

| Function | md5 | length |
|---|---|---|
| `inv_save_stock_move` | `d625abaf323a12e55d84c7a4c677ae84` | 3116 |
| `inv_validate_stock_move` | `4160c526a51e51534aa39e52cd9e91b6` | 1143 |
| `inv_delete_stock_move` | `6c37e9aedd167dd2f7c79628342c2cd8` | 135 |

**When a migration is applied, update the table above in the same commit.** A baseline that
lags reality is the next version of this problem.

Note also that `supabase_migrations.schema_migrations` stops at `20260725091618`. Passes A,
B and C and the transfer migrations are absent from the ledger because they were applied
with `supabase db query --linked --file`, which does not record there. That is expected, not
drift — the migration files in `supabase/migrations/` are the record.

---

## INTERNAL TRANSFERS — the landscape, established 2026-08-14

**Three parallel legacy transfer models exist. Only one is live.**

| Model | Tables | Rows | Status |
|---|---|---|---|
| `transfers` + `transfer_lines` | Odoo-shaped picking | 0 / 0 | **Dead.** Never used |
| `internal_movements` + `internal_movement_items` | location→location, has an unused `operation_type_id` | 0 / 0 | **Dead schema, LIVE SCREENS** at `/inventory/internal-movements{,/new,/:id}` |
| `internal_transfer_orders` + `internal_transfer_order_lines` | keyed to `sales_order_id` | **4 / 4** | **LIVE** |
| `inv_operation` kind=`internal` | the new model | **1** | Type `ITEM ESTIMATE`, active, `STOCK` → `DELIVERY ORDER`. One document created by the transfers pass |

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
| Consequence | Transfers were *expected* to be the **first real consumer of `locks_source`**, which has existed on `inv_operation_type` since Step 2 and is read by nothing. **They were not.** `ITEM ESTIMATE` carries `locks_source = false`, so the transfer pass never exercised the flag and it remains unconsumed — corrected 2026-08-17, having been recorded here as though it had happened. Every one of the four operation types has `locks_source = false`; only `GOODS RECEIVED` sets `locks_destination`. Whoever first sets the flag true is still writing the first consumer of it, with no working example to copy |
| The sales-order link | A **reference on the document**, not the document's identity. Do **not** model an ITO as a child of a sales order the way legacy `internal_transfer_orders` does |

---

## THE DESTINATION OF A MOVE IS TAKEN ON TRUST — 2026-08-14

**`inv_transfer_stock_item` asserts where a unit came FROM and accepts on faith where it is
going TO.** The asymmetry is deliberate on the "from" side and unexamined on the "to" side.
Read the function body before assuming otherwise; this was verified against the live
`prosrc`, not inferred from the migration.

| Parameter | What the RPC does with it |
|---|---|
| `p_expected_from_location_id` | **Asserted.** Compared against `inv_stock_item.location_id` and raised on if they disagree: *"Stock item % (serial %) is not where it was expected: it is in location %, but the caller expected %. Refusing to move it."* |
| `p_to_location_id` | **Taken as given.** Checked only for NOT NULL, that the row exists, and that `is_active` — never against the move, the operation, or the operation type. Any active location is accepted |
| `p_document_id` | **Also taken as given.** Nothing compares it to the operation that owns `p_move_id`. The ledger's citation of the document is the caller's word |

`p_move_id` sits in between: the move's `product_id` **is** asserted against the unit's
`product_id`, and a unit already on that move is refused. So the RPC does check that the
right *product* is being moved onto the right *line* — it just never checks that the line,
the destination and the document belong to each other.

**What this nearly shipped.** `commitUnit`'s `useCallback` in `BarcodeScan.tsx` did not list
`operationId` or `doc.dest_location_id` in its dependency array. A stale closure would have
sent units to the **previous document's destination**, cited the **previous document** in the
append-only ledger, and the database would have recorded all of it as a real move with a real
ledger row — because every value involved is structurally valid. There is no server-side
assertion that would have caught it.

**Caught by lint, not by typecheck.** `tsc` had nothing to say: the types were all correct.
`react-hooks/exhaustive-deps` was the only thing standing between this and corrupt movement
history. Do not treat the exhaustive-deps rule as noise anywhere in this module.

**The rule for anything built on top of this:**

- **Any future adapter must treat the destination as its own responsibility.** The server
  will not second-guess it. If an adapter passes a destination, the adapter is the last line
  of defence for that value being right.
- The same goes for `p_document_id`. An adapter that cites the wrong document writes a
  permanently wrong ledger row, and the ledger is append-only.
- **Do not "fix" this by re-reading `inv_operation.dest_location_id` server-side.** That was
  considered and rejected: `mandatory_scan_dest_location` exists precisely so an operator can
  confirm a destination, so on any type using that flag, only the screen knows what was
  actually confirmed. Re-deriving it server-side would make the promise *look* kept while
  discarding the operator's answer.
- If the "to" side is ever tightened, the shape is a check that the destination is reachable
  for the document (its operation's `dest_location_id`, or a descendant of it) — not a
  re-derivation that ignores what was passed.

---

## ON-HAND IS LOCATION-BLIND UNLESS YOU FILTER IT — swept 2026-08-17

**`inv_on_hand` and `inv_stock_item` count units at EVERY location type, including the ones
that mean the unit has left the building.** Neither carries a notion of "our stock". Any
reader that does not join `inv_location` and filter is reporting a warehouse total that
includes goods already delivered to a customer, in transit, or scrapped.

`inv_on_hand` is a bare `GROUP BY product_id, location_id, status` over `inv_stock_item` —
no predicate at all. That is correct for a view whose job is to expose the buckets; the
scope decision belongs to the caller. It just has to actually be made.

`inv_location.type` is the enum `inv_location_type`:
`supplier, view, internal, customer, inventory_loss, production, transit, scrap`.
**Only `internal` is stock we hold.** The other seven are counterpart or structural
locations — `supplier` and `customer` are where units come from and go to, `production`,
`inventory_loss` and `scrap` absorb write-offs, `transit` is mid-move, and `view` is a
grouping node that holds nothing.

### What this actually cost, on today's data

25 units exist. 23 sit in `GODOWN` (`internal`); 2 sit in `DELIVERY ORDER` (`transit`).
Every on-hand figure in Inventory 2 read **25** until the location join was added.

### `inv_available_qty` HAS NO READER, AND IT HAS THE SAME BUG

```sql
SELECT count(*)::integer FROM public.inv_stock_item si
 WHERE si.product_id = p_product_id
   AND si.status = 'ok'
   AND si.reserved_for_customer_id IS NULL
   AND (p_location_id IS NULL OR si.location_id = p_location_id);
```

Verified 2026-08-17: the only occurrence of the name anywhere in `src/` is the generated
signature in `src/integrations/supabase/types.ts`. **There is no call site** — not in the
frontend, and no other function in `public` calls it either.

It filters on `status` and on `reserved_for_customer_id`, which makes it *look* like the
authoritative answer to "how many can I sell". It is not. Passing `p_location_id => NULL`
— the obvious way to ask "across the whole company" — drops the location predicate
entirely and counts `ok`, unreserved units sitting at **customer, transit and scrap**
locations as available to sell.

**Whoever reads it first inherits the bug.** It will look like the careful option next to
a hand-rolled count, which is exactly why it is dangerous.

> **Fix it before using it, do not trust it because it looks authoritative.** The shape
> is the same join the frontend now does: restrict to `inv_location.type = 'internal'`
> when `p_location_id IS NULL`. That is a database change and needs its own approval —
> it is not a licence to edit the function on the way past.

### Not every count SHOULD be filtered — check what the number is for

`tg_product_variant_guard` deliberately counts units at **every** location when it refuses
to archive a variant:

```sql
SELECT count(*) INTO v_units FROM public.inv_stock_item WHERE variant_id = OLD.id;
```

That is right for a guard: a unit in transit is still a unit of that version, and archiving
the version would hide it. So a UI figure that *predicts this refusal* must be unfiltered,
while a UI figure that *reports stock we hold* must be filtered. They are two different
numbers and cannot be served by one field.

**The rule: before adding the location filter to a count, ask what the count is used for.**
A stock level is location-scoped. A "does anything reference this" guard is not.

---

## PLANNED DOCUMENT TYPES — designed, not built

Not known issues. These are shapes the model is expected to grow, recorded so the design is
not re-derived from scratch.

### The delivery payment gate — BUILT INERT, must be switched on when Sales lands

**This is a PLANNED COMPLETION, not a known issue.** The hook is deliberately built and
deliberately not wired. It is recorded here so that "switch it on" is a step someone
performs, not a thing they have to rediscover.

**Why it cannot be enforced yet.** Payment status lives in the Sales module, which is not
rebuilt. V's decision, 2026-08-17: the gate cannot be enforced now, and that is accepted —
but it must not be skipped, and it must not be a gate that silently passes.

| | |
|---|---|
| The document | `inv_operation` kind `outgoing`, type **DELIVERY NOTE**, `DELIVERY ORDER` → `CUSTOMERS` |
| The completion path | **`inv_complete_operation(p_operation_id uuid)`** — the single completion RPC for every kind. **This is the exact function to change.** |
| The reference | `inv_operation.sales_order_id`, nullable, added while `outgoing` held **zero** documents so there is no backfill question |
| The gate | **`inv_assert_delivery_paid(p_operation_id uuid)`** — exists, named, and **hard-fails**. It is NOT called from `inv_complete_operation` yet |

**What the gate will read when it is switched on**, mirroring the legacy
`complete_delivery_with_qc` exactly so the two cannot drift into different answers:

```sql
SELECT COALESCE(paid_amount, 0), COALESCE(grand_total, total, 0)
  INTO v_paid, v_total
  FROM public.sales_orders WHERE id = v_so_id FOR UPDATE;
IF v_total <= 0 OR v_paid + 0.005 < v_total THEN
  RAISE EXCEPTION 'Delivery available after full payment. Current: ₹% paid of ₹%', v_paid, v_total;
END IF;
```

`FOR UPDATE` is not decoration — it locks the order row so a payment cannot land between the
read and the delivery. The `0.005` tolerance absorbs numeric rounding on a 2dp currency.
Note the legacy predicate also refuses `v_total <= 0`, so a zero-total order does **not**
pass; only a genuinely-paid one does.

**Why it hard-fails instead of returning "paid".** Same discipline as
`product_variant_auto_archive`, which raises `feature_not_supported` rather than sweeping
with columns it does not have. A gate that returns success because it *cannot check* is
indistinguishable from a gate that checked and approved — and it is the second one that
everybody assumes. An inert gate must be loud.

**Switching it on** means: delete the refusal branch in `inv_assert_delivery_paid`, restore
the body above, and add the call to `inv_complete_operation` under a kind test for
`outgoing`. Three edits, one migration, one approval.

**The NULL case is UNDECIDED and must be decided at switch-on.** Legacy passes trivially
when `sales_order_id IS NULL` — its own comment calls this an interface stub. Whether that
stays a deliberate escape hatch (samples, warranty replacements, internal write-offs to a
customer location) or becomes a hole to close is a business decision V will take then, not
now. **Do not let it default silently by copying the legacy branch without asking.**

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
