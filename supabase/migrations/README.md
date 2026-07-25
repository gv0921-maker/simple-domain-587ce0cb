# Migration history — read before touching the database

**Do not run `supabase db push` or `supabase migration repair` against this
project.** The migration history has drifted structurally from the files in this
folder, and those commands would misfire badly. This document is the
reconciliation: what the drift is, why it is safe, and how to apply schema
changes correctly.

## The state of things (verified 2026-07-25)

`supabase migration list --linked` reports, across ~215 history entries:

| Category | Count | Meaning |
| --- | ---: | --- |
| Matched (local version == remote version) | **0** | Not one file's version string matches the applied history. |
| Remote-only (applied, no matching local file) | 101 | The versions actually recorded in `schema_migrations`. |
| Local-only (file present, not in history) | 114 | The files in this folder, plus 14 applied manually (below). |

Every local file's timestamp sits **3–4 seconds after** the remote version it
corresponds to — e.g. remote `20260422052031` vs local `20260422052034`. This is
how Lovable manages the project: it applies a migration to the remote database at
time *T*, then writes the local file at *T+3s*. The two are the **same
migration**; only the version string differs. Because none of them match,
`db push` would treat all 114 local files as unapplied and try to replay the
entire schema — re-running ~100 migrations that are already live.

## The "missing object" migrations are not a live problem

Two migrations reference objects that no migration in this folder creates:
`public.suppliers` and `stock_moves.reference_document_type` /
`stock_moves.source_document`. All three **exist on the live database** — they
were created through the Lovable dashboard, outside the migration files.

Consequence: **this folder is not a from-scratch source of truth.** A clean
replay into an empty database fails partway (≈94 of 103 apply). Each individual
migration is written to be idempotent and is safe to re-apply to the *live*
database, but you cannot rebuild the schema from these files alone.

## How to apply a schema change (the only supported path)

1. Write an **idempotent** migration file here (guard everything:
   `CREATE ... IF NOT EXISTS`, `DROP ... IF EXISTS` before `CREATE`,
   `ADD COLUMN IF NOT EXISTS`, re-runnable data updates).
2. Validate it against a throwaway Postgres container first (see the pattern in
   the project's migration memory), exercising both success and failure paths.
3. Apply it with:
   ```sh
   npx supabase db query --linked --file supabase/migrations/<file>.sql
   ```
   `db query` runs the SQL but **does not** record a row in
   `supabase_migrations.schema_migrations` — which is why recent files
   (`20260724120000` onward, 14 of them) show as local-only above. That is
   expected and harmless given the drift already present.
4. Verify the change live with a read-only query.

Never `db push`, never `migration repair`, never rename existing files to chase
alignment — any of those would desync from Lovable's own management of the
history table.
