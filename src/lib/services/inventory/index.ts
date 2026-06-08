// Inventory service — re-exports the async Supabase-backed API and types.
// Components should prefer the hooks in `@/hooks/inventory`. Cross-module
// callers that need raw async access can import from here.
export * from '@/lib/services/inventory/api';
export type * from '@/lib/data/inventory/types';
export { DEFAULT_INVENTORY_ROLES } from '@/lib/data/inventory/types';