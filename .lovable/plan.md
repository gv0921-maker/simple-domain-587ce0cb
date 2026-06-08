
## Goal
Migrate the 6 sales pages you listed to the Supabase hooks, then dismantle the legacy localStorage layer without breaking the ~30 other files that still consume the rich legacy types and helpers.

## Reality check (why this can't be a clean delete)

Searching `src/`, the legacy modules are referenced by far more than just the 6 pages:

- **`src/lib/data/sales.ts`** (Contact/Lead/Opportunity/SalesOrder for CRM-side) — imported by `OpportunitiesList`, `LeadDetail`, `SalesPipeline`, `CRMContactDetail`, `crm/OpportunityDetail`, `SalesOverview`, `SalesReports`, `SalesImportExport`, plus several `lib/sales/*` engines. These pages are explicitly **out of scope** (CRM-backed / not in this batch).
- **`src/lib/data/sales/storage.ts`** + **`types.ts`** — used by `FiscalPositionsPage`, `PromotionsPage`, `SalesOverview`, `SalesReports`, plus `lib/sales/automation.ts`, `loyaltyEngine.ts`, `loyaltyService.ts`, `quotationPdf.ts`, `seasonalPricing.ts`, `supabaseSync.ts`, `components/sales/OrderLinesTable.tsx`, `OrderStatusChevrons.tsx`, `SalesImportExport.tsx`, `AddressBlock.tsx`, `PhoneInput.tsx`.
- **`src/lib/sales/companySettings.ts`** — used by `gstCalculator.ts` and `quotationPdf.ts` (both used widely).
- **`src/lib/sales/promotionStorage.ts`** — used by `PromotionsPage` and `seasonalPricing.ts`.

A hard delete of any of these today produces hundreds of TS errors in code we agreed not to touch in this batch.

## Plan

### Step 1 — Migrate the 6 in-scope pages
Replace direct `getQuotations/saveQuotation/...` calls with the new TanStack Query hooks from `@/hooks/sales`, mapping between the rich legacy types (kept as types-only) and the `Sb*` DB shapes via small in-page adapters.

- `SubscriptionsList` / `SubscriptionForm` → `useSubscriptions`, `useSubscription`, `useSaveSubscriptionWithLines`, `useDeleteSubscription`
- `QuotationsList` / `QuotationForm` → `useQuotations`, `useQuotation`, `useSaveQuotation`, `useDeleteQuotation`, plus the B2C engine (`gstCalculator`, loyalty, seasonal pricing) which stays in `lib/sales/*` and is now pure compute
- `SalesOrdersList` / `SalesOrderForm` → `useSalesOrders`, `useSalesOrder`, `useSaveSalesOrder`, `useDeleteSalesOrder`, `useOrderActivities`, `useAddOrderActivity` (powers timeline + lock/confirm flow)
- `CustomerPortal` / `CustomerPortalQuotation` → migrated to hooks. **Portal-token flag:** these pages currently authenticate via a `portalToken` on the customer record. Today RLS only allows `authenticated` reads, so anonymous portal visitors will fail. Options:
  1. (recommended, deferred) add a SECURITY DEFINER RPC `get_portal_quotation(token text)` and call it from the portal pages.
  2. (interim) require the portal viewer to be signed in.
  
  I'll wire the pages to the new hooks and add a TODO + visible "Portal access requires sign-in" notice; **no new RPC in this batch** unless you say so.

### Step 2 — Shim out the localStorage modules (keep types & helpers)

- `src/lib/services/sales/storage.ts` (2-line file) → **delete**.
- `src/lib/services/sales/types.ts` (1-line file) → **delete**.
- `src/lib/data/sales/storage.ts` → reduce to pure helpers (`calculateLineTotal`, `applyPricelistPrice`, `checkStockAvailability`, `generate*Reference`, `convertQuotationToOrder` rewritten as a hook). All `getItem/setItem` reads/writes removed. Sync data-fetching helpers (`getQuotations`, `getSalesOrders`, `getPricelists`, `getSubscriptions`, `getTaxRules`, `getFiscalPositions`, `getSalesRolePermissions`) are kept as **deprecated sync shims** returning `[]` plus a `console.warn`, so the out-of-scope pages still compile but visibly noop until they're migrated in a later batch. Defaults for tax rules / role permissions remain available as named exports for the engines that need them.
- `src/lib/data/sales.ts` → keep **types only** (Contact/Lead/Opportunity/SalesOrder/OrderLine/Activity). The CRUD functions become deprecated shims returning `[]` / no-op, same as above. (Full removal lands when CRM-Sales pages migrate.)
- `src/lib/sales/promotionStorage.ts` → convert to a no-op shim returning `[]` with a deprecation warning. Real data layer comes later when a `sales_seasonal_promotions` hook is wired (table already exists).
- `src/lib/sales/companySettings.ts` → convert to a static config returning the constants currently in localStorage defaults (no read/write). The two consumers (`gstCalculator`, `quotationPdf`) keep working unchanged.

### Step 3 — Verify
- `tsc --noEmit` clean.
- No new ESLint errors.
- Smoke check the 6 migrated pages render in preview.

## Out of scope for this batch (will need a follow-up)
- `PromotionsPage`, `FiscalPositionsPage`, `SalesOverview`, `SalesReports`, CRM detail pages, `SalesImportExport`, `loyaltyService`, `supabaseSync`. These keep compiling against the deprecated shims and will be migrated in the next batch.
- A real `get_portal_quotation` RPC for anonymous portal access.
- A `tax_rules` Supabase table (engines keep using the static defaults).

## Risk
The shim approach means out-of-scope pages will render empty lists until their batch lands, but they will not crash and the build stays green. If you'd rather I migrate every consumer right now in one go, say the word and I'll expand the scope — but it will be a much larger change.
