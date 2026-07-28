/**
 * Warehouses — list view (rebuilt on the design system).
 *
 * True-Odoo minimal model: a warehouse is the virtual root parent of its
 * location tree and carries almost no config of its own. Routing defaults live
 * on Operation Types, so nothing here reads or writes
 * `warehouses.default_receipt_location_id` / `default_delivery_location_id` /
 * `default_internal_location_id`.
 *
 * Reads `warehouses` (via the existing inventory service) and
 * `warehouse_locations` (read-only, to show each warehouse's stock location).
 *
 * The pre-existing card-based page at /inventory/warehouses is untouched and
 * still routed; this is the rebuilt view, retired only after sign-off.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useWarehouses, useLocations } from '@/hooks/inventory';
import type { Warehouse } from '@/lib/services/inventory';
import { DocumentList, type ListColumn } from '@/design-system';
import '@/design-system/tokens.css';
import { stockLocationLabel } from './warehouseStockLocation';

const PAGE_SIZE = 20;

export default function WarehousesConfigList() {
  const navigate = useNavigate();
  const warehousesQuery = useWarehouses();
  const locationsQuery = useLocations();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const warehouses = useMemo(() => warehousesQuery.data ?? [], [warehousesQuery.data]);
  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return warehouses;
    return warehouses.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.code.toLowerCase().includes(q) ||
        stockLocationLabel(locations, w.id).toLowerCase().includes(q),
    );
  }, [warehouses, locations, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const columns: ListColumn<Warehouse>[] = [
    {
      key: 'name',
      label: 'Warehouse',
      className: 'w-[40%] min-w-[160px]',
      render: (w) => (
        <span className="font-medium text-[hsl(var(--ds-link))] group-hover:underline">
          {w.name}
        </span>
      ),
    },
    {
      key: 'code',
      label: 'Short Name',
      className: 'w-[25%] min-w-[110px]',
      render: (w) => <span className="text-[hsl(var(--ds-ink))]">{w.code}</span>,
    },
    {
      key: 'stockLocation',
      label: 'Stock Location',
      className: 'w-[35%] min-w-[150px]',
      render: (w) => (
        <span className="text-[hsl(var(--ds-ink-muted))]">
          {stockLocationLabel(locations, w.id)}
        </span>
      ),
    },
  ];

  // Surface load failures verbatim rather than rendering an empty list as if
  // the database genuinely held no warehouses.
  const loadError = warehousesQuery.error ?? locationsQuery.error;

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="ds-root bg-[hsl(var(--ds-canvas))] min-h-full p-4">
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex items-center gap-1 text-[var(--ds-fs-xs)]">
            <li className="font-semibold text-[hsl(var(--ds-ink))]" aria-current="page">
              Warehouses
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

        <DocumentList<Warehouse>
          title="Warehouses"
          rows={visible}
          columns={columns}
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          searchPlaceholder="Search warehouses…"
          onNew={() => navigate('/inventory/config/warehouses/new')}
          onRowClick={(w) => navigate(`/inventory/config/warehouses/${w.id}`)}
          getRowLabel={(w) => w.name}
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
          minTableWidth={520}
          emptyMessage={
            warehousesQuery.isLoading ? 'Loading…' : 'No warehouses match your search.'
          }
        />
      </div>
    </AppLayout>
  );
}
