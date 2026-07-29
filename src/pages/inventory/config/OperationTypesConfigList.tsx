/**
 * Operation Types — list view (rebuilt on the design system).
 *
 * Matches Odoo's simple operation-types list: name, kind, and the routing
 * defaults this type applies to its documents.
 *
 * Reads `operation_types` through the existing service
 * (useOperationTypes -> listOperationTypes) and `warehouse_locations`
 * read-only, to resolve the two default location ids into names.
 *
 * The legacy OperationTypesConfig panel at /inventory/setup/operation-types is
 * untouched and still routed; this is the rebuilt view, retired only after
 * sign-off.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useOperationTypes } from '@/hooks/inventory/config';
import { useLocationsQuery } from '@/hooks/inventory/useLocations';
import type { OperationType } from '@/lib/services/inventory/operationTypes';
import { DocumentList, type ListColumn } from '@/design-system';
import '@/design-system/tokens.css';
import { indexById } from './locationPath';
import { operationKindLabel } from './operationTypeMeta';

const PAGE_SIZE = 20;

export default function OperationTypesConfigList() {
  const navigate = useNavigate();
  const typesQuery = useOperationTypes();
  const locationsQuery = useLocationsQuery();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const types = useMemo(() => typesQuery.data ?? [], [typesQuery.data]);
  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const locationsById = useMemo(() => indexById(locations), [locations]);

  const locName = (id?: string | null) =>
    (id ? locationsById.get(id)?.name : undefined) ?? '—';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return types;
    return types.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        operationKindLabel(t.operationKind).toLowerCase().includes(q) ||
        (t.sequencePrefix ?? '').toLowerCase().includes(q),
    );
  }, [types, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const columns: ListColumn<OperationType>[] = [
    {
      key: 'name',
      label: 'Operation Type',
      className: 'w-[34%] min-w-[160px]',
      render: (t) => (
        <span className="font-medium text-[hsl(var(--ds-link))] group-hover:underline">
          {t.name}
        </span>
      ),
    },
    {
      key: 'kind',
      label: 'Type of Operation',
      className: 'w-[26%] min-w-[140px]',
      render: (t) => (
        <span className="text-[hsl(var(--ds-ink))]">{operationKindLabel(t.operationKind)}</span>
      ),
    },
    {
      key: 'route',
      label: 'Source → Destination',
      className: 'w-[40%] min-w-[190px]',
      render: (t) => (
        <span className="text-[hsl(var(--ds-ink-muted))]">
          {locName(t.defaultSourceLocationId)}
          <span className="mx-1.5 text-[hsl(var(--ds-ink-subtle))]">→</span>
          {locName(t.defaultDestLocationId)}
        </span>
      ),
    },
  ];

  const loadError = typesQuery.error ?? locationsQuery.error;

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="ds-root bg-[hsl(var(--ds-canvas))] min-h-full p-4">
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex items-center gap-1 text-[var(--ds-fs-xs)]">
            <li className="font-semibold text-[hsl(var(--ds-ink))]" aria-current="page">
              Operation Types
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

        <DocumentList<OperationType>
          title="Operation Types"
          rows={visible}
          columns={columns}
          getRowLabel={(t) => t.name}
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          searchPlaceholder="Search operation types…"
          onNew={() => navigate('/inventory/config/operation-types/new')}
          onRowClick={(t) => navigate(`/inventory/config/operation-types/${t.id}`)}
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
            typesQuery.isLoading ? 'Loading…' : 'No operation types match your search.'
          }
        />
      </div>
    </AppLayout>
  );
}
