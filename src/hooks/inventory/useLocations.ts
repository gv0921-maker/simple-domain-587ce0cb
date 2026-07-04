// Warehouse Locations hooks — Supabase-backed via `inv` api.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryKeys } from './keys';
import {
  getLocations,
  getLocationsByWarehouse,
  createLocation,
  updateLocation,
  archiveLocation,
  unarchiveLocation,
  deleteLocation,
  getLocationTree,
  buildLocationTree,
  migrateLegacyLocations,
} from '@/lib/services/inventory/locations';
import type { Location } from '@/lib/data/inventory/types';

export const useLocationsQuery = () =>
  useQuery({ queryKey: inventoryKeys.locations(), queryFn: getLocations });

export const useLocationTree = () =>
  useQuery({
    queryKey: [...inventoryKeys.locations(), 'tree'],
    queryFn: getLocationTree,
  });

export const useLocationsByWarehouseQuery = (warehouseId: string | undefined) =>
  useQuery({
    queryKey: warehouseId ? inventoryKeys.locationsByWarehouse(warehouseId) : ['noop'],
    queryFn: () => getLocationsByWarehouse(warehouseId!),
    enabled: !!warehouseId,
  });

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: inventoryKeys.locations() });
}

export function useCreateLocation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: Omit<Location, 'id'>) => createLocation(input),
    onSuccess: invalidate,
  });
}
export function useUpdateLocation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Location> }) => updateLocation(id, patch),
    onSuccess: invalidate,
  });
}
export function useArchiveLocation() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => archiveLocation(id), onSuccess: invalidate });
}
export function useUnarchiveLocation() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => unarchiveLocation(id), onSuccess: invalidate });
}
export function useDeleteLocationHard() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => deleteLocation(id), onSuccess: invalidate });
}

export { buildLocationTree, migrateLegacyLocations };
