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

### The same rule applies to MEASUREMENTS, not just tests — learned 2026-08-21

Proving the screen refusal made no round trip needed a measurement of network activity, and
**the first two instruments both confidently reported ZERO while the scan was demonstrably
running.**

| Instrument | Why its zero was meaningless |
|---|---|
| the browser extension's `read_network_requests` | Captured the page-load requests, then recorded nothing further. A filtered read returned "no requests matching supabase.co" for a scan that had visibly just resolved a serial off the database |
| `performance.getEntriesByType('resource')` | `resourceTimingBufferSize` defaults to 250 entries and **Vite dev serves every module as its own request**, so the buffer was full long before the scan. A full buffer silently drops new entries — it does not error, and the array it returns still looks like an answer |

Both would have "confirmed" the claim being tested. The claim was even true, which is worse:
a correct conclusion reached from an instrument that was not measuring is indistinguishable
from a lucky guess, and the next person inherits the method rather than the answer.

What actually measured it was wrapping `window.fetch` and recording the calls — which showed
the refused scan costs **4 GETs and zero writes**: three product lookups and one serial
lookup, all `resolveScan` identifying the barcode, and **no `rpc/inv_transfer_stock_item`**.
That is also the honest form of the claim. A scan cannot skip identifying what was scanned;
what it skips is the commit round trip.

**Before believing a zero, prove the instrument can see a one.** The fetch wrapper was
trusted only because the accepted scan through the same wrapper showed the POST appear.

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

### The values — re-taken 2026-08-22, after serial generation

The 2026-08-18 baseline reproduced exactly before this migration was applied — **third
consecutive confirmation** that the recorded formula produces the recorded numbers. Re-run
again after the smoke suite and all five mutation runs: identical, and `inv_pending_serial`
held 0 rows, so nothing leaked out of a rolled-back transaction.

| Part | md5 | Count | vs 2026-08-18 |
|---|---|---|---|
| `constraints` | `dd9e795940186f515fea4112ad132ccb` | 751 | **+16** — the new tables' checks, PK/FK and unique constraints |
| `functions` | `90a2ae6fb7dac43110d94b2046b7b6b9` | 223 | **+4** — `inv_generate_serials`, `inv_void_pending_serials`, `inv_record_serial_print`, `inv_tg_void_pending_serials_on_close`; digest also carries the replaced `inv_receive_serial` |
| `policies` | `77b9dfe190eddee26b9c3841a664d5a2` | 555 | **+8** — four each on the two new tables |
| `schema` | `051c00f530529165a5ea6c46e55e7981` | 162 base tables | **+2** — `inv_serial_sequence`, `inv_pending_serial` |
| `triggers` | `31a058b6cd08fe3d8df0f42f49181baf` | 191 | **+3** — two `set_updated_at`, one `inv_operation_void_pending_serials` |
| `views` | `e7c1ab1f36c2a7d274874375c75899e7` | 12 | unchanged |

Superseded 2026-08-18 values, kept only so the diff above can be checked:
`constraints` `b0edc7f0…`/735, `functions` `63fbe4a7…`/219, `policies` `8c388043…`/547,
`schema` `f037013e…`/160, `triggers` `aed332b4…`/188.

### The values — superseded 2026-08-18, after route enforcement

The 2026-08-17 baseline reproduced exactly before this migration was applied — second
consecutive confirmation that the recorded formula produces the recorded numbers.

| Part | md5 | Count | vs 2026-08-17 |
|---|---|---|---|
| `constraints` | `b0edc7f0b8e42f19de5e939a4d73f983` | 735 | unchanged |
| `functions` | `63fbe4a703514b9049e896d42da7c366` | 219 | **+3** — `inv_location_reaches`, `inv_route_is_legal`, `inv_document_allowed_from`; digest also carries the replaced `inv_transfer_stock_item` |
| `policies` | `8c3880435cc42863a322d5a311b3a660` | 547 | unchanged |
| `schema` | `f037013ef7d5ae8303282bf43182ae41` | 160 base tables | unchanged |
| `triggers` | `aed332b408c333ddc08ac93d3b9dc7f9` | 188 | unchanged |
| `views` | `e7c1ab1f36c2a7d274874375c75899e7` | 12 | **+1** — `inv_location_ancestors` |

Superseded 2026-08-17 values, kept only so the diff above can be checked:
`functions` `87080bcc…`/216, `views` `9c9ed35a…`/11.

### The values — superseded 2026-08-17, after the delivery payment gate

**The 2026-08-15 baseline reproduced EXACTLY before this migration was applied** — all six
parts and all three legacy namesakes. That is the first time this file's digests have been
confirmed reproducible since the Pass C loss, and it means the formula recorded above is
the formula that produced them.

| Part | md5 | Count | vs 2026-08-15 |
|---|---|---|---|
| `constraints` | `b0edc7f0b8e42f19de5e939a4d73f983` | 735 | **+1** — `inv_operation_sales_order_id_fkey` |
| `functions` | `87080bcc68ca829d3c880df1a7a60a94` | 216 | **+1** — `inv_assert_delivery_paid` |
| `policies` | `8c3880435cc42863a322d5a311b3a660` | 547 | unchanged |
| `schema` | `f037013ef7d5ae8303282bf43182ae41` | 160 base tables | digest changed, **count unchanged** — a column was added to an existing table, no table was created |
| `triggers` | `aed332b408c333ddc08ac93d3b9dc7f9` | 188 | unchanged |
| `views` | `9c9ed35a60fb0f2c363dec46c7917c38` | 11 | unchanged |

Previous values, superseded — kept only so the diff above can be checked, not for comparison:
`constraints` `43cb8bba…`/734, `functions` `45cd80ad…`/215, `schema` `1c5220c4…`/160.

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

## DELIVERIES — the third document type, built 2026-08-17

`inv_operation` kind `outgoing`, type **DELIVERY NOTE**, `DELIVERY ORDER` → `CUSTOMERS`.
Pages at `/inventory2/deliveries{,/new,/:id}`. The legacy `delivery_notes` screens at
`/inventory/delivery-notes`, driven by `complete_delivery_with_qc`, are untouched and still
live; nothing in the new module reads or writes them.

### ONE CUSTOMERS NODE — place and party are different questions

There is a **single** `CUSTOMERS` location (type `customer`, code `CTMR107`) and every
delivery ends there. Deliberately **not** one node per customer.

| | |
|---|---|
| the ledger records **PLACE** | `inv_stock_tracking.to_location_id` says the unit left our stock. A fact about geography |
| the document records **PARTY** | `inv_operation.partner_customer_id` says WHO received it. A fact about the sale |

So "which customer has this unit" is answered by joining the unit's move line to its
operation and reading the partner — **never** by reading the location.

**Why it matters beyond tidiness.** A location-per-customer encodes the party into the
place, and then every on-hand query has to know which locations are "really" customers.
The on-hand readers filter to `inv_location.type = 'internal'`, so the single CUSTOMERS
node is excluded by that alone, with no list of special-case ids anywhere.

**Customers are read DIRECTLY off `public.customers`** — not `CustomerSelector`, which
wraps CRM's `ContactSearchCombobox`, and not `useContacts`. Both are on the SHARED
BOUNDARY, and importing either would have made this a CRM change. `customers` is
auto-populated by `trg_sync_customer_from_contact` and is read-mostly; nothing here writes
it or touches `crm_contact_id`.

### No reservations on this pass

`inv_stock_item.reserved_for_customer_id` stays **unwritten**. A delivery here ships units
that are already picked; it does not claim them in advance. Half-writing the column would
hand Sales a reservation surface that only sometimes exists.

### Condition is WARNED, not blocked — and the database checks nothing

Only `ok` ships cleanly. The other six members of `inv_stock_status` each warn **naming the
unit's condition**, and the operator decides — the same shape as the over-receipt gate.

`attention` is in the warned set **deliberately**. It is the softest of the bad statuses,
which makes it exactly the one that would be waved through if it were treated as clean.
CLAUDE.md already says an advisory failure means "review before promising it", and a
delivery IS the promise.

**Never hard-blocked**, because a blocked screen gets worked around and there are real
cases (a customer accepting a floor model at a discount). And because the database will not
block it either: `inv_transfer_stock_item` asserts the unit's product and its location and
says **nothing** about its status — it ships a `destroyed` unit as happily as an `ok` one.
The screen's question is the only one being asked.

### No Quality segment — same reason as internal

`requires_qc` stays false on every outgoing type. `inv_test_result` has no `operation_id`,
so an inspection is unit-scoped and running QC from a delivery would overwrite the
**receipt's** verdict for that unit. Not an oversight, not "later".

---

## THE SCAN SEAM — the verdict after three adapters, 2026-08-17

Pass 7 claimed that adding an operation kind costs one sibling adapter file and **no edit to
`scan.ts`**. Two adapters have now tested it. Recorded together because "it held this time"
is worth nothing unless the failure is written down beside it.

| Adapter | What held | What it cost |
|---|---|---|
| `scanTransfer.ts` (2nd) | every read, every type, `resolveScan`, `getScanDocument`, `listOpenScanDocuments`, the seam itself | **two fields on `CommitUnitInput`** — `operationId` and `toLocationId` |
| `scanDelivery.ts` (3rd) | all of the above, **and `CommitUnitInput` needed NOTHING NEW** | one field on `ScannedUnitRef` (`status`), one method on `ScanAdapter` (`warnBeforeCommit`) |

### A missing VALUE and a missing QUESTION are different failures

This is the part worth carrying forward.

The transfer's gap was a **missing value**: the payload could not express where a unit was
going. Adding fields fixed it, and adding fields is what you look for.

The delivery's gap was a **missing question**: the payload could already express everything
needed to move the unit — from, to, document, line — and there was simply nowhere to ask
whether it *should* move. No amount of extra fields would have revealed that, because
nothing was absent from the data.

**A seam that carries enough data can still be missing a decision point.**

`adjustment` is the last kind. On this evidence the thing to watch for is **not another
field** — the payload is now demonstrably sufficient for a second consecutive kind. It is
whether an adjustment needs to ask something no existing adapter asks.

### `warnBeforeCommit` is REQUIRED, not optional

Every adapter must state its condition policy out loud, **including when the policy is
"none"** — receipt and transfer both return null with a written reason.

Made optional, a future adapter would inherit "never warn" by simply not mentioning it. On
a delivery that means shipping a rejected unit to a customer in silence. The cost of
required is two extra stanzas in the existing adapters; the cost of optional is paid once,
invisibly, by whoever forgets.

It returns a **sentence**, not a boolean, because the warning has to name the condition.
"Confirm?" tells an operator nothing.

### Condition is asked BEFORE the count gate

A unit can trip both gates on one scan. Asking about the count first would let an operator
confirm "yes, an extra unit" and commit it **with its REJECTED status never mentioned**,
because the count gate commits directly. So the condition is asked first and hands control
back to `countGateThenCommit`, which means the count question is still reached afterwards.

The retry path gets the same gate: the retry row lets the operator **correct** the serial,
so what is re-resolved may be a different unit in a different condition.

---

## `createDelivery` IS TWO STATEMENTS, NOT ONE TRANSACTION — 2026-08-17

**A known, deliberate seam. Recorded so it is not rediscovered as a mystery.**

`inv_create_operation` takes `p_partner_customer_id` but has **no sales-order parameter** —
`inv_operation.sales_order_id` was added by the payment-gate migration *after* that RPC was
written. So `createDelivery()` in `src/lib/services/inventory2/deliveryWrites.ts` calls the
RPC and then sets the reference with a **follow-up UPDATE**.

| | |
|---|---|
| Why not widen the RPC | Widening a 10-parameter RPC used by **three** document types is a database change, and this pass had no approval for one. CLAUDE.md rule 2 |
| The failure mode | The two statements are not one transaction. If the UPDATE fails, a delivery exists with **no sales order recorded** |
| Why that is acceptable | It is visible and correctable — the detail page shows "no sales order recorded" and the reference can be set later. It is strictly better than silently dropping the reference, or editing an RPC without approval |
| It is not swallowed | The error names the document that **was** created, so the operator knows both that the delivery exists and that its order link is missing |

**The fix, when it is allowed:** fold `p_sales_order_id` into `inv_create_operation` and set
it in the same statement. That closes the seam entirely and this section comes out.

**Do NOT open that RPC for this alone.** It should happen the **next time
`inv_create_operation` is opened for an approved reason** — a widening carries the three
document types with it, and doing it opportunistically is exactly the "while I'm here" this
file forbids.

---

## THE DOCUMENT ROUTE IS A RULE — enforced 2026-08-18

Migration `20260818090000_route_enforcement.sql`, smoke suite
`supabase/smoke/route_enforcement_smoke.sql` (20 assertions).

**What was wrong.** `inv_transfer_stock_item` was passed the UNIT'S OWN location as
`p_expected_from_location_id`, so the assertion compared the unit's location against itself
and **could never fail for a routing reason**. Nothing anywhere — no RPC, trigger,
constraint, adapter or screen — compared a scanned unit's location to
`inv_operation.source_location_id`. `DEL/2627/0001` declares `DELIVERY ORDER → CUSTOMERS`
and shipped two units straight out of `GODOWN`, while the two units a transfer had staged
into `DELIVERY ORDER` sat there untouched. **2 of 29 ledger rows.**

### Where the check lives, and why there is exactly one

`inv_transfer_stock_item` is the **only** function in the module that updates
`inv_stock_item.location_id` or writes `inv_stock_tracking`. Receipt create, receipt resume,
transfer, delivery and any future adjustment all funnel through it. One check covers every
path and none can be forgotten — which is why this went in the RPC rather than the adapters.

**The operation is derived from `p_move_id`, never from `p_document_id`.** The move id is
already trusted (its product is asserted a few lines earlier, so a bogus one has already
failed); `p_document_id` is the caller's unverified word. Deriving it also made the
**citation check** free: a ledger row can no longer name a document the move does not
belong to. That closes the "the ledger's citation of the document is the caller's word"
hole this file used to record as permanent.

### The predicate, per kind — a fifth kind follows this table

| Kind | Legal iff | Why |
|---|---|---|
| `receipt` | `reaches(from, src) AND reaches(to, dest)` | One-directional. Reversing it is a return-to-vendor — its own type |
| `internal` | `reaches(from, src) AND reaches(to, dest)` | One-directional. The route IS the document's meaning |
| `outgoing` | `reaches(from, src) AND reaches(to, dest)` | One-directional. Reversing it is a customer return — its own type |
| `adjustment` | `(reaches(from,src) AND reaches(to,dest))` **OR** `(reaches(from,dest) AND reaches(to,src))` | **Bidirectional along its declared axis** |

`reaches(candidate, anchor)` = *candidate IS anchor, or sits underneath it* —
`inv_location_reaches`, over the `inv_location_ancestors` view.

**Why adjustments differ, and why it is a rule rather than an exemption.**
`inv_tg_adjustment_counterparty` already forces exactly one virtual side
(`inventory_loss`/`scrap`/`production`) and one internal side, so an adjustment document
declares an **axis** and only the direction varies: a write-off runs internal→virtual, a
found-stock correction runs virtual→internal. `STOCK ADJUSTMENT` is configured
`INVENTORY LOSS → STOCK` and a write-off runs the other way, so a one-directional rule
would have broken adjustments **the day they were built**.

**It is a PAIR check, not two independent membership tests.** Testing "from is in the
allowed set AND to is in the allowed set" separately would also admit internal→internal and
virtual→virtual, neither of which is an adjustment. The two ends must be *opposite* ends of
the same axis. Smoke test 13 is exactly this case and is the one that separates the two
designs.

### The hierarchy is live, so equality would have been wrong

`GODOWN`'s parent is `STOCK`, today, with 23 units in the child. A plain
`unit.location_id = op.source_location_id` check would have refused every one of them on a
document sourced at `STOCK`. `inv_location_ancestors` is modelled line-for-line on
`product_category_ancestors`, **including its `seen[]` cycle guard** — `inv_location.parent_id`
has no cycle constraint, so an unguarded recursion would hang the server rather than return
a wrong answer.

Containment is **directional**: a unit in a child is reachable from the parent, never the
reverse. Smoke tests 1–3 and 8–9 pin both directions.

### ACCURACY RUNS FIRST, AND THE ORDER IS LOAD-BEARING

```
1. expected_from = actual location   ← accuracy  (unchanged, pre-existing)
2. route is legal                    ← legality  (new)
```

The old assertion was never worthless — it is what makes the ledger's `from_location_id`
**true**: the recorded origin is proven to be where the unit actually was at commit time,
and it catches time-of-check/time-of-use races and stale closures.

If a unit moved between resolve and commit, the operator must be told *"it is in X, but the
caller expected Y"* — precise and actionable — **not** a route error that misdescribes the
cause. Legality is only a meaningful question once the recorded origin is known to be true.
Smoke test 7 constructs a claim that is *both* inaccurate and illegal, so only the ORDER
decides which message comes back.

**The fix added legality. It did not weaken accuracy. Do not reorder these.**

### `locks_source` was NOT the answer — and confusing the two is easy

`locks_source` is read in exactly one place, `inv_create_operation`, where it pins
`inv_operation.source_location_id` to the type's default at CREATE time.

| | |
|---|---|
| `locks_source` | "this document's source *field* must say DELIVERY ORDER" — **configuration integrity** |
| what was missing | "units scanned onto it must actually *be* at DELIVERY ORDER" — **movement legality** |

Turning it on would have made `DEL/2627/0001` declare the source it already declared. The
two units would still have shipped from GODOWN. **A flag that constrains what a document
says is not a check on what is done to it.**

### `inv_document_allowed_from` is a SUPERSET, on purpose

The screen needs a **set** to refuse a unit against before any round trip;
`inv_route_is_legal` is a **pair** check and cannot answer that. For an adjustment the set
spans both ends of the axis, which is strictly more than the pair check permits.

The asymmetry is safe in exactly one direction:

- **too generous is safe** — the server still refuses, and the operator gets a late message
  instead of an early one;
- **too narrow would refuse a lawful unit** at the bay with no way past it.

So it **may be widened, and must never be narrowed**, and it is never the thing that decides
whether a movement happens. The authority is `inv_route_is_legal`.

#### It has a reader — the screen refusal, built 2026-08-21

`getScanDocument()` puts the set on `ScanDocument.allowed_from_location_ids`;
`routeRefusal()` in `src/lib/inventory2/routeRefusal.ts` tests membership and
`BarcodeScan.tsx` calls it on both the first-scan and the retry path. Unit tests in
`src/test/inventory2/route-refusal.test.ts` (7, mutation-tested with three mutations).

**The screen tests membership and nothing else.** The descendants are already expanded by
`inv_location_ancestors` inside the function, so a `STOCK`-sourced document's set contains
`GODOWN` outright. Two paired tests pin this: same document and same unit, differing only in
whether the set arrived expanded — expanded permits, unexpanded refuses. Grow a parent walk
client-side and the second flips, which is the moment two definitions of containment start
disagreeing.

**AN EMPTY SET IS "NO OPINION", NOT "NOTHING IS ALLOWED"** — decided 2026-08-21, and it is
the narrow-side guard in practice. The set comes back empty when a document has no
`source_location_id`, and refusing every unit on that basis would make the screen narrower
than the server: precisely the direction this section forbids. The screen falls through and
lets the server answer, which costs a late message on a misconfigured document and strands
nobody.

**It is a message, not the enforcement**, and the comments say so in three places because
there are two tempting "optimisations" and both are wrong: trusting a client pass and
skipping the server, or weakening the server check because the screen now filters. `doc` is
a cached snapshot — an hour-old session holds an hour-old set, and only the server reads the
unit at the moment it moves.

### What this changes operationally

**Every delivery now requires a prior transfer.** The 23 GODOWN units cannot be shipped on
a `DELIVERY NOTE` (sourced `DELIVERY ORDER`) until they are staged. Accepted by V on
2026-08-18 as the intended workflow.

The 2 divergent ledger rows on `DEL/2627/0001` remain. They are accurate history of an
unlawful move, `inv_stock_tracking` blocks UPDATE/DELETE/TRUNCATE by trigger, and rule 4
forbids deletion. Nothing revalidates history.

---

## SERIAL GENERATION — labels before the goods, built 2026-08-22

Migration `20260822090000_serial_generation.sql`, smoke suite
`supabase/smoke/serial_generation_smoke.sql` (28 assertions).

V's workflow: create the receipt with quantities -> **generate serials** -> print labels ->
stick them on the goods -> scan them in. Generation is a **prerequisite for printing**, not a
detail of it, which is why it landed before the print pass.

### A pending serial is a NUMBER, not a UNIT

`inv_stock_item` is the single source of truth for what is in the building. The QC gate, the
on-hand readers, the variant archive guard and route enforcement all assume a row there is a
real unit in a real place. So a generated-but-unreceived serial lives in
**`inv_pending_serial`**, and every one of those readers is untouched — no new
`inv_stock_status` member, no nullable "not yet received" column, nothing for 66 reader sites
across 22 files to remember.

QC correctness falls out for free: QC keys on `stock_item_id`, so **a unit that has not
arrived cannot be inspected**, enforced by the absence of a row rather than by a guard
somebody has to write.

### THE FORMAT, AND WHY IT IS A DECISION RATHER THAN A DISCOVERY

`{sku}{sep}{fy}{sep}{nnnn}` -> `101205-2627-0001`, from `inv_serial_sequence`, keyed
**(product_id, fy_label)**.

Be clear about what was inherited: the format was a convention observed in **12 rows, all
from one receipt** (`RCP/2627/0001`). The other 13 live serials are hand-typed and follow no
pattern at all. Nothing produced or validated the format before this migration.

| | |
|---|---|
| The counter is per (product, FY) and **CONTINUES** | V, 2026-08-22. Receipt A ending at 0012 means the next receipt for that product starts at 0013. Smoke test 10 asserts the second document's lowest serial sits **above** the first document's highest — the direct statement of "it did not restart" |
| **The FY comes from the document, never the clock** | Parsed back out of the operation's own number using its sequence's separator, with the sequence `fy_label` as fallback. A receipt opened in 2627 and received in 2628 must still mint 2627 serials; `now()` is the obvious wrong thing |
| `serial_counters` was **not** reused | Legacy, keyed on prefix alone with no FY dimension, and shared with `generate_serials_for_gr_line` — the legacy path could advance our counter |
| `allocate_serial_numbers` was **not** reused | It mints `{sku}-{yymm}-{n}`. That is a second convention |

### THE NAMESPACE IS DIRTY, AND THE GENERATOR MUST ASSUME IT ALWAYS WILL BE

`1234`, `123596`, `SUPPLIER-ALT-99`, `PASS6-PREVIEW-0001` — 13 of 25 live serials owe nothing
to any convention. The generator therefore **probes `inv_stock_item` and `inv_pending_serial`
before issuing**, and burns a clashing number rather than handing out one that
`inv_receive_serial` is guaranteed to refuse later.

Vendor serials make this **permanent, not a legacy artefact**: outside serials arrive in the
same namespace forever. Smoke test 11 occupies the next number by hand and proves the skip;
mutation 1 removes the skip and the test reports the generator minting the very number that
was already taken.

### GAPS IN THE SEQUENCE ARE CORRECT — DO NOT REPORT ONE AS A BUG

Numbers are consumed on allocation and **never recycled**. A gap appears whenever a number is
voided, or skipped because something already held it. That is the intended outcome, and the
reason is physical rather than tidy: **a voided label may already be stuck to a piece of
furniture**, so reissuing its number would put two objects in the world bearing one serial —
`inv_stock_item_serial_key`'s failure relocated to the warehouse floor.

`inv_pending_serial.serial` is `UNIQUE` **across the whole table, voided and consumed rows
included**. A partial index over live rows only would hand a retired number back out.

**Test 21 alone does not prove this, and that matters.** It proves a voided number is not
*reissued*, but the mechanism there is the monotonic counter, which never revisits a number
anyway — so test 21 would pass under a weaker constraint. **Test 28** is the one the
constraint owns: a voided number cannot be **re-occupied** by any other route. It exists only
because designing mutation 5 exposed that the constraint's real job was untested.

### VENDOR SERIALS ARE NORMAL, NOT EXCEPTIONAL — V, 2026-08-22

Some vendors send their own serials; those units are received under the vendor's number, not
a generated one. **A scanned serial with no pending row is accepted silently.**

Before this migration "unknown serial" meant exactly one thing: create it. Decision 3 splits
it in two, and only the pending table can tell them apart:

| Scanned serial | Outcome |
|---|---|
| no pending row anywhere | **vendor serial — accepted, no message** |
| pending row on another document | refused, naming that document and the remedy |
| pending row on another line of this document | refused with its own sentence |
| pending row voided | refused, quoting the recorded reason |

**Do not add a "vendor serial detected" notice.** Warning on the normal case is how warnings
stop being read — the same reasoning that keeps `attention` in the delivery's warned set
rather than letting the soft status be waved through.

**Why the another-document case earns its own refusal** rather than falling through: without
it, a label printed for receipt A and scanned onto receipt B would silently create the unit
and burn the number, and receipt A would later refuse **its own label** through the
pre-existing B1 branch — blaming the wrong document, for the wrong reason, hours later.

### NO `uses_vendor_serials` FLAG, AND THE REASON IS ALREADY IN THIS FILE

A per-product or per-line flag was considered and **rejected**.

| | |
|---|---|
| It would be `products.track_serials` again | Which this file already records as obsolete, never read by any RPC, inconsistently set, and **already worked around** in `components/sales/ReserveStockDialog.tsx:51`. A boolean defaulting to false that nobody maintains is worse than no flag |
| **It could not gate anything even if maintained** | It cannot refuse generated serials on a "vendor" line — the operator may have printed some anyway. It cannot refuse vendor serials on a "generated" line — the vendor may have labelled some. Its only honest use is deciding whether to *offer* the Generate button, and a UI hint that is wrong is worse than none |
| If it is ever wanted | Make it **per-vendor** (vendors are few enough to maintain), and it must still never gate the scan path |

### RECONCILIATION IS TWO ACCOUNTS, NOT ONE FRACTION

"12 generated, 7 received" never meant "5 missing", and with vendor serials it visibly does not.

| Account | Fields | Question |
|---|---|---|
| Goods | `demand_qty`, `received_qty` | did the stock arrive? |
| Labels | generated / consumed / outstanding / voided | where did our numbers go? |

**Completeness is `received_qty` vs `demand_qty`, and the label ledger must never define it.**
If it did, a vendor-serialled line could never complete. Outstanding labels at validation are
a housekeeping signal: they warn, they do not block, and the completion trigger's wording
offers the vendor-serial explanation rather than reading as a count of missing goods.

### UNIQUENESS IS PROCEDURAL, NOT CONSTITUTIONAL

**Same class of fact as "the destination of a move is taken on trust", and it belongs beside
it.**

Postgres **cannot** enforce uniqueness across two tables. There is no cross-table `UNIQUE` and
no exclusion constraint spanning relations. What makes a serial unique here is **four
mechanisms, not one constraint**:

1. `inv_pending_serial.serial UNIQUE` — two pending rows cannot share a number;
2. `inv_stock_item_serial_key` — two units cannot share a number;
3. the counter is atomic (`UPDATE ... RETURNING`), so concurrent generation cannot collide;
4. the generator probes `inv_stock_item`, and `inv_receive_serial` probes pending — which is
   what covers the case the first three miss: a hand-typed or vendor serial taking a number a
   printed label is holding.

**A direct INSERT bypassing the RPCs would break it.** RLS requires `can_write_inventory()` so
it is not open to the public, but this is procedural integrity and must never be described as
constraint-level. The strong alternative — a serial registry table with `inv_stock_item.serial`
as an FK — was rejected as too large: it rewrites the identity column of a live table and
touches 66 reader sites.

### THE `inv_receive_serial` EDIT IS ADDITIVE, AND THAT IS THE WHOLE SAFETY ARGUMENT

The four pre-existing branches are **byte-identical, including their messages**:

| | |
|---|---|
| B1 | serial exists on another document -> refuse |
| B2 | same document, already on this move -> clean re-run |
| B3 | same document, not on this move -> resume the transfer |
| B4 | unknown serial -> create + transfer |

The new code is **one block** between the idempotency block and the create, plus one UPDATE
after the transfer. Safe by construction: every path through the idempotency block returns or
raises, so the new block is reachable only when the serial is new — exactly B4's territory.

**B1's message was deliberately NOT improved** to name the offending document, though it
easily could be. Rule 3: do not bundle a readability change with a behaviour change on the
riskiest function in the module. That improvement is still available and still unclaimed.

Smoke tests **1-4 are the point of the suite**; the new behaviour is the easy half. If any of
those four ever shifts, that is a stop, not a test to adjust.

### THE CONSUMED-ANOMALY BRANCH IS UNREACHABLE, AND FINDING THAT OUT WAS THE TEST WORKING

`inv_receive_serial` refuses a pending row marked consumed whose stock item is missing. That
state **cannot be constructed**: `inv_pending_serial.stock_item_id` is `ON DELETE RESTRICT`,
and a genuinely received unit is protected even earlier by `inv_move_line_stock_item_id_fkey`.
The branch is defence in depth against those constraints being dropped, not a live path.

This surfaced as the **Pass A failure repeating itself**: the first version of smoke test 8
deleted a received unit and asserted the refusal came from the pending FK. It did not — it came
from the move-line FK, and a bare-SQLSTATE assertion would have passed while proving nothing.
It was caught only because the test matched the **constraint name**. Test 8 now uses a stock
item nothing else references, so the pending FK is the only thing that can refuse, and test 81
records the earlier protection separately.

### MUTATION RESULTS — all five bite

| Mutation | Effect |
|---|---|
| dirty-namespace skip deleted | test 11 fails, showing the generator minting the very number already taken |
| pending block removed from `inv_receive_serial` | tests 5, 6, 7, 9, 18, 20 fail |
| completion trigger also voids consumed rows | **refused by `inv_pending_serial_single_outcome`** — the mutation is structurally impossible, not merely detected |
| B1's message changed | test 1 fails |
| unique constraint made partial over live rows | test 28 fails |

### KNOWN GAP — the line-removal refusal is correct but ILLEGIBLE

`inv_pending_serial.move_id` is `ON DELETE RESTRICT`, so `inv_remove_operation_line()` now
**refuses** to remove a line carrying generated labels. That is intended — the labels exist
physically and must be voided deliberately first.

But the function does a bare `DELETE FROM inv_move`, so the refusal surfaces as:

```
update or delete on table "inv_move" violates foreign key constraint
"inv_pending_serial_move_id_fkey" on table "inv_pending_serial"
```

**A correct refusal nobody can read is half a fix.** Smoke test 26 asserts legibility and is
**expected to fail** until `inv_remove_operation_line` composes its own sentence, the way it
already does for "This line has N unit(s) already received". Test 25 proves the refusal fires
and test 27 is the control. **That standing failure is the marker for the follow-up; it is not
a defect in this migration**, and the fix is its own approved change to an existing RPC.

### WHAT THE SUITE DOES NOT PROVE

`now()` is transaction-scoped, so inside a rolled-back suite `first_printed_at` and
`last_printed_at` are equal **by construction, whatever the function does**. Test 23 therefore
proves the print count rises and `first_printed_at` survives a reprint, and explicitly does
**not** assert their ordering — asserting it would be a claim decided by the harness rather
than by the code. In production each print is its own transaction and the two differ.

---

## PLANNED DOCUMENT TYPES — designed, not built

Not known issues. These are shapes the model is expected to grow, recorded so the design is
not re-derived from scratch.

### The delivery payment gate — BUILT INERT, must be switched on when Sales lands

**APPLIED 2026-08-17**, migration `20260817120000_delivery_payment_gate.sql`, smoke suite
`supabase/smoke/delivery_payment_gate_smoke.sql` (12 assertions).

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
| The reference | `inv_operation.sales_order_id`, nullable, `ON DELETE SET NULL`, added while `outgoing` held **zero** documents so there is no backfill question |
| The gate | **`inv_assert_delivery_paid(p_operation_id uuid)`** — exists, named, and **hard-fails**. It is NOT called from `inv_complete_operation` yet |
| **The screen** | **BUILT 2026-08-17.** The notice landed on `pages/inventory2/DeliveryNew.tsx` (`PaymentNotice`) and `pages/inventory2/DeliveryDetail.tsx` (`PaymentGateBanner`). The banner on the detail page is **standing and NOT dismissible** — it is a fact about the system, not an event to acknowledge, and it comes out when the gate is switched on |

The screen also shows the order's paid/total figures using the **same
`COALESCE(grand_total, total)` expression the gate will use**, so the screen and the gate
cannot quote different numbers — labelled shown-not-verified, because Sales does not
maintain them yet and they are not evidence either way.

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

**Switching it on** means: delete the `RAISE` marked `THE SWITCH` in
`inv_assert_delivery_paid`, then add the call to `inv_complete_operation` under a kind test
for `outgoing`. Two edits, one migration, one approval. The predicate below the switch is
already written and already decided — nothing about it is left to invent at that point.

#### The NULL case — DECIDED 2026-08-17 (V): an outgoing delivery with no sales order REFUSES

Legacy `complete_delivery_with_qc` passes trivially when `sales_order_id IS NULL` and its
own comment calls this an interface stub. **That is not carried forward.**

**The deciding argument is the foreign key.** `inv_operation.sales_order_id` is
`ON DELETE SET NULL` — chosen to match `source_purchase_order_id` and so that Inventory
cannot veto a Sales delete. If a null then passed trivially, **deleting a sales order would
silently convert an already-gated delivery into an ungated one**: a Sales-side delete would
become a way to bypass a payment gate, with nothing on either screen saying so and every
value involved still structurally valid. That is the same class of failure as a stale
destination on a move — correct-looking data, wrong meaning — and this module refuses it
everywhere else.

**The exemption is real, and it goes where return-to-vendor put it.** Samples and warranty
replacements are genuine non-order deliveries. They get their **own outgoing operation
type**, exactly as rejected stock got its own type rather than a supervisor override. An
exemption that is configured and visible on the document is auditable; an exemption that is
a missing value is not.

This is settled, not open. **Do not reopen it by copying the legacy trivial-pass branch.**

### UNSTAGE (DELIVERY ORDER → GODOWN) — now necessary, not theoretical

**This became visible the moment route enforcement landed, and it has a live example.**

Staging a unit for delivery moves it `GODOWN → DELIVERY ORDER`. Once the route is a rule,
**there is no lawful document that moves it back.** The only `internal` type is
`ITEM ESTIMATE` (`STOCK → DELIVERY ORDER`), which runs the wrong way, and no other type
accepts a unit sitting in `DELIVERY ORDER` except a delivery — which sends it to a customer.

**A staging mistake is currently irreversible.** The live example is `101205-2627-0008` and
`101205-2627-0009`: staged by `INT/2627/0001` for a delivery that shipped different units,
and now parked in transit with nowhere to go but out of the door.

| | |
|---|---|
| The shape | A dedicated `internal` operation type, `DELIVERY ORDER → GODOWN` |
| Why a type and not an override | The same reasoning as return-to-vendor: movement is controlled by WHICH DOCUMENT is used, not by who is clicking. An unstage that is a configured type is auditable; one that is a permission is not |
| Status of the two units | **Left where they are, deliberately.** They are correctly placed for a delivery and become deliverable under the new rule. See the route-enforcement section |

Note the sequencing lesson: enforcement did not *create* this gap, it **revealed** one that
had been there since staging existed. Before the rule, the gap was invisible because any
unit could be shipped from anywhere.

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
