# RPC baselines

Exact `pg_get_functiondef()` output for proven RPCs, captured from the **live
database** immediately before a migration modifies them.

These files are the rollback. Re-applying one restores the function to its
pre-migration form byte for byte — no reconstruction from memory, no guessing at
what a reverse migration should say.

## Why they exist

CLAUDE.md treats the backend as proven and correct, so any change to a working
RPC needs a way back that is provably identical to what was there before. A
reverse-SQL comment block in a migration is written by hand and can drift from
reality; a captured definition cannot.

## How to capture

```sql
SELECT pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = '<function_name>';
```

Save the result verbatim as `<function_name>.<YYYYMMDD>.sql`, with a header
comment naming the migration it precedes.

## How to roll back

Run the captured file. Each is a complete `CREATE OR REPLACE FUNCTION`
statement, so it replaces the modified version in place.

⚠ If the migration **changed a function's signature**, `CREATE OR REPLACE` will
not remove the new version — it creates an overload. Drop the new signature
first, then apply the baseline. That situation applies to
`generate_document_number` and `preview_next_document_number` (migration
`20260731100000`), not to the files captured here.

## Contents

| file | captured before | function |
| --- | --- | --- |
| `complete_gr_line_qc.20260731.sql` | `20260731130000_gr_qc_route_to_document_locations.sql` | batch QC for one goods receipt line |
| `record_gr_item_qc.20260731.sql` | same | per-serial QC |

Both were captured on 2026-07-31 while the two functions still resolved the
destination location from the warehouse only, ignored `goods_receipts.dest_location_id`,
hardcoded `'VENDORS'` as the ledger source name, and silently skipped the ledger
when a location could not be resolved.
