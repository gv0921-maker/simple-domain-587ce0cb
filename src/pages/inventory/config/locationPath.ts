/**
 * Location hierarchy helpers.
 *
 * A location's display name in Odoo is its full path through the tree, rooted
 * at the warehouse — "GLF/STOCK/GODOWN". `warehouse_locations.parent_location_id`
 * is a nullable self-FK, and the warehouse itself is the virtual root parent of
 * the tree, so a NULL parent means "directly under the warehouse".
 *
 * Verified against live data: STK103 (STOCK) has parent NULL under GLF101, and
 * GDN110 / STORE-MLDV-108 / STR-KDR-109 / CRT111 all have STK103 as parent.
 *
 * Nothing in the database prevents a cycle in parent_location_id, so every walk
 * here is guarded by a visited set and degrades to a partial path rather than
 * hanging the render.
 */
import type { Location, Warehouse } from '@/lib/services/inventory';

export const PATH_SEPARATOR = '/';

/** Ancestors nearest-first, excluding the location itself. Cycle-safe. */
export function ancestorsOf(location: Location, byId: Map<string, Location>): Location[] {
  const out: Location[] = [];
  const seen = new Set<string>([location.id]);
  let cursor = location.parentId ? byId.get(location.parentId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    out.push(cursor);
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return out;
}

/**
 * Full computed path, e.g. "GLF/STOCK/GODOWN". The warehouse name is the root
 * segment; a location whose warehouse is missing from `warehouses` falls back
 * to the location chain alone rather than rendering a misleading prefix.
 */
export function locationPath(
  location: Location,
  byId: Map<string, Location>,
  warehousesById: Map<string, Warehouse>,
): string {
  const chain = [...ancestorsOf(location, byId)].reverse().map((l) => l.name);
  chain.push(location.name);
  const warehouseName = warehousesById.get(location.warehouseId)?.name;
  if (warehouseName) chain.unshift(warehouseName);
  return chain.join(PATH_SEPARATOR);
}

/** Index helper — building the map once per render beats an O(n²) lookup. */
export function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]));
}

/**
 * Every descendant of `rootId`, plus `rootId` itself. Used by the form to keep
 * a location from being reparented under itself or one of its own children,
 * which would orphan the subtree from the root and create a cycle the database
 * would happily accept.
 */
export function descendantIdsOf(rootId: string, locations: Location[]): Set<string> {
  const childrenByParent = new Map<string, Location[]>();
  for (const l of locations) {
    if (!l.parentId) continue;
    const bucket = childrenByParent.get(l.parentId);
    if (bucket) bucket.push(l);
    else childrenByParent.set(l.parentId, [l]);
  }

  const blocked = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of childrenByParent.get(current) ?? []) {
      if (blocked.has(child.id)) continue;
      blocked.add(child.id);
      queue.push(child.id);
    }
  }
  return blocked;
}

/** Human-readable labels for the six live `type` CHECK values. */
export const LOCATION_TYPE_LABELS: Record<string, string> = {
  internal: 'Internal Location',
  customer: 'Customer Location',
  vendor: 'Vendor Location',
  transit: 'Transit Location',
  virtual: 'Virtual Location',
  production: 'Production Location',
};

export const LOCATION_TYPE_OPTIONS = [
  'internal',
  'customer',
  'vendor',
  'transit',
  'virtual',
  'production',
] as const;

/** Live CHECK: fifo | lifo | closest | manual. */
export const REMOVAL_STRATEGY_OPTIONS = ['fifo', 'lifo', 'closest', 'manual'] as const;

export const REMOVAL_STRATEGY_LABELS: Record<string, string> = {
  fifo: 'First In First Out (FIFO)',
  lifo: 'Last In First Out (LIFO)',
  closest: 'Closest Location',
  manual: 'Manual Selection',
};

export function locationTypeLabel(type: string): string {
  return LOCATION_TYPE_LABELS[type] ?? type;
}
