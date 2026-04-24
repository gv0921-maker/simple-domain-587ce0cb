// Inventory service layer — re-exports the inventory data module
// plus the storage helpers and types accessed directly today.
//
// `@/lib/data/inventory` (legacy compat shim) re-aliases
// `LegacyStockMove as StockMove`. We force the modern `StockMove`
// (from `inventory/types`) to win by re-exporting it explicitly last.
export * from '@/lib/data/inventory';
export * from '@/lib/data/inventory/storage';
export type * from '@/lib/data/inventory/types';
export type { StockMove } from '@/lib/data/inventory/types';