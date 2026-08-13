/**
 * Resolving a warehouse's stock location.
 *
 * In the true-Odoo model a warehouse is the virtual root parent of its own
 * location tree, and its "stock location" is the root internal location of
 * that tree — Odoo's `lot_stock_id`. Verified against the live data:
 *
 *   GLF101 -> STK103 (STOCK)   type=internal, parent_location_id IS NULL
 *                              and it is the parent of GDN110, STORE-MLDV-108,
 *                              STR-KDR-109 and CRT111.
 *   FTY102 -> none             its only location is FTY104, type=production.
 *
 * So a warehouse legitimately having no stock location is a real state, not a
 * bug — the caller renders it as an em dash rather than inventing a value.
 *
 * Deliberately does NOT read `warehouses.default_internal_location_id`: in this
 * model routing defaults live on Operation Types, and that column is left
 * untouched and unreferenced.
 */
import type { Location } from '@/lib/services/inventory';

/**
 * Primary rule: the root internal location (internal, no parent).
 * Fallback: any internal location, for a tree that was built without a root.
 * `getLocationsAsync` orders by name, so the fallback is stable but arbitrary.
 */
export function findStockLocation(
  locations: Location[],
  warehouseId: string,
): Location | undefined {
  const mine = locations.filter((l) => l.warehouseId === warehouseId && l.isActive);
  return (
    mine.find((l) => l.type === 'internal' && !l.parentId) ??
    mine.find((l) => l.type === 'internal')
  );
}

/** Display helper — the em dash is the honest answer for FTY102. */
export function stockLocationLabel(
  locations: Location[],
  warehouseId: string,
): string {
  return findStockLocation(locations, warehouseId)?.name ?? '—';
}
