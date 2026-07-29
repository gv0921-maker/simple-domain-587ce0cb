# Operation Types — Default-Driven Source/Destination Design

**Status:** DESIGN ONLY — nothing applied. No code changed, no schema changed.
**Date:** 2026-07-28
**Verified against:** live project `mdtwvuiakvxoqvksemyt`, read-only session
(`supabase_read_only_user`, `transaction_read_only = on`), PostgreSQL 17.6.

Every schema fact, row count and SQL quotation below was read from the live database
during this session via `information_schema`, `pg_constraint` and
`pg_get_functiondef()`. Frontend claims are cited to `file:line`.

**Goal being designed for:** make operation types real and default-driven — many
operation types (multiple GR types, multiple ITO types keyed to different locations),
each with a configurable default source and destination location; documents auto-fill
source/dest from the chosen operation type but allow a per-document override; completion
RPCs move stock using the *document's* source/dest, respecting overrides.

---

## 1. Current state (verified)

### 1.1 `operation_types` — full column list

20 columns. **The two default-location columns already exist.**

| # | column | type | null | default |
|---|---|---|---|---|
| 1 | `id` | uuid | NO | `gen_random_uuid()` |
| 2 | `name` | text | NO | — |
| 3 | `operation_kind` | text | NO | — |
| 4 | `sequence_prefix` | text | YES | — |
| 5 | **`default_source_location_id`** | uuid | YES | — |
| 6 | **`default_dest_location_id`** | uuid | YES | — |
| 7 | `create_backorder` | text | YES | `'ask'` |
| 8 | `use_existing_lots` | boolean | YES | `true` |
| 9 | `create_new_lots` | boolean | YES | `true` |
| 10 | `is_active` | boolean | NO | `true` |
| 11 | `created_at` | timestamptz | NO | `now()` |
| 12 | `updated_at` | timestamptz | NO | `now()` |
| 13 | `card_color` | text | YES | `'gray'` |
| 14 | `returns_operation_type_id` | uuid | YES | — |
| 15 | `print_delivery_slip` | boolean | YES | `false` |
| 16 | `print_product_labels` | boolean | YES | `false` |
| 17 | `print_lot_serial_labels` | boolean | YES | `false` |
| 18 | `mandatory_scan_product` | boolean | YES | `false` |
| 19 | `mandatory_scan_lot_serial` | boolean | YES | `false` |
| 20 | `allow_extra_products` | boolean | YES | `true` |

Constraints:

```
operation_types_operation_kind_check
  CHECK (operation_kind = ANY (ARRAY['receipt','delivery','internal_transfer','manufacturing']))
operation_types_create_backorder_check
  CHECK (create_backorder = ANY (ARRAY['ask','always','never']))
operation_types_default_source_location_id_fkey
  FOREIGN KEY (default_source_location_id) REFERENCES warehouse_locations(id)
operation_types_default_dest_location_id_fkey
  FOREIGN KEY (default_dest_location_id) REFERENCES warehouse_locations(id)
operation_types_returns_operation_type_id_fkey
  FOREIGN KEY (returns_operation_type_id) REFERENCES operation_types(id) ON DELETE SET NULL
```

Note: the two location FKs have **no** `ON DELETE` action (i.e. `NO ACTION` — a location
referenced as a default cannot be deleted). There is **no** unique constraint on `name`
or `sequence_prefix`.

### 1.2 The 4 existing `operation_types` rows

| name | kind | prefix | default source | default dest | backorder | returns→ | card |
|---|---|---|---|---|---|---|---|
| ITEM ESTIMATE | internal_transfer | INT | **NULL** | `DLV-ORD105` (DELIVERY ORDER, transit) | always | — | amber |
| GOODS RECEIVED | receipt | RCP | **NULL** | **NULL** | always | — | purple |
| DELIVERY NOTE | delivery | DEL | **NULL** | `CTMR107` (CUSTOMERS, customer) | ask | ITEM ESTIMATE | green |
| RETURNS | internal_transfer | RTN | `CTMR107` (CUSTOMERS) | `STK103` (STOCK, internal) | never | — | red |

All 4 are `is_active = true`. IDs:

```
ITEM ESTIMATE   3304bd87-dede-4474-98da-7f4af29f0cd9
GOODS RECEIVED  b1717627-54b6-49ce-a606-db939443f3af
DELIVERY NOTE   e56f13af-607f-4b7e-bb7d-51edfa1ca3ed
RETURNS         72a4dd9d-7323-4909-952a-a6d7371d4c9e
```

Observation: 4 of the 8 default slots are already populated, and **nothing reads them**.
The data model for "default-driven" is half-built; the consumption side is entirely absent.

### 1.3 Document tables — what exists for operation type and locations

| table | `operation_type_id` | source location col | dest location col | `warehouse_id` |
|---|---|---|---|---|
| `goods_receipts` | ✅ col 20, uuid, FK → `operation_types(id)` ON DELETE SET NULL | ❌ **none** | ❌ **none** | ✅ col 13 |
| `delivery_notes` | ✅ col 26, uuid, FK → `operation_types(id)` ON DELETE SET NULL | ❌ **none** | ❌ **none** | ✅ col 5 |
| `internal_transfer_orders` | ❌ **none** | ❌ **none** | ❌ **none** | ❌ **none** |

`internal_transfer_orders` has only 10 columns: `id, ito_number, sales_order_id, status,
confirmed_by, confirmed_at, notes, created_by, created_at, updated_at`. It is bound to a
sales order and carries no spatial information at all.

**Precedent worth noting:** `internal_movements` already has the target shape —
`operation_type_id` (col 16) *plus* `from_location_id` (col 5) / `to_location_id` (col 7).
That table is the one place where the intended model is structurally complete.

### 1.4 Is any of it populated today? (real rows)

| table | rows | with `operation_type_id` | with `warehouse_id` |
|---|---|---|---|
| `goods_receipts` | 10 | **1** | 9 |
| `delivery_notes` | **0** | 0 | 0 |
| `internal_transfer_orders` | 4 | n/a (no column) | n/a (no column) |

The single GR that carries an operation type:

| gr_number | status | operation type | warehouse |
|---|---|---|---|
| GR-2627-0001 | completed | GOODS RECEIVED | **NULL** |
| GR-2627-0002 … 0010 | completed (0004 = qc_pending) | NULL | GLF101 |

That one row is a trap worth naming now: it is the *only* GR with an operation type and
it is also the *only* GR with a NULL warehouse — so under today's logic it resolves to no
destination at all (see §1.5.1). It looks like a manual test insert, not a product path.

Where `operation_type_id` would be set, today: **nowhere.**

- `src/lib/services/inventory/goodsReceipt.ts:126-134` — `createGoodsReceipt` insert
  payload lists `source_type, source_document_id, source_document_reference,
  warehouse_id, notes, status, created_by`. No `operation_type_id`.
- `src/lib/services/inventory/deliveryNotes.ts:214` and `:324` — both DN insert paths
  build `insertRow` without `operation_type_id`.
- `create_ito_from_so` inserts `(ito_number, sales_order_id, status, created_by,
  confirmed_by, confirmed_at)` — the column does not exist to set.
- `src/pages/inventory/InventoryOperationsOverview.tsx:98,106` navigates to
  `…?operation_type_id=${t.id}` — but **no page under `src/pages/inventory` reads that
  query parameter back**. The link is written and dropped.
- `src/pages/inventory/InventoryOverview.tsx:51` already carries the comment
  *"Documents don't yet reliably carry operation_type_id"*.

### 1.5 Exact current source/dest resolution logic

#### 1.5.1 `complete_gr_line_qc(p_gr_line_id, p_passed_serial_ids, p_failed_serial_ids, p_failed_notes)`

**Destination** — warehouse default, then "first active internal location":

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

  SELECT name INTO v_loc_name FROM public.warehouse_locations WHERE id = v_loc_id;
```

**Source** — hardcoded literal code:

```sql
  SELECT id INTO v_vendor_loc_id FROM public.warehouse_locations WHERE code = 'VDR106' LIMIT 1;
```

**Ledger write, gated on both being non-NULL** (comment is the function's own):

```sql
    -- Ledger: one stock_moves row per passed serial (VENDORS -> receipt
    -- location). The NOT EXISTS guard keeps re-runs from writing duplicates.
    IF v_vendor_loc_id IS NOT NULL AND v_loc_id IS NOT NULL THEN
```

…and the move itself hardcodes the source *name* as a string literal:

```sql
          'GRQC/' || substr(v_ser.id::text, 1, 8),
          'receipt', v_vendor_loc_id, 'VENDORS',
          v_loc_id, v_loc_name,
```

⚠ **Silent-skip:** if either location resolves NULL, the serials are still flipped to
`available` but **no ledger rows are written and no error is raised**. That is exactly the
error-swallowing CLAUDE.md §5 forbids, and GR-2627-0001 (warehouse NULL) is a live example
of a row that would hit it.

Note also: **`warehouses.default_receipt_location_id` is NULL for both warehouses**
(GLF101 and FTY102 — all six `default_*_location_id` columns are NULL). So in practice the
`ORDER BY created_at ASC LIMIT 1` internal-location fallback is what is running today.

#### 1.5.2 `record_gr_item_qc(_serial_id, _passed, _notes, _images)` — not in the brief, but same hardcoding

This per-serial sibling of `complete_gr_line_qc` repeats the identical pattern and must be
in scope or the two will diverge:

```sql
  v_wh_id := COALESCE(v_ser.current_warehouse_id, v_gr.warehouse_id);

  IF v_wh_id IS NOT NULL THEN
    SELECT default_receipt_location_id INTO v_loc_id FROM public.warehouses WHERE id = v_wh_id;
    IF v_loc_id IS NULL THEN
      SELECT id INTO v_loc_id
        FROM public.warehouse_locations
       WHERE warehouse_id = v_wh_id AND type = 'internal' AND COALESCE(is_active,true)
       ORDER BY created_at ASC LIMIT 1;
    END IF;
  END IF;

  SELECT id INTO v_vendor_loc_id FROM public.warehouse_locations WHERE code = 'VDR106' LIMIT 1;
```

It has **no `NOT EXISTS` duplicate guard** on the ledger insert, unlike `complete_gr_line_qc`.

#### 1.5.3 `complete_ito_with_qc(_ito_id)`

**Failure path destination** — hardcoded `CRT111`, and (correctly) raises rather than skips:

```sql
    SELECT id, name INTO v_correction_loc_id, v_correction_loc_name
    FROM warehouse_locations WHERE code = 'CRT111' LIMIT 1;
    IF v_correction_loc_id IS NULL THEN
      RAISE EXCEPTION 'CORRECTION virtual location not configured';
    END IF;
```

**Success path destination** — warehouse inferred *from the serials*, then first transit
location in that warehouse:

```sql
  SELECT (SELECT current_warehouse_id FROM _insp WHERE qc_status='pass' AND current_warehouse_id IS NOT NULL LIMIT 1)
    INTO v_warehouse_id;
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Reserved serials are missing a warehouse — cannot resolve transit location.';
  END IF;

  SELECT id, name INTO v_transit_loc
  FROM warehouse_locations
  WHERE warehouse_id = v_warehouse_id AND type = 'transit' AND is_active = true
  LIMIT 1;
  IF v_transit_loc.id IS NULL THEN
    RAISE EXCEPTION 'No transit location configured for warehouse %', v_warehouse_id;
  END IF;
```

**Source** — per-serial, taken from the serial's own current position (note the text→uuid
cast; `goods_receipt_serials.current_location` is `text` holding a uuid):

```sql
      NULLIF(r.current_location,'')::uuid, NULL,
```

The `LIMIT 1` on the transit lookup is a live ambiguity: GLF101 has exactly one transit
location today (`DLV-ORD105`), so it happens to be deterministic — but nothing enforces that.

#### 1.5.4 `complete_delivery_with_qc(_dn_id, _signature_received)`

**Destination** — hardcoded code with a role-based fallback and an explicit tie-break:

```sql
  SELECT id, name INTO v_cust_loc
  FROM warehouse_locations
  WHERE code = 'CTMR107' OR (type = 'customer' AND is_active = true)
  ORDER BY (code = 'CTMR107') DESC LIMIT 1;
  IF v_cust_loc.id IS NULL THEN RAISE EXCEPTION 'CUSTOMERS location not configured'; END IF;
```

**Source** — per-serial `current_location`, same as ITO:

```sql
      NULLIF(r.current_location,'')::uuid, NULL,
```

This is the *most* evolved of the four: it already prefers a role (`type = 'customer'`)
over the literal code. It is the pattern the others should converge on.

#### 1.5.5 `create_ito_from_so(p_so_id)`

No location logic and no operation type at all — the entire insert:

```sql
  v_number := public.generate_document_number('internal_transfer');

  INSERT INTO public.internal_transfer_orders(
    ito_number, sales_order_id, status, created_by, confirmed_by, confirmed_at
  ) VALUES (
    v_number, p_so_id, 'confirmed', v_user, v_user, now()
  )
  RETURNING id INTO v_ito_id;
```

Serial reservation is FIFO by `created_at` across *all* warehouses, with no location filter:

```sql
      SELECT id
        FROM public.goods_receipt_serials
       WHERE product_id = v_line.product_id
         AND stock_status = 'available'
         AND reserved_for_so_id IS NULL
       ORDER BY created_at ASC
       LIMIT v_qty
       FOR UPDATE SKIP LOCKED
```

This is the single biggest structural gap: an ITO is created with no declared origin or
destination, so "multiple ITO types keyed to different locations" has nowhere to land.

### 1.6 Live stock position (the verification baseline)

16 serials, 1 product, 2 warehouses, 11 locations:

| stock_status | qc_status | current location | count |
|---|---|---|---|
| available | passed | STK103 | 7 |
| reserved | passed | STK103 | 4 |
| pending | pending | STK103 | 2 |
| reserved | passed | DLV-ORD105 | 2 |
| under_correction | failed | CRT111 | 1 |

---

## 2. Gap analysis

### G1 — No document-level storage for resolved source/dest ⇒ overrides cannot persist

**Confirmed missing on all three tables.** Today source/dest are *recomputed* inside each
completion RPC from warehouse defaults and literal codes. There is nowhere to write an
override, so a per-document override is not merely unimplemented — it is unrepresentable.

This is the one unavoidable column addition.

### G2 — `internal_transfer_orders` has no `operation_type_id` at all

`goods_receipts` and `delivery_notes` already have the FK. ITO does not. Since the stated
goal explicitly includes "multiple ITO types keyed to different locations", this column is
required.

### G3 — `operation_type_id` is never populated on any creation path

Verified in §1.4. The three creation paths that would need to set it:

| document | path | file/function |
|---|---|---|
| Goods Receipt | service insert | `src/lib/services/inventory/goodsReceipt.ts:126` |
| Delivery Note | service insert ×2 | `src/lib/services/inventory/deliveryNotes.ts:214`, `:324` |
| ITO | RPC insert | `create_ito_from_so` |

Plus the dead `?operation_type_id=` link at `InventoryOperationsOverview.tsx:98`, which
should start being consumed by the "new document" forms.

### G4 — Hardcoded resolution inside proven RPCs

| RPC | hardcodes | kind of hardcoding |
|---|---|---|
| `complete_gr_line_qc` | `VDR106`, `'VENDORS'` literal name, `warehouses.default_receipt_location_id` + first-internal fallback | source **and** dest |
| `record_gr_item_qc` | identical to above | source **and** dest |
| `complete_ito_with_qc` | `CRT111`; first `type='transit'` in serial-derived warehouse | dest (both paths) |
| `complete_delivery_with_qc` | `CTMR107` / `type='customer'` | dest |
| `create_ito_from_so` | — (sets nothing) | n/a |

Verified exhaustively — a scan of `pg_proc.prosrc` across `public` shows these four
functions are the **only** ones referencing `VDR106`, `CTMR107`, `CRT111`, or any
`warehouses.default_*_location_id` column.

### G5 — Operation types are not warehouse-scoped

`operation_types` has no `warehouse_id`. With 2 warehouses (GLF101, FTY102) and a plan for
"multiple GR types keyed to different locations", the defaults are global while the
locations they point at belong to a specific warehouse. Nothing prevents an operation type
whose default dest is in GLF101 from being used on a document whose `warehouse_id` is
FTY102. **Open question — see §3.6.**

### G6 — No uniqueness on `operation_types.name` / `sequence_prefix`

Not blocking, but "many operation types" makes duplicate names/prefixes a real UX and
numbering hazard.

### G7 — `warehouses.default_*_location_id` are all NULL

All six slots across both warehouses are NULL (verified). The GR path is therefore relying
on its `ORDER BY created_at ASC LIMIT 1` fallback in production. Any design that keeps
warehouse defaults as a fallback tier should know that tier is currently empty.

---

## 3. Proposed design (not applied)

### 3.1 Principle

Three tiers, evaluated in order, per document, at *completion* time:

```
1. document.source_location_id / document.dest_location_id   ← the override, and the
                                                                auto-filled default
2. operation_type.default_source_location_id / _dest_        ← only used to seed tier 1
3. today's existing logic verbatim                           ← back-compat tail
```

Tier 2 is applied **at insert time only** (seeding tier 1), never at completion time. That
matters: if an op type's defaults are edited later, in-flight documents keep the locations
they were created with. That is the correct accounting behaviour and it also makes "was
this an override?" answerable.

Tier 3 is what keeps the 10 existing GRs and 4 existing ITOs working unchanged.

### 3.2 Schema changes — minimal

**Nothing to add to `operation_types`.** `default_source_location_id` and
`default_dest_location_id` already exist with FKs (§1.1). Reuse them as-is.

Add six columns total, reusing the naming already established by `operation_types`
(`source`/`dest`, not `internal_movements`' `from`/`to`):

```
goods_receipts
  + source_location_id  uuid NULL  REFERENCES warehouse_locations(id)
  + dest_location_id    uuid NULL  REFERENCES warehouse_locations(id)

delivery_notes
  + source_location_id  uuid NULL  REFERENCES warehouse_locations(id)
  + dest_location_id    uuid NULL  REFERENCES warehouse_locations(id)

internal_transfer_orders
  + operation_type_id   uuid NULL  REFERENCES operation_types(id) ON DELETE SET NULL
  + source_location_id  uuid NULL  REFERENCES warehouse_locations(id)
  + dest_location_id    uuid NULL  REFERENCES warehouse_locations(id)
```

All nullable — that is what makes the change back-compatible with existing rows and with
every current insert path. `ON DELETE SET NULL` on the new `operation_type_id` matches the
two existing FKs exactly.

Deliberately **not** proposed now (each is a separate later decision):

- `NOT NULL` on any new column
- unique constraints on `operation_types.name` / `sequence_prefix` (G6)
- `operation_types.warehouse_id` (G5)
- a `location_role` enum/lookup to replace code literals (see §3.5)

### 3.3 How the values get set at creation

**Recommendation: a `BEFORE INSERT` trigger per document table**, not service-layer logic.

```
trg_<table>_fill_default_locations  BEFORE INSERT ON <table>
  IF NEW.operation_type_id IS NOT NULL THEN
    NEW.source_location_id := COALESCE(NEW.source_location_id, ot.default_source_location_id);
    NEW.dest_location_id   := COALESCE(NEW.dest_location_id,   ot.default_dest_location_id);
  END IF;
```

Why a trigger rather than filling it in `createGoodsReceipt`:

- There are already **four** distinct insert paths across three tables (two of them for
  delivery notes alone), plus `create_ito_from_so` in SQL. Service-layer filling has to be
  repeated in each and will drift.
- `COALESCE(NEW.x, default)` means **an explicitly supplied value always wins** — that *is*
  the override mechanism, with no extra flag.
- `BEFORE INSERT` only. Never `BEFORE UPDATE`. An update that sets
  `source_location_id = NULL` must stay NULL, not silently re-seed from the op type.

**Per-document override** is then just an `UPDATE` on the document's own column from the
form, with no special casing. "Is this an override?" =
`document.dest_location_id IS DISTINCT FROM operation_type.default_dest_location_id`.

**Where `operation_type_id` itself comes from:**

- GR: add `operation_type_id?: string | null` to `CreateGoodsReceiptInput`
  (`goodsReceipt.ts:115-122`) and pass it through the insert at `:126`. The new-GR form
  reads the already-emitted `?operation_type_id=` query param
  (`InventoryOperationsOverview.tsx:98`), which is currently discarded.
- DN: same, at `deliveryNotes.ts:214` and `:324`.
- ITO: `create_ito_from_so` gains `p_operation_type_id uuid DEFAULT NULL` — a **defaulted**
  parameter, so every existing caller keeps compiling and behaving identically.

⚠ **Decision needed (§3.6 Q1):** there are two `internal_transfer` types (ITEM ESTIMATE,
RETURNS). `create_ito_from_so` has no basis for choosing. Options: (a) caller passes it
explicitly — recommended, no schema change; (b) add `is_default_for_kind boolean` to
`operation_types` and pick the default. (a) is the smaller change and defers the modelling
question until the UI actually needs it.

### 3.4 Completion RPC changes — one at a time, precisely

The shape of every change is the same: **wrap the existing resolution in a `COALESCE` whose
first argument is the document's column, and leave the existing expression untouched as the
tail.** No existing line is deleted. That is what makes each change independently revertible
and back-compatible with NULL-operation-type documents.

#### 3.4.1 `complete_gr_line_qc`

1. **Declare** two variables alongside the existing block
   (`v_gr_id, v_gr_number, v_wh_id, v_loc_id, v_loc_name, v_vendor_loc_id`):
   `v_doc_src uuid; v_doc_dst uuid;`
2. **Extend the existing header SELECT** — currently
   `SELECT gr.goods_receipt_id, grh.warehouse_id, grh.gr_number INTO v_gr_id, v_wh_id, v_gr_number` —
   to also select `grh.source_location_id, grh.dest_location_id` into the two new variables.
   Same join, no extra query.
3. **Destination:** after the existing `IF v_wh_id IS NOT NULL THEN … END IF;` block, insert
   one line: `v_loc_id := COALESCE(v_doc_dst, v_loc_id);`
   The whole warehouse-default/first-internal chain stays as written and becomes the tail.
4. **Source:** change
   `SELECT id INTO v_vendor_loc_id FROM public.warehouse_locations WHERE code = 'VDR106' LIMIT 1;`
   to assign into a temp var and then `v_vendor_loc_id := COALESCE(v_doc_src, v_tmp);`
5. **Source name:** the `stock_moves` insert passes the literal `'VENDORS'`. Replace with a
   lookup of `warehouse_locations.name` for `v_vendor_loc_id` — otherwise a document that
   overrides its source still writes "VENDORS" into the ledger, which would be a *false
   ledger record*. This is the one place where leaving the current code is not acceptable.
6. **The silent-skip guard** (`IF v_vendor_loc_id IS NOT NULL AND v_loc_id IS NOT NULL THEN`)
   — see §3.6 Q2. Recommendation: change to `RAISE EXCEPTION` when either is NULL, per
   CLAUDE.md §5. This is a **behaviour change to a proven RPC** and must be approved
   separately from the mechanical COALESCE work; it belongs in its own commit (step 7).

#### 3.4.2 `record_gr_item_qc`

Same five mechanical edits as above, sourced from `v_gr` (which is already loaded as
`public.goods_receipts%ROWTYPE`, so `v_gr.source_location_id` / `v_gr.dest_location_id` are
available with **no query change at all** once the columns exist).

Also worth fixing while here — but in a *separate* commit: this function's ledger insert has
no `NOT EXISTS` duplicate guard, unlike `complete_gr_line_qc`.

#### 3.4.3 `complete_ito_with_qc`

1. `v_ito` is already `SELECT *` (`SELECT * INTO v_ito FROM internal_transfer_orders WHERE
   id = _ito_id FOR UPDATE`), so `v_ito.source_location_id` / `v_ito.dest_location_id`
   become available for free once the columns exist.
2. **Success-path destination:** after the existing transit lookup and its
   `IF v_transit_loc.id IS NULL THEN RAISE …` guard, override with the document value when
   present. Cleanest form: if `v_ito.dest_location_id IS NOT NULL`, load
   `(id, name)` from `warehouse_locations` for it and skip the serial-derived
   warehouse/transit lookup entirely; otherwise run today's block unchanged. Note this also
   sidesteps the `RAISE 'Reserved serials are missing a warehouse'` path for documents that
   declare their own destination.
3. **Failure-path destination (`CRT111`): leave as-is.** See §3.5.
4. **Source:** leave the per-serial `NULLIF(r.current_location,'')::uuid` as-is. See §3.6 Q3.
5. The two `RAISE EXCEPTION`s already present are correct behaviour and stay.

#### 3.4.4 `complete_delivery_with_qc`

Single change. `v_dn` is already `SELECT *`, so:

```sql
  SELECT id, name INTO v_cust_loc
  FROM warehouse_locations
  WHERE code = 'CTMR107' OR (type = 'customer' AND is_active = true)
  ORDER BY (code = 'CTMR107') DESC LIMIT 1;
```

becomes: if `v_dn.dest_location_id IS NOT NULL`, load `(id, name)` from
`warehouse_locations` by that id; else run the block above verbatim. The
`IF v_cust_loc.id IS NULL THEN RAISE EXCEPTION 'CUSTOMERS location not configured'` guard
stays and now also covers a dangling override.

Source stays per-serial, unchanged.

#### 3.4.5 `create_ito_from_so`

1. Add `p_operation_type_id uuid DEFAULT NULL` to the signature.
   ⚠ This creates a **new overload** unless the old signature is replaced —
   `CREATE OR REPLACE FUNCTION` with a different argument list produces a *second* function,
   and PostgREST will then reject calls as ambiguous. The migration must
   `DROP FUNCTION public.create_ito_from_so(uuid);` and recreate, or add the parameter
   without a default and update all callers. **Flag for review — this is the only signature
   change in the plan and it is the riskiest single line.**
2. Add `operation_type_id` to the `INSERT INTO public.internal_transfer_orders(...)` column
   list, passing `p_operation_type_id`. The `BEFORE INSERT` trigger (§3.3) then fills
   source/dest from that type's defaults automatically — **no location logic is written into
   this function at all.**
3. Serial reservation (FIFO, no location filter) — leave alone in this phase. See §3.6 Q3.

### 3.5 What happens to VDR106 / CTMR107 / CRT111

They split into two categories, and the distinction is the crux of the design:

**VDR106 (VENDORS) and CTMR107 (CUSTOMERS) → become operation-type defaults**, with the
existing code lookup retained as the fallback tail.
They sit on the **happy path**: VENDORS *is* the source of a goods receipt, CUSTOMERS *is*
the destination of a delivery. They are exactly the thing a user configuring "a second GR
type that receives from a different place" needs to change. Note CTMR107 is already the
`DELIVERY NOTE` type's `default_dest_location_id` — the data is sitting there unused.

**CRT111 (CORRECTION) → stays a role-based lookup.**
It is reached *only* on QC failure. It is not the document's declared destination; it is
where the exception path sends rejected units. Making it an operation-type default would
mean every operation type has to configure a "where do failures go" slot that is almost
always the same value, and a mis-set one would silently misroute rejects. Same argument
applies to `LOSS112` and `SCRP113` if they are ever wired up.

The correct long-term fix for CRT111 is a **location role** concept — a column or lookup
marking a location as `correction` / `loss` / `scrap` / `vendor` / `customer`, so the RPCs
stop matching on string literals like `code = 'CRT111'`. `complete_delivery_with_qc` already
gestures at this with `OR (type = 'customer' AND is_active = true)`. **Explicitly out of
scope for this phase** — noted so the literal in `complete_ito_with_qc` is understood as
deferred, not overlooked.

### 3.6 Open questions for review

**Q1 — How does `create_ito_from_so` choose between ITEM ESTIMATE and RETURNS?**
Recommendation: explicit caller parameter (a). Alternative: `is_default_for_kind` flag (b).

**Q2 — Should `complete_gr_line_qc`'s NULL-location silent skip become a hard error?**
Recommendation: yes, per CLAUDE.md §5 — but as its own commit, since it changes proven-RPC
behaviour. Today a GR can complete QC with zero ledger rows and no complaint.

**Q3 — Should the document's `source_location_id` be *enforced* against serials?**
Recommendation: no, not in this phase. Serials carry their own `current_location`, which is
physically accurate; the document's source is best treated as an expectation. Enforcing it
(rejecting serials not currently in the declared source) is a real feature but it is a
*behaviour* change with real risk to the 4 reserved serials in flight.

**Q4 — Should operation types be warehouse-scoped (G5)?**
Recommendation: defer. With 2 warehouses and 4 types the failure mode is visible, and adding
`warehouse_id` later is additive. But if "multiple GR types per warehouse" is the near-term
goal, decide now — it changes the config UI.

**Q5 — `internal_transfer_orders` has no `warehouse_id`.**
Adding `source_location_id`/`dest_location_id` gives it spatial identity indirectly (a
location belongs to a warehouse). Do we also want an explicit `warehouse_id`? Recommendation:
no — derive it from the locations; avoid a second source of truth.

### 3.7 Migration & back-compatibility

**No backfill. Nothing is rewritten.**

| existing data | after the change | why it still works |
|---|---|---|
| 9 GRs with `operation_type_id IS NULL` | unchanged | new columns NULL ⇒ `COALESCE` falls through to today's exact logic |
| GR-2627-0001 (op type set, warehouse NULL) | unchanged | its op type's defaults are both NULL; behaves as today (and still exposes Q2) |
| 4 ITOs, no op type | unchanged | new columns NULL ⇒ serial-derived transit lookup runs as today |
| 0 delivery notes | n/a | nothing to migrate |
| **16 goods_receipt_serials** | **untouched** | no serial column changes; `current_location` semantics unchanged |
| 4 serials `reserved` at STK103, 2 at DLV-ORD105 | unchanged | ITO/DN source still reads per-serial `current_location` |
| 1 serial `under_correction` at CRT111 | unchanged | CRT111 path deliberately not modified (§3.5) |

The new columns are nullable with no default, so `ALTER TABLE … ADD COLUMN` is a metadata-only
operation — no table rewrite, no lock of consequence at these row counts.

**Explicitly rejected:** backfilling `operation_type_id` on the 9 legacy GRs. They completed
under the old logic; stamping them with a type now would imply their ledger rows came from
that type's defaults, which is false.

---

## 4. Risk call-outs

### R1 — Five proven RPCs are modified

`complete_gr_line_qc`, `record_gr_item_qc`, `complete_ito_with_qc`,
`complete_delivery_with_qc`, `create_ito_from_so`. Per CLAUDE.md §2 the backend is
considered proven and correct; every one of these needs the exact SQL reviewed and approved
before it is applied. `record_gr_item_qc` was **not** in the original brief — it is included
because it duplicates `complete_gr_line_qc`'s hardcoding verbatim and would otherwise
silently diverge, producing two different receipt destinations for the same GR depending on
which path the operator used.

### R2 — `create_ito_from_so` signature change (highest single risk)

Adding a defaulted parameter via `CREATE OR REPLACE` creates an **overload**, not a
replacement, and PostgREST resolves RPC calls by argument names — an ambiguous pair breaks
*every* ITO creation from the frontend. Requires an explicit `DROP FUNCTION` in the same
migration. Verify after: `SELECT proname, pg_get_function_identity_arguments(oid) FROM
pg_proc WHERE proname = 'create_ito_from_so'` returns exactly **one** row.

### R3 — Ledger falsification via the hardcoded `'VENDORS'` name string

`complete_gr_line_qc` and `record_gr_item_qc` both write the *string* `'VENDORS'` as
`stock_moves.source_location_name` while writing a variable id. Once the id can be
overridden, the name must be looked up or the ledger records a location name that does not
match its own id. Verify after: no `stock_moves` row where `source_location_name` disagrees
with the `warehouse_locations.name` of its `source_location_id`.

### R4 — The trigger could overwrite a deliberate NULL

If the fill trigger is ever attached to `UPDATE`, clearing a document's location in the UI
would silently snap back to the operation-type default. `BEFORE INSERT` only. Verify after:
`SELECT tgname, tgtype FROM pg_trigger` on each table — insert-only.

### R5 — Thin verification surface

**1 product, 16 serials, 2 warehouses, 1 real transit location, 0 delivery notes.**
The delivery path has *zero* production rows, so `complete_delivery_with_qc` changes cannot
be verified against existing data at all — only by creating a test DN. The ITO transit
lookup is deterministic today only because GLF101 happens to have exactly one transit
location; a second one would make `LIMIT 1` non-deterministic and that would not show up in
testing at this scale.

### R6 — `warehouses.default_*_location_id` are all NULL

All six slots, both warehouses. The GR fallback chain currently terminates in
`ORDER BY created_at ASC LIMIT 1` over internal locations. If anyone sets a warehouse
default *during* this work, GR destinations change underneath the migration. Re-check the
warehouses table immediately before applying step 4.

### R7 — Type mismatch: `goods_receipt_serials.current_location` is `text`

The new document columns are `uuid`. Existing code casts with `NULLIF(x,'')::uuid`. Any new
comparison between a document location and a serial location needs the same cast, and a
malformed value there raises at runtime, not at deploy.

### R8 — `complete_ito_with_qc` is not idempotent

It raises `'ITO already completed'` on re-entry and uses `CREATE TEMP TABLE … ON COMMIT DROP`.
Failed verification runs cannot simply be retried on the same ITO — each test needs a fresh
ITO. Budget for that in the test plan.

### Verification plan (run against the real data after each step)

Baseline capture **before** any change, re-run after each step, diff:

```sql
-- ledger shape
select count(*) from stock_moves;
select count(*) from stock_move_lines;
select source_location_id, destination_location_id, count(*)
  from stock_move_lines group by 1,2 order by 3 desc;

-- serial position (must be byte-identical after steps 1-3)
select stock_status, qc_status, current_location, count(*)
  from goods_receipt_serials group by 1,2,3 order by 4 desc;

-- name/id agreement in the ledger (R3)
select m.id, m.source_location_name, l.name
  from stock_moves m join warehouse_locations l on l.id = m.source_location_id
 where m.source_location_name is distinct from l.name;

-- function inventory (R2)
select proname, pg_get_function_identity_arguments(oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in ('complete_gr_line_qc','record_gr_item_qc','complete_ito_with_qc',
                   'complete_delivery_with_qc','create_ito_from_so');
```

The expected baseline right now: 16 serials distributed as §1.6, and 5 functions returning
exactly one row each.

**Functional test after step 4** (needs new documents — existing ones are completed):
one GR with a receipt operation type carrying a non-default dest, taken through
`record_gr_item_qc` and `complete_gr_line_qc`, checking that `stock_move_lines
.destination_location_id` equals the document's `dest_location_id` and **not** STK103.
Then one GR with `operation_type_id = NULL` to prove the fallback tail is untouched.

---

## 5. Sequencing

Each step is one commit, independently reviewable and independently revertible. Steps 1–3
are **pure additions with zero behaviour change** — after step 3 the system behaves exactly
as it does today, which is the point: the risky RPC edits start from a known-good base.

| # | step | type | revert | behaviour change |
|---|---|---|---|---|
| 1 | Add `source_location_id` / `dest_location_id` to `goods_receipts` and `delivery_notes` (4 cols + 4 FKs) | SQL, additive | `DROP COLUMN` | **none** |
| 2 | Add `operation_type_id` + `source_location_id` + `dest_location_id` to `internal_transfer_orders` (3 cols + 3 FKs) | SQL, additive | `DROP COLUMN` | **none** |
| 3 | Add the three `BEFORE INSERT` fill triggers (§3.3) | SQL, additive | `DROP TRIGGER` | none for existing paths (nothing sets `operation_type_id` yet) |
| 4 | `complete_gr_line_qc` + `record_gr_item_qc`: COALESCE document values in; fix the `'VENDORS'` name literal (R3) | SQL, `CREATE OR REPLACE` | replace with captured original `pg_get_functiondef` | none when doc cols are NULL |
| 5 | `complete_delivery_with_qc`: COALESCE `dest_location_id` | SQL, `CREATE OR REPLACE` | as above | none when NULL |
| 6 | `complete_ito_with_qc`: COALESCE success-path dest. CRT111 untouched | SQL, `CREATE OR REPLACE` | as above | none when NULL |
| 7 | *(needs separate approval — Q2)* `complete_gr_line_qc` / `record_gr_item_qc`: NULL location → `RAISE` instead of silent skip | SQL | as above | **yes, deliberate** |
| 8 | *(needs separate approval — R2)* `create_ito_from_so`: `DROP` + recreate with `p_operation_type_id` | SQL, signature change | recreate original | none when arg omitted |
| 9 | Frontend: `CreateGoodsReceiptInput` gains `operation_type_id`; new-GR form reads the `?operation_type_id=` param already emitted at `InventoryOperationsOverview.tsx:98` | TS | revert commit | GR docs start carrying a type |
| 10 | Frontend: same for both DN insert paths (`deliveryNotes.ts:214`, `:324`) | TS | revert commit | DN docs start carrying a type |
| 11 | Frontend: source/dest override fields on the GR / DN / ITO forms, defaulted from the chosen type, editable | TS | revert commit | overrides become reachable |
| 12 | Operation-types config page: expose `default_source_location_id` / `default_dest_location_id` for editing (`OperationTypesConfig.tsx` already loads the columns via `select('*')`) | TS | revert commit | types become configurable |

Before step 1, capture `pg_get_functiondef()` for all five functions into
`docs/rpc-baselines/` — that file *is* the revert plan for steps 4–8, and it costs nothing.

**Recommended stopping point for the first review round:** after step 3. At that point the
schema supports the model, nothing behaves differently, and Q1–Q5 can be answered with the
columns actually in front of us.

---

## 6. Summary of what would change

**Schema:** 7 new nullable columns (4 on GR/DN, 3 on ITO), 7 new FKs, 3 new BEFORE INSERT
triggers. **Zero** changes to `operation_types` — its two default-location columns already
exist and are already partly populated.

**RPCs:** 5 touched. 4 are additive `COALESCE` wrappers preserving today's logic as the
fallback tail; 1 (`create_ito_from_so`) needs a signature change and carries the highest risk.

**Data:** nothing migrated, nothing backfilled, nothing deleted. The 16 serials, 10 GRs and
4 ITOs are untouched and keep behaving exactly as they do today.

**Not in scope (deliberately deferred, with reasons in §3.5–3.6):** location roles replacing
`CRT111`/`VDR106`/`CTMR107` string literals, warehouse-scoped operation types, uniqueness
constraints on operation type names, source-location enforcement against serials, and
location-aware serial reservation in `create_ito_from_so`.
