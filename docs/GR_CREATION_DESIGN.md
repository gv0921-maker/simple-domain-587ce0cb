# Goods Receipt Creation — Numbering & Routing Design

**Status:** DESIGN ONLY — nothing applied. No code changed, no schema changed.
**Date:** 2026-07-30
**Verified against:** live project `mdtwvuiakvxoqvksemyt`, read-only session
(`supabase_read_only_user`, `transaction_read_only = on`), PostgreSQL 17.6.

Numbering and routing are designed together because both are decided at the same
moment — the instant a `goods_receipts` row is inserted — and both key off the
same field, `operation_type_id`, which is currently set almost nowhere.

**Decisions taken as given** (per the brief, not re-litigated here):

1. **Numbering — Option 2A.** Each operation type owns its own sequence, stored
   on the `operation_types` row. `generate_document_number` keys off
   `operation_type_id`. The global `numbering_sequences` table survives for
   modules with no operation types (Sales, Invoicing, Manufacturing, Returns)
   and must not break.
2. **Routing — default-driven with per-document override.** A GR's source/dest
   come from its operation type's defaults, auto-filled at creation, overridable
   per document; the completion RPCs read the *document's* stored values through
   a 3-tier COALESCE (document → op-type default → today's hardcoded logic).

---

## 0. Corrections to earlier findings

Two things stated in previous investigations were wrong. They change the risk
picture, so they are recorded here rather than quietly fixed.

**`gr_number` IS unique.** An earlier note claimed no `*_number` column had a
unique constraint. Verified false:

```
goods_receipts_gr_number_key                  UNIQUE (gr_number)
internal_transfer_orders_ito_number_key       UNIQUE (ito_number)
delivery_notes_reference_key                  UNIQUE (reference)
```

This is **good news**: a counter collision fails loudly with a unique violation
rather than silently duplicating a document number. It also means seeding
(§2c) must be right, or inserts simply error.

**There is no `is_default` column** on `warehouse_locations`, and never was — so
the "broken `is_default` fallback" in the brief does not exist. The actual GR
destination fallback is `warehouses.default_receipt_location_id`, then the oldest
active `internal` location. Both are quoted verbatim in §1c.

---

## PART 1 — Current GR creation, end to end

### 1a. How a GR gets its number today

The frontend never sets the number. `createGoodsReceipt`
(`src/lib/services/inventory/goodsReceipt.ts:126`) inserts seven columns and
`gr_number` is not among them:

```ts
const { data: gr, error } = await sb.from('goods_receipts').insert({
  source_type: input.source_type,
  source_document_id: input.source_document_id ?? null,
  source_document_reference: input.source_document_reference ?? null,
  warehouse_id: input.warehouse_id ?? null,
  notes: input.notes ?? null,
  status: 'quantity_pending',
  created_by: me,
}).select('*').single();
```

A trigger fills it:

```
trg_gr_set_number  BEFORE INSERT ON public.goods_receipts  FOR EACH ROW
```

```sql
CREATE OR REPLACE FUNCTION public.gr_set_number()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.gr_number IS NULL OR NEW.gr_number = '' THEN
    NEW.gr_number := public.generate_document_number('goods_receipt');
  END IF;
  RETURN NEW;
END $function$
```

Note the hardcoded literal `'goods_receipt'`. The operation type is not
consulted, and cannot be — the function takes only a document type.

```sql
CREATE OR REPLACE FUNCTION public.generate_document_number(p_document_type text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_fy text; v_padding integer; v_sep text; v_next integer; v_prefix text;
BEGIN
  v_fy := public.get_current_fy_label();
  SELECT sequential_padding, prefix_separator INTO v_padding, v_sep FROM public.numbering_settings LIMIT 1;
  IF v_padding IS NULL THEN v_padding := 4; END IF;
  IF v_sep IS NULL THEN v_sep := '-'; END IF;

  v_prefix := CASE lower(p_document_type)
    WHEN 'sales_order' THEN 'SO' WHEN 'quotation' THEN 'QT' WHEN 'invoice' THEN 'INV'
    WHEN 'delivery_note' THEN 'DN' WHEN 'internal_transfer' THEN 'ITO' WHEN 'internal_movement' THEN 'IM'
    WHEN 'vendor_order' THEN 'VO' WHEN 'work_order' THEN 'WO' WHEN 'return_request' THEN 'RT'
    WHEN 'credit_note' THEN 'CN' WHEN 'goods_receipt' THEN 'GR' WHEN 'payment_receipt' THEN 'PR'
    WHEN 'correction_order' THEN 'CO' WHEN 'stock_count' THEN 'SC' WHEN 'write_off' THEN 'WF'
    WHEN 'refund' THEN 'RF' WHEN 'exchange' THEN 'EX'
    ELSE upper(p_document_type) END;

  INSERT INTO public.numbering_sequences (document_type, fy_label, last_number)
  VALUES (p_document_type, v_fy, 1)
  ON CONFLICT (document_type, fy_label)
  DO UPDATE SET last_number = public.numbering_sequences.last_number + 1, updated_at = now()
  RETURNING last_number INTO v_next;

  RETURN v_prefix || v_sep || v_fy || v_sep || lpad(v_next::text, v_padding, '0');
END;
$function$
```

**Confirmed: it keys off `(document_type, fy_label)` against
`numbering_sequences` and ignores `operation_type_id` entirely.** Four inputs
from four places:

| part | source |
|---|---|
| `GR` | hardcoded `CASE` (also duplicated in `preview_next_document_number`) |
| `-` | `numbering_settings.prefix_separator` |
| `2627` | `get_current_fy_label()` ← `numbering_settings.fy_start_month/day`, Asia/Kolkata |
| `0011` | `numbering_sequences.last_number + 1`, padded to `sequential_padding` |

Live state: `numbering_sequences` row `('goods_receipt','2627',10)`; the 10 real
GRs are `GR-2627-0001` … `GR-2627-0010`. Counter and documents agree.

`operation_types.sequence_prefix` is **read by zero SQL functions** (verified by
scanning `pg_proc.prosrc`) and by no numbering code — only by config forms and a
display badge at `src/pages/inventory/InventoryOperationsOverview.tsx:78-79`.
`GR-2627-0001` belongs to the one GR that *does* carry
`operation_type_id` (GOODS RECEIVED, `sequence_prefix = 'RCP'`), which proves the
op type is ignored at numbering time.

### 1b. Is `operation_type_id` set at creation? No.

`goods_receipts.operation_type_id` exists (uuid, FK → `operation_types(id)`
ON DELETE SET NULL) and is populated on **1 of 10** rows — `GR-2627-0001`, which
also has `warehouse_id` NULL and looks like a manual test insert.

Nothing sets it:

- `createGoodsReceipt` (`goodsReceipt.ts:126-134`) — not in the payload.
- No trigger or RPC writes it (`pg_proc` scan).
- `src/pages/inventory/InventoryOperationsOverview.tsx:98` navigates to
  `…?operation_type_id=${t.id}`, but **no page reads that query parameter back**.
- `src/pages/inventory/InventoryOverview.tsx:51` already carries the comment
  *"Documents don't yet reliably carry operation_type_id"*.

**Where it must be set.** Both numbering and routing need it *before* the row is
written, and numbering needs it inside a `BEFORE INSERT` trigger. So the value
must arrive **in the INSERT payload** — a trigger cannot invent it. Two changes
are therefore unavoidable:

1. `CreateGoodsReceiptInput` gains `operation_type_id`, passed through at
   `goodsReceipt.ts:126`.
2. The GR wizard (`src/pages/inventory/GoodsReceiptWizard.tsx`) supplies it,
   reading the already-emitted `?operation_type_id=` param.

Ordering consequence: **the numbering trigger must tolerate a NULL
`operation_type_id`** and fall back to today's path, because the frontend change
lands after the backend one and legacy callers will never supply it.

### 1c. How the two completion RPCs resolve destination today

Two functions write the receipt ledger, with duplicated logic.

**`complete_gr_line_qc(p_gr_line_id, p_passed_serial_ids, p_failed_serial_ids, p_failed_notes)`**

Destination — warehouse default, then oldest active internal location:

```sql
  IF v_wh_id IS NOT NULL THEN
    SELECT default_receipt_location_id INTO v_loc_id
      FROM public.warehouses WHERE id = v_wh_id;
    IF v_loc_id IS NULL THEN
      SELECT id INTO v_loc_id
        FROM public.warehouse_locations
       WHERE warehouse_id = v_wh_id
         AND type = 'internal'
         AND COALESCE(is_active, true) = true
       ORDER BY created_at ASC
       LIMIT 1;
    END IF;
  END IF;
```

Source — hardcoded code lookup:

```sql
  SELECT id INTO v_vendor_loc_id FROM public.warehouse_locations WHERE code = 'VDR106' LIMIT 1;
```

Ledger write, gated on both being non-NULL, and the source *name* hardcoded:

```sql
    IF v_vendor_loc_id IS NOT NULL AND v_loc_id IS NOT NULL THEN
      ...
          'receipt', v_vendor_loc_id, 'VENDORS',
          v_loc_id, v_loc_name,
```

**`record_gr_item_qc(_serial_id, _passed, _notes, _images)`** — the per-serial
sibling, repeating the same resolution:

```sql
  v_wh_id := COALESCE(v_ser.current_warehouse_id, v_gr.warehouse_id);
  IF v_wh_id IS NOT NULL THEN
    SELECT default_receipt_location_id INTO v_loc_id FROM public.warehouses WHERE id = v_wh_id;
    IF v_loc_id IS NULL THEN
      SELECT id INTO v_loc_id FROM public.warehouse_locations
       WHERE warehouse_id = v_wh_id AND type = 'internal' AND COALESCE(is_active,true)
       ORDER BY created_at ASC LIMIT 1;
    END IF;
  END IF;
  SELECT id INTO v_vendor_loc_id FROM public.warehouse_locations WHERE code = 'VDR106' LIMIT 1;
```

Differences that matter:

| | `complete_gr_line_qc` | `record_gr_item_qc` |
|---|---|---|
| warehouse source | `goods_receipts.warehouse_id` | `COALESCE(serial.current_warehouse_id, gr.warehouse_id)` |
| duplicate-ledger guard | `NOT EXISTS` on `stock_move_lines` | **none** |
| NULL location | **silent skip** | silent skip |

**Both warehouses have all six `default_*_location_id` columns NULL**, so the
`ORDER BY created_at ASC LIMIT 1` internal-location fallback is what actually
runs in production today.

---

## PART 2 — Numbering design (Option 2A)

### 2a. Columns to add to `operation_types`

`sequence_prefix` (text, nullable) already exists and is reused as-is. Five
additions, all nullable or defaulted so the existing 4 rows keep working:

```
operation_types
  + sequence_fy_label       text     NULL           -- the FY this counter belongs to
  + sequence_current_number integer  NOT NULL DEFAULT 0
  + sequence_padding        integer  NULL           -- NULL => inherit numbering_settings
  + sequence_separator      text     NULL           -- NULL => inherit numbering_settings
  + owns_sequence           boolean  NOT NULL DEFAULT false
```

Design notes, each deliberate:

- **`owns_sequence` is the switch.** With it defaulting `false`, adding these
  columns changes nothing: every op type continues to number through
  `numbering_sequences` until explicitly opted in. This is what makes step 1
  pure-additive and lets the four existing types be migrated one at a time.
- **`sequence_padding` / `sequence_separator` nullable = inherit.** A NULL means
  "use `numbering_settings`", so the global format still applies unless an op
  type deliberately overrides it. Avoids duplicating format config 4× and
  keeps the Numbering config page meaningful.
- **`sequence_fy_label` carries the year the counter is in**, mirroring
  `numbering_sequences.fy_label`. On the first document of a new financial year
  the RPC resets the counter to 1 and stamps the new label (§2b). Without this
  column a per-op-type counter would run continuously across years, which breaks
  the FY-scoped numbering the business already uses.
- **`sequence_current_number` is NOT NULL DEFAULT 0**, matching the semantics of
  `numbering_sequences.last_number` and `serial_counters.last_number`: it is the
  count already *issued*, so the first document is 1.

Deliberately **not** proposed: a unique constraint on `sequence_prefix`. Two op
types may legitimately share a prefix while having separate counters — and
enforcing uniqueness would reject the current data if two types were both given
`'INT'`. Collisions are caught by the existing `UNIQUE (gr_number)` anyway.

Constraint worth adding in the same step (cheap, prevents a silent trap):

```
CHECK (NOT owns_sequence OR (sequence_prefix IS NOT NULL AND sequence_fy_label IS NOT NULL))
```

so an op type cannot be switched on without the two fields the formatter needs.

### 2b. How `generate_document_number` changes

New signature and behaviour, described precisely — **not implemented here**:

```
generate_document_number(p_document_type text, p_operation_type_id uuid DEFAULT NULL)
```

Branch on whether an op type owns its sequence:

**Branch A — op-type-owned** (taken when `p_operation_type_id IS NOT NULL` and
that row has `owns_sequence = true`):

1. `SELECT … FROM operation_types WHERE id = p_operation_type_id FOR UPDATE` —
   row-level lock, which is what makes the increment atomic and concurrent-safe.
   This replaces the atomicity that `INSERT … ON CONFLICT DO UPDATE` provides in
   the global path.
2. `v_fy := get_current_fy_label()`.
3. **FY roll-over:** if `sequence_fy_label IS DISTINCT FROM v_fy`, set
   `sequence_current_number := 1` and `sequence_fy_label := v_fy`; otherwise
   `sequence_current_number := sequence_current_number + 1`.
4. Format with `COALESCE(sequence_separator, numbering_settings.prefix_separator, '-')`
   and `COALESCE(sequence_padding, numbering_settings.sequential_padding, 4)`.
5. `UPDATE operation_types SET sequence_current_number = …, sequence_fy_label = …,
   updated_at = now() WHERE id = p_operation_type_id`, and return
   `sequence_prefix || sep || fy || sep || lpad(n, pad, '0')`.

**Branch B — global fallback** (every other case: `p_operation_type_id` NULL, the
row missing, or `owns_sequence = false`): run **today's body verbatim**, including
the hardcoded `CASE`. This is the clause that keeps Sales, Invoicing,
Manufacturing and Returns untouched, and keeps legacy GR inserts working while
the frontend catches up.

`preview_next_document_number` needs the **same two-branch treatment** with the
same optional parameter, reading without incrementing (`sequence_current_number + 1`,
and pretending a roll-over yields 1). It must not be forgotten: the rebuilt
Numbering page and `numberingMeta.ts` both rely on it, and the prefix `CASE` is
duplicated across both functions — they drift the moment only one is changed.

`gr_set_number()` changes by one argument:

```sql
  NEW.gr_number := public.generate_document_number('goods_receipt', NEW.operation_type_id);
```

`NEW.operation_type_id` is available in a `BEFORE INSERT` trigger, which is why
the value has to arrive in the INSERT payload (§1b).

### 2c. Back-compat and seeding

Existing GRs keep their numbers — nothing rewrites `gr_number`. The question is
what the *next* number is.

**Two cases, and only one needs seeding:**

| op type prefix | risk | seeding |
|---|---|---|
| **differs** from the global prefix (e.g. `RCP` vs `GR`) | none — `RCP-2627-0001` cannot collide with `GR-2627-0010` | seed 0; a genuinely new series |
| **equals** the global prefix (`GR`) | **real** — `GR-2627-0001` already exists and `gr_number` is UNIQUE, so the insert would fail | seed from the existing maximum |

The seeding rule, following the `serial_counters` precedent (`prefix`,
`last_number`, seeded once in migration `20260725091614_…`):

```
sequence_current_number :=
  GREATEST(
    0,
    -- the global counter for this document type and FY
    (SELECT COALESCE(last_number,0) FROM numbering_sequences
      WHERE document_type = <type> AND fy_label = <fy>),
    -- and the highest number actually present on documents, in case the two drift
    (SELECT COALESCE(MAX(substring(gr_number from '(\d+)$')::int), 0)
       FROM goods_receipts
      WHERE gr_number LIKE <prefix> || <sep> || <fy> || <sep> || '%')
  )
```

Taking the `GREATEST` of both sources is the point: the counter alone would be
wrong if a document were ever inserted with an explicit number (the trigger only
fills when `gr_number IS NULL OR = ''`), and the documents alone would be wrong
if numbers had been issued then rolled back.

For today's data with prefix `GR` and FY `2627`: both sources give **10**, so
GOODS RECEIVED would seed to 10 and the next GR is `GR-2627-0011` — continuous
with history, no regression, no collision.

**Recommendation:** seed as above regardless of whether the prefix differs. It
costs nothing when there is no overlap and removes an entire failure mode if
someone later edits a prefix to match an old series.

### 2d. The signature-change landmine

**Yes, this is the `create_ito_from_so` problem again, and worse.**
`CREATE OR REPLACE FUNCTION` with a different argument list creates a **second**
function rather than replacing the first. PostgREST resolves RPCs by argument
names and would then reject calls as ambiguous — breaking numbering for **every
module at once**.

The migration must therefore:

```sql
DROP FUNCTION IF EXISTS public.generate_document_number(text);
DROP FUNCTION IF EXISTS public.preview_next_document_number(text);
-- then CREATE the new two-argument versions
```

Post-apply verification, non-negotiable:

```sql
SELECT proname, pg_get_function_identity_arguments(oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public'
   AND proname IN ('generate_document_number','preview_next_document_number');
-- expect EXACTLY ONE row per function
```

**Alternative that avoids the drop entirely, and is safer:** keep
`generate_document_number(text)` exactly as it is, and add a *separately named*
function — `generate_document_number_for_op_type(text, uuid)` — which
`gr_set_number` calls. No overload, no signature change, no risk to the other 16
callers, and the global path is provably untouched because its function is not
edited at all. The cost is a second function name to maintain. **Given that this
function is the numbering path for nine triggers across every module, I would
take that trade.** Flagged as an explicit decision (§Open questions Q1).

**Every current caller of `generate_document_number`** — 17 functions, verified
by `pg_proc.prosrc` scan. If the signature is changed with a defaulted parameter,
all continue to compile; but each must be reviewed to confirm none passes
positional arguments:

```
apply_stock_action (×2)   auto_create_correction_order   cn_set_defaults
complete_pick_to_transit  create_ito_from_so             create_partial_delivery_note
create_partial_invoice    enforce_real_time_payment_date enforce_real_time_refund_date
exch_set_defaults         gr_set_number                  im_set_number
return_requests_set_number stock_counts_set_number       vo_set_number
wf_set_number             wo_set_number
```

Frontend callers, both by named argument (safe under a defaulted parameter):

```
src/lib/services/numbering/api.ts:69   rpc('generate_document_number',      { p_document_type })
src/lib/services/numbering/api.ts:76   rpc('preview_next_document_number',  { p_document_type })
```

Note `im_set_number` writes `internal_movements`, which **already has**
`operation_type_id` — so internal movements are the natural second candidate
after GR, with no extra column needed.

---

## PART 3 — Routing design (GR slice)

### 3a. Setting `operation_type_id` and auto-filling source/dest

The columns already exist (migration `20260729090000`, applied and verified):
`goods_receipts.source_location_id` and `.dest_location_id`, both uuid NULL,
FK → `warehouse_locations(id)` ON DELETE SET NULL.

**`BEFORE INSERT` trigger on `goods_receipts`**, filling only what the caller
left NULL:

```
trg_gr_fill_default_locations  BEFORE INSERT ON public.goods_receipts
  IF NEW.operation_type_id IS NOT NULL THEN
    NEW.source_location_id := COALESCE(NEW.source_location_id, ot.default_source_location_id);
    NEW.dest_location_id   := COALESCE(NEW.dest_location_id,   ot.default_dest_location_id);
  END IF;
```

Three properties that make this the right shape:

- **`COALESCE` is the override mechanism.** An explicitly supplied value always
  wins; no extra flag, no separate code path. "Was this overridden?" is
  answerable as
  `document.dest_location_id IS DISTINCT FROM operation_type.default_dest_location_id`.
- **`BEFORE INSERT` only, never `BEFORE UPDATE`.** An update that clears a
  location must stay cleared, not silently re-seed from the op type.
- **Defaults are captured at creation, not read at completion.** Editing an op
  type's defaults later must not retroactively move an in-flight GR's
  destination. This is the accounting-correct behaviour and it is why the
  completion RPCs read the document, not the op type.

Ordering note: this trigger and `trg_gr_set_number` both fire `BEFORE INSERT` on
the same table. PostgreSQL fires them **alphabetically by trigger name**:
`trg_gr_fill_default_locations` < `trg_gr_set_number`. They touch disjoint
columns so order is immaterial today — but the naming should be checked
deliberately rather than relied on by accident.

### 3b. Changing both completion RPCs, and keeping them in sync

The shape of the change is identical in both: **wrap today's resolution in a
`COALESCE` whose first argument is the document's column, leaving the existing
expression as the tail.** No existing line is deleted, so NULL-valued legacy GRs
behave exactly as they do now.

**`complete_gr_line_qc`** — five mechanical edits:

1. Declare `v_doc_src uuid; v_doc_dst uuid;`.
2. Extend the existing header `SELECT` — currently
   `SELECT gr.goods_receipt_id, grh.warehouse_id, grh.gr_number INTO …` — to also
   select `grh.source_location_id, grh.dest_location_id`. Same join, no extra query.
3. After the existing warehouse-default block: `v_loc_id := COALESCE(v_doc_dst, v_loc_id);`
4. Source: assign the `VDR106` lookup to a temp, then
   `v_vendor_loc_id := COALESCE(v_doc_src, v_tmp);`
5. **Replace the literal `'VENDORS'`** in the `stock_moves` insert with a name
   lookup for `v_vendor_loc_id`. Non-optional: once the id can be overridden, a
   hardcoded name writes a ledger row whose `source_location_name` contradicts its
   own `source_location_id`.

**`record_gr_item_qc`** — the same five edits, but sourced from `v_gr`, which is
already loaded as `public.goods_receipts%ROWTYPE`, so **no query change at all**.

**Keeping the pair in sync — the real design question.** They can currently
disagree because they derive the warehouse differently
(`gr.warehouse_id` vs `COALESCE(serial.current_warehouse_id, gr.warehouse_id)`).
Once both read `goods_receipts.dest_location_id` **first**, that divergence stops
mattering on any GR that has a destination stored — the document is the single
source of truth and both paths reach the same answer. The divergence survives
only in the fallback tail, for legacy NULL rows.

Two options for the tail, and a recommendation:

- **(i) Leave both tails as they are.** Legacy GRs keep behaving exactly as
  today, including the possible divergence. Zero risk, permanent inconsistency.
- **(ii) Extract one shared helper**, e.g.
  `resolve_gr_receipt_location(p_gr_id uuid, p_serial_id uuid DEFAULT NULL)`,
  and have both call it. Removes the duplication permanently and makes future
  changes single-site — but it is a refactor of two proven RPCs in the same
  breath as a behaviour change, which CLAUDE.md rule 3 says to split.

**Recommendation: (i) now, (ii) as a separate later commit** once the COALESCE
work is verified. The duplication is pre-existing; this design should not take on
removing it while also changing behaviour.

### 3c. The silent-NULL swallow — its own step

`complete_gr_line_qc` gates the entire ledger write on both locations being
non-NULL:

```sql
    IF v_vendor_loc_id IS NOT NULL AND v_loc_id IS NOT NULL THEN
```

If either is NULL the serials are still flipped to `available` and the GR still
completes, but **no `stock_moves`/`stock_move_lines` rows are written and no error
is raised** — stock exists with no ledger entry. `record_gr_item_qc` has the same
gate.

`GR-2627-0001` is the live instance: `operation_type_id` set, `warehouse_id`
NULL, so `v_loc_id` resolves NULL and the ledger was skipped silently. (It is
already `completed`, so nothing will re-run for it.)

This is exactly what CLAUDE.md rule 5 forbids. The fix — `RAISE EXCEPTION` naming
which location failed to resolve — is a **deliberate behaviour change to a proven
RPC** and belongs in its own commit, applied after the COALESCE work so that most
NULL cases have already been designed away.

---

## PART 4 — Sequencing & risk

Steps 1–4 are **pure additions with zero behaviour change**. Everything from
step 5 modifies a proven RPC and needs separate sign-off.

| # | step | type | behaviour change | revert |
|---|---|---|---|---|
| 1 | Add 5 sequence columns + the `owns_sequence` CHECK to `operation_types` | SQL, additive | **none** — `owns_sequence` defaults false | `DROP COLUMN` |
| 2 | Add `trg_gr_fill_default_locations` (BEFORE INSERT) | SQL, additive | **none** — nothing sets `operation_type_id` yet | `DROP TRIGGER` |
| 3 | Frontend: `CreateGoodsReceiptInput` gains `operation_type_id`; wizard reads the `?operation_type_id=` param | TS | GRs start carrying an op type; locations start auto-filling | revert commit |
| 4 | Seed `sequence_current_number` / `sequence_fy_label` per op type (§2c), still `owns_sequence = false` | SQL, data | **none** — nothing reads them yet | re-run with 0 |
| 5 | ⚠ Numbering function: either new `…_for_op_type(text,uuid)` **or** DROP + recreate both existing functions (§2d, Q1) | SQL, **proven RPC** | none while `owns_sequence` false | restore captured `pg_get_functiondef` |
| 6 | ⚠ `gr_set_number` passes `NEW.operation_type_id` | SQL, **proven RPC** | none while `owns_sequence` false | as above |
| 7 | **Flip `owns_sequence = true` on GOODS RECEIVED only** | SQL, data | **yes — new GRs get `RCP-…`** | flip back to false |
| 8 | ⚠ `complete_gr_line_qc` + `record_gr_item_qc`: COALESCE document dest/source in; fix the `'VENDORS'` literal | SQL, **proven RPC ×2** | none when doc columns NULL | as above |
| 9 | ⚠ Rule-5 fix: NULL location → `RAISE` instead of silent skip | SQL, **proven RPC ×2** | **yes, deliberate** | as above |
| 10 | Frontend: source/dest override fields on the GR form | TS | overrides reachable | revert commit |
| 11 | *(optional, separate)* extract the shared location-resolution helper | SQL refactor | none | as above |

**Before step 5, capture `pg_get_functiondef()` for all five affected functions**
(`generate_document_number`, `preview_next_document_number`, `gr_set_number`,
`complete_gr_line_qc`, `record_gr_item_qc`) into `docs/rpc-baselines/`. That file
*is* the revert plan for steps 5–9 and costs nothing.

**Recommended first review round: stop after step 4.** The schema supports the
model, seeding is in place, and nothing behaves differently — so the open
questions can be answered with the columns in front of you.

### Proven-RPC touches and how to verify each

| RPC | step | verification |
|---|---|---|
| `generate_document_number` | 5 | exactly one row per function name in `pg_proc` (§2d); then `SELECT preview_next_document_number('sales_order')` still returns `SO-2627-0007` — proves the global branch is intact |
| `preview_next_document_number` | 5 | rebuilt Numbering page still renders previews for all 7 sequences |
| `gr_set_number` | 6 | create a GR with `operation_type_id` NULL → still `GR-2627-00NN`, counter advances in `numbering_sequences` |
| `gr_set_number` + op type | 7 | create a GR under GOODS RECEIVED → `RCP-2627-0001`; `numbering_sequences.goods_receipt` **unchanged**; `operation_types.sequence_current_number` = 1 |
| `complete_gr_line_qc` | 8, 9 | GR with a dest → `stock_move_lines.destination_location_id` equals the document's; GR with NULL → falls back to STK103 as today |
| `record_gr_item_qc` | 8, 9 | same GR via the per-serial path yields the **same** destination as the batch path |

**Baseline to diff against (captured 2026-07-30):**

```sql
SELECT count(*) FROM stock_moves;              -- 8
SELECT count(*) FROM stock_move_lines;         -- 8
SELECT stock_status, qc_status, current_location, count(*)
  FROM goods_receipt_serials GROUP BY 1,2,3;   -- 16 serials: 7+4+2 STK103, 2 DLV-ORD105, 1 CRT111
SELECT gr_number FROM goods_receipts ORDER BY created_at;  -- GR-2627-0001 … 0010
SELECT document_type, fy_label, last_number FROM numbering_sequences;  -- 7 rows
-- ledger name/id agreement (§3b item 5)
SELECT m.id, m.source_location_name, l.name
  FROM stock_moves m JOIN warehouse_locations l ON l.id = m.source_location_id
 WHERE m.source_location_name IS DISTINCT FROM l.name;   -- expect 0 rows
```

Steps 1–7 must leave all 16 serials and both ledger counts **untouched** — they
concern creation, not completion. Only steps 8–9 can legitimately change ledger
behaviour, and then only for newly completed GRs.

### Thin-verification warnings

- **1 product, 16 serials, 2 warehouses, 10 GRs.** Small surface; the ITO transit
  lookup is deterministic today only because GLF101 happens to have exactly one
  transit location.
- **`complete_ito_with_qc` is not idempotent** (raises `'ITO already completed'`,
  uses `CREATE TEMP TABLE … ON COMMIT DROP`), so failed verification runs need a
  fresh document rather than a retry. The same caution applies to GR QC flows.
- **Both warehouses have every `default_*_location_id` NULL.** If anyone sets one
  during this work, GR destinations shift underneath the migration. Re-check
  immediately before step 8.

### Scope confirmation

**Nothing here touches CRM.** Tables in scope — `operation_types`,
`goods_receipts`, `warehouse_locations`, `numbering_sequences`,
`numbering_settings` — appear in neither CLAUDE.md's CRM-protected inventory (the
ten `crm_*` tables plus the `customers` special case) nor the shared-boundary file
list. No CRM file references any of them.

**Non-inventory numbering is preserved by construction.** Sales, Invoicing,
Manufacturing and Returns documents have no operation type, so every one of them
takes Branch B — today's body, verbatim, against `numbering_sequences`. Under the
`…_for_op_type` variant (Q1) their function is not even edited. The
`numbering_sequences` rows for `sales_order`, `quotation` and `payment_receipt`
are never written by the op-type path.

---

## Open questions for review

**Q1 — new function name, or DROP + recreate?** Recommendation:
`generate_document_number_for_op_type(text, uuid)` alongside the untouched
originals. Avoids the PostgREST ambiguity hazard entirely and leaves the
nine-trigger global path provably unmodified, at the cost of a second name.

**Q2 — should `sequence_prefix` stay editable meanwhile?** It is currently
editable on the rebuilt Operation Types form and consumed by nothing, so a user
can set `RCP` and reasonably expect `RCP-2627-0011`. Until step 7 that is a
false promise. Options: make it read-only with a note, or accept the gap and
ship steps 1–7 quickly.

**Q3 — one op type per document kind, or many?** Three internal-transfer types
already exist (ITEM ESTIMATE, KADRI - ITEM ESTIMATE, RETURNS) sharing one
`internal_transfer` counter. Per-op-type sequences give each its own series —
confirm that is wanted for ITO as well as GR before extending past step 7.

**Q4 — FY roll-over on the op-type row.** The design resets
`sequence_current_number` to 1 when `sequence_fy_label` changes. That silently
discards the previous year's final count. If year-end audit needs it, the
counter should be archived to `numbering_sequences` (or a history table) on
roll-over rather than overwritten.

**Q5 — should `record_gr_item_qc` gain the missing duplicate-ledger guard?**
`complete_gr_line_qc` has a `NOT EXISTS` check; its sibling does not, so the
per-serial path can write duplicate ledger rows on re-run. Pre-existing, out of
scope here, but it belongs on the list.
