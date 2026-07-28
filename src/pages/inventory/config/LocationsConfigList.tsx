/**
 * Locations — list view (rebuilt on the design system).
 *
 * True-Odoo locations: each row is the full computed path through
 * parent_location_id, rooted at the warehouse, sorted so children sit directly
 * under their parents.
 *
 * There is no storage-category column on `warehouse_locations` and no storage
 * category table anywhere in the schema (verified live — the only match for
 * "categor" is `product_categories`, which is unrelated), so that column is
 * omitted rather than faked.
 *
 * Reads through the same data layer as the legacy WarehouseLocations page:
 * `useLocationsQuery` -> `getLocations` -> `getLocationsAsync`. The legacy page
 * at /inventory/locations is untouched and still routed.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useLocationsQuery } from '@/hooks/inventory/useLocations';
import { useWarehouses } from '@/hooks/inventory';
import type { Location } from '@/lib/services/inventory';
import { DocumentList, type ListColumn } from '@/design-system';
import '@/design-system/tokens.css';
import { indexById, locationPath, locationTypeLabel } from './locationPath';

const PAGE_SIZE = 20;

/** A location plus its computed tree path. `id` mirrors the location id so the
 *  design-system list can key and select rows. */
type PathRow = { id: string; location: Location; path: string };

export default function LocationsConfigList() {
  const navigate = useNavigate();
  const locationsQuery = useLocationsQuery();
  const warehousesQuery = useWarehouses();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const warehouses = useMemo(() => warehousesQuery.data ?? [], [warehousesQuery.data]);

  // Compute each path once, then sort by it so the list reads as a tree.
  const withPaths = useMemo<PathRow[]>(() => {
    const byId = indexById(locations);
    const warehousesById = indexById(warehouses);
    return locations
      .map((l) => ({ id: l.id, location: l, path: locationPath(l, byId, warehousesById) }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [locations, warehouses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return withPaths;
    return withPaths.filter(
      (r) =>
        r.path.toLowerCase().includes(q) ||
        r.location.code.toLowerCase().includes(q) ||
        locationTypeLabel(r.location.type).toLowerCase().includes(q),
    );
  }, [withPaths, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const columns: ListColumn<PathRow>[] = [
    {
      key: 'path',
      label: 'Location',
      className: 'w-[50%] min-w-[200px]',
      render: (r) => (
        <span className="font-medium text-[hsl(var(--ds-link))] group-hover:underline">
          {r.path}
        </span>
      ),
    },
    {
      key: 'type',
      label: 'Location Type',
      className: 'w-[30%] min-w-[150px]',
      render: (r) => (
        <span className="text-[hsl(var(--ds-ink))]">{locationTypeLabel(r.location.type)}</span>
      ),
    },
    {
      key: 'code',
      label: 'Code',
      className: 'w-[20%] min-w-[110px]',
      render: (r) => (
        <span className="text-[hsl(var(--ds-ink-muted))]">{r.location.code}</span>
      ),
    },
  ];

  const loadError = locationsQuery.error ?? warehousesQuery.error;

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="ds-root bg-[hsl(var(--ds-canvas))] min-h-full p-4">
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex items-center gap-1 text-[var(--ds-fs-xs)]">
            <li className="font-semibold text-[hsl(var(--ds-ink))]" aria-current="page">
              Locations
            </li>
          </ol>
        </nav>

        {loadError && (
          <div
            role="alert"
            className="mb-3 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-red)/0.4)] bg-[hsl(var(--ds-red-bg))] px-3 py-2 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-red))]"
          >
            {loadError instanceof Error ? loadError.message : String(loadError)}
          </div>
        )}

        <DocumentList<PathRow>
          title="Locations"
          rows={visible}
          columns={columns}
          getRowLabel={(r) => r.path}
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          searchPlaceholder="Search locations…"
          onNew={() => navigate('/inventory/config/locations/new')}
          onRowClick={(r) => navigate(`/inventory/config/locations/${r.location.id}`)}
          page={{
            from: filtered.length ? safePage * PAGE_SIZE + 1 : 0,
            to: safePage * PAGE_SIZE + visible.length,
            total: filtered.length,
          }}
          onPrevPage={() => setPage((p) => Math.max(0, p - 1))}
          onNextPage={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          prevDisabled={safePage === 0}
          nextDisabled={safePage >= pageCount - 1}
          showViewSwitcher={false}
          minTableWidth={560}
          emptyMessage={
            locationsQuery.isLoading ? 'Loading…' : 'No locations match your search.'
          }
        />
      </div>
    </AppLayout>
  );
}
