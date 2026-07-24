# GLF ERP

Internal ERP for GLF covering the full order-to-cash and make-to-order lifecycle:
sales, serialized inventory, manufacturing, CRM, HR/payroll, and reporting.

Built with Vite, React 18, TypeScript, Tailwind + shadcn/ui, TanStack Query, and
Supabase (Postgres, Auth, RLS, Edge Functions).

## Getting started

Requires Node.js 18+ and npm.

```sh
npm install
cp .env.example .env    # then fill in your Supabase project values
npm run dev
```

The app runs at `http://localhost:8080`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server with HMR |
| `npm run build` | Production build to `dist/` |
| `npm run build:dev` | Development-mode build |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run lint` | Run ESLint over the repo |
| `npm run typecheck` | Type-check without emitting |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests and build on every
push and pull request. Lint is reported but not gating while the `any` backlog
below is outstanding — except `react-hooks/rules-of-hooks`, which gates the
build, because conditional hooks previously crashed pages at runtime.

## Environment

All configuration comes from `.env` (see `.env.example`). Every `VITE_`-prefixed
variable is inlined into the client bundle at build time, so only the publishable
"anon" key belongs there. The service-role key must only ever live in Supabase
Edge Function secrets — never in this repo.

Row Level Security is the only thing standing between an authenticated user and
the data. Treat RLS policies as security-critical code.

## Project layout

```
src/
  pages/          Route components, one directory per module
  components/     Shared UI; components/ui is the shadcn primitive layer
  hooks/          TanStack Query hooks, grouped by module
  lib/
    services/     Supabase data access, grouped by module
    data/         Domain types, RBAC definitions
    navigation/   Module nav definitions
  contexts/       Auth, customization, accessibility providers
  integrations/   Generated Supabase client and types
supabase/
  migrations/     Ordered SQL migrations (the schema source of truth)
  functions/      Edge Functions
```

Routing is centralised in `src/App.tsx`. Role gating happens at the route level
via `ProtectedRoute` / `RouteGuard` / `SuperAdminRoute`, and again in the database
via RLS.

## Architecture notes

- **Multi-step business operations live in Postgres, not the client.** Operations
  that must be atomic — completing an inter-transfer order, completing a delivery,
  reserving serials, consuming work-order materials — are `SECURITY DEFINER` RPCs
  that lock the affected rows and roll back as a unit. See
  `complete_ito_with_qc`, `complete_delivery_with_qc`, `reserve_serials`.
- **Inventory is serial-level.** `goods_receipt_serials` tracks each unit's
  location and stock status; stock movements are recorded in `stock_moves`.
- **The schema is defined by migrations.** `src/integrations/supabase/types.ts` is
  generated and has drifted from the schema in places, which is why parts of the
  service layer cast through `any`.

## Known issues

Outstanding as of 2026-07-24. The audit findings that have been fixed are
recorded in the git history, not here. See `WORKFLOW_AUDIT.md` for the older and
broader review — note that several of its RLS claims are out of date, corrected
in `docs/RLS_STATUS.md`.

### Generated Supabase types have drifted

`src/integrations/supabase/types.ts` no longer matches the schema, which is why
the service layer casts through `const sb = supabase as any`. Those casts are
~1025 of the ~1040 remaining lint errors, and they hide real type errors.

Regenerating needs access to the live project:

```sh
npx supabase login
npx supabase gen types typescript --project-id mdtwvuiakvxoqvksemyt \
  > src/integrations/supabase/types.ts
```

This was deliberately **not** done from a locally replayed schema: replaying the
migrations against a scratch Postgres applies 94 of 103, so the result is
missing columns that two of the failed migrations add. Types generated from it
would be confidently wrong. Once regenerated, remove the `as any` casts module
by module — expect real errors to surface, which is the point.

### The migration history has drifted from the database

Replaying the migrations reveals two that reference objects no migration
creates: `public.suppliers`, and `stock_moves.reference_document_type`. Either
the live database has out-of-band changes, or those migrations never applied.
Worth reconciling before trusting `supabase/migrations` as the source of truth.

### RLS is partially hardened

53 tables still carry `USING (true)` on SELECT. Most are lookup or operational
tables where that is intended; a handful are genuinely questionable and need a
business decision about who should see them. Full inventory and tiering in
`docs/RLS_STATUS.md`.

`sales_rep`'s `scope: 'own'` is declared in `src/lib/data/rbac.ts` and honoured
by `is_sales_rep_for_record()`, but the UI does not filter by it.

### Test coverage is thin

22 tests against 570-odd source files. The tests that exist pin specific
regressions (hook ordering, settings access, cancellation side effects) rather
than providing general coverage.

### Two lockfiles

`package-lock.json` (used by CI) and `bun.lock` (used by the Lovable build) are
both committed and will drift. Consolidating needs a decision about which
toolchain owns the build.

## Reference documents

| File | Contents |
| --- | --- |
| `BUILD_COMPLETE.md` | Phase-by-phase record of what shipped |
| `WORKFLOW_AUDIT.md` | Workflow and quality audit |
| `RBAC_AUDIT.md` | Table-by-table RLS and permissions audit |
| `SETTINGS_AUDIT.md` | Per-page status of the settings module |
| `docs/RBAC_MATRIX.md` | Canonical role-to-capability matrix |

## Supabase setup

Storage buckets must be created manually in the Supabase dashboard:
`employee-documents` (private), `product-images` (public), `chat-attachments`
(private), `print-templates` (private), `backups` (private),
`manufacturing-references` (public).

Edge Functions: `crm-api`, `crm-openapi`, `create-employee-with-login`,
`list-app-users`, `import-data`.
