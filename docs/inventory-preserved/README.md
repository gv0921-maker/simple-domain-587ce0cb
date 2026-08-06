# Inventory module — preserved state (pre-reset fallback)

Captured **2026-08-06**, before the inventory module reset.

- **Git tag:** `pre-inventory-reset` → `a0bdb09` (local only, not pushed)
- **Source:** live Supabase project `mdtwvuiakvxoqvksemyt`, read via catalog queries
- **Scope:** 47 inventory tables. CRM tables and CRM-owned functions are deliberately
  excluded — nothing here touches `crm_*`.

## Files

| File | Contents |
| --- | --- |
| `01_tables.sql` | 47 `CREATE TABLE` statements — columns, types, defaults, NOT NULL |
| `02_constraints_indexes_triggers.sql` | 251 constraints (PK/FK/UNIQUE/CHECK), 125 indexes, 51 triggers |
| `03_rls_policies.sql` | 163 RLS policies with their `USING` / `WITH CHECK` expressions |
| `04_functions_rpcs.sql` | 50 functions/RPCs that reference an inventory table |
| `05_config_data.sql` | 63 rows of **config** data as restorable INSERTs |

## What `05_config_data.sql` covers

Config only — this is the fallback if the rebuild underdelivers:

product_categories (3) · product_attributes (4) · product_attribute_values (23) ·
units_of_measure (4) · warehouses (3) · warehouse_locations (12) · operation_types (5) ·
numbering_sequences (7) · numbering_settings (1) · serial_counters (1)

Rows are written through `jsonb_populate_record`, so they still load if columns are
later reordered or new nullable columns are added.

**Operational data is not included** — goods receipts, serials, stock moves,
reservations, counts and correction orders are all test data and are not migrated.

## Restoring

These files are a **reference and a fallback**, not a migration. Restoring config into
a rebuilt schema is a deliberate act: read `05_config_data.sql`, map the columns onto
whatever the new tables look like, and load it explicitly. Do not replay it blindly.

`01`–`04` reconstruct the old module as it stood, should any part of it need to be
consulted or stood back up.
