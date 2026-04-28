## Cleanup: Consolidate duplicate page files

Pure file cleanup — no logic or UI changes.

### 1. Delete old unused files
- `src/pages/sales/QuotationsList.tsx` (old)
- `src/pages/sales/SalesOrdersList.tsx` (old)
- `src/pages/inventory/StockMoves.tsx` (old)

### 2. Rename "New"/"Enhanced" files to canonical names
- `src/pages/sales/QuotationsListNew.tsx` → `src/pages/sales/QuotationsList.tsx`
- `src/pages/sales/SalesOrdersListNew.tsx` → `src/pages/sales/SalesOrdersList.tsx`
- `src/pages/inventory/StockMovesEnhanced.tsx` → `src/pages/inventory/StockMoves.tsx`

Inside the renamed files, also update the default-exported component name where it currently differs:
- `SalesOrdersListNew` function → `SalesOrdersList` (line 70)
- `StockMovesEnhanced` function → `StockMoves` (line 84)
- `QuotationsList` already correctly named — no change

### 3. Update `src/App.tsx` import paths
- `import QuotationsList from "@/pages/sales/QuotationsListNew"` → `"@/pages/sales/QuotationsList"`
- `import SalesOrdersList from "@/pages/sales/SalesOrdersListNew"` → `"@/pages/sales/SalesOrdersList"`
- `StockMoves` import already points at `@/pages/inventory/StockMoves` — will resolve to the renamed file automatically.

No JSX/route changes needed (the local import aliases already match).

### 4. .gitignore + tmp cleanup
- Append `tmp/` line to `.gitignore`
- Delete the `tmp/` directory (contains `product-pal/`, `product-pal-main.zip`, `product-pal-main-2.zip`)

### Verification after changes
- `rg "QuotationsListNew|SalesOrdersListNew|StockMovesEnhanced" src/` returns no matches
- TypeScript compiles clean
- Routes `/sales/quotations`, `/sales/orders`, `/inventory/stock-moves` still resolve to the same components
