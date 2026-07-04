// Warehouse locations service — Supabase-backed CRUD.
// Wraps the shared inventory api and adds tree/archive helpers.
import {
  getLocationsAsync,
  getLocationAsync,
  getLocationsByWarehouseAsync,
  saveLocationAsync,
  deleteLocationAsync,
} from './api';
import { getItem, removeItem } from '@/lib/storage';
import { supabase } from '@/integrations/supabase/client';
import type { Location } from '@/lib/data/inventory/types';

export const getLocations = getLocationsAsync;
export const getLocation = getLocationAsync;
export const getLocationsByWarehouse = getLocationsByWarehouseAsync;

/** Insert (id undefined) or update (id set). */
export async function createLocation(input: Omit<Location, 'id'>): Promise<Location> {
  return saveLocationAsync({ ...(input as Location), id: '' as any });
}
export async function updateLocation(id: string, patch: Partial<Location>): Promise<Location> {
  return saveLocationAsync({ ...(patch as Location), id });
}

/** Soft-delete: flip is_active false. */
export async function archiveLocation(id: string): Promise<Location> {
  return saveLocationAsync({ id, isActive: false } as Location);
}
export async function unarchiveLocation(id: string): Promise<Location> {
  return saveLocationAsync({ id, isActive: true } as Location);
}
/** Hard delete — usually avoid; kept for cleanup flows. */
export const deleteLocation = deleteLocationAsync;

/** Hierarchical tree grouped by warehouse. */
export interface LocationTreeNode extends Location {
  children: LocationTreeNode[];
}
export function buildLocationTree(locations: Location[]): LocationTreeNode[] {
  const byId = new Map<string, LocationTreeNode>();
  locations.forEach((l) => byId.set(l.id, { ...l, children: [] }));
  const roots: LocationTreeNode[] = [];
  byId.forEach((node) => {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}
export async function getLocationTree(): Promise<LocationTreeNode[]> {
  const all = await getLocationsAsync();
  return buildLocationTree(all);
}

/**
 * Removal-strategy note: when picking stock from a location, the
 * `removalStrategy` field determines unit selection order:
 *   - fifo    -> oldest received units first (default; matches GLF furniture)
 *   - lifo    -> newest received units first
 *   - closest -> nearest bin (aisle/shelf) for pickers
 *   - manual  -> operator chooses at pick time
 * Full picking engine wires this in a later iteration.
 */

const LEGACY_KEY = 'warehouse_locations';
const MIGRATED_FLAG = 'warehouse_locations_migrated_v1';

interface LegacyLoc {
  id: string;
  name: string;
  code: string;
  warehouseId: string;
  parentId?: string;
  type: string;
  isActive: boolean;
}

/** One-shot migration: copy any leftover localStorage locations into Supabase. */
export async function migrateLegacyLocations(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  if (localStorage.getItem('erp_' + MIGRATED_FLAG)) return 0;
  const legacy = getItem<LegacyLoc[]>(LEGACY_KEY, []);
  if (!legacy.length) {
    localStorage.setItem('erp_' + MIGRATED_FLAG, '1');
    return 0;
  }
  let inserted = 0;
  for (const l of legacy) {
    const { data: existing } = await supabase
      .from('warehouse_locations')
      .select('id')
      .eq('name', l.name)
      .eq('warehouse_id', l.warehouseId)
      .maybeSingle();
    if (existing) continue;
    const type = ['internal', 'customer', 'vendor', 'transit', 'virtual', 'production'].includes(l.type)
      ? l.type
      : 'internal';
    await supabase.from('warehouse_locations').insert({
      name: l.name,
      code: l.code || l.name.toUpperCase().replace(/\s+/g, '-').slice(0, 20),
      warehouse_id: l.warehouseId,
      parent_location_id: l.parentId || null,
      type,
      is_active: l.isActive,
      removal_strategy: 'fifo',
    });
    inserted++;
  }
  localStorage.setItem('erp_' + MIGRATED_FLAG, '1');
  removeItem(LEGACY_KEY);
  return inserted;
}
