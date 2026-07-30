/**
 * Units of Measure — list view (rebuilt on the design system).
 *
 * `units_of_measure` is flat: name (UNIQUE), abbreviation, uom_type
 * (CHECK reference|bigger|smaller|unit), ratio, is_active. There is NO uom
 * category table on this database, so no category column is shown — Odoo groups
 * units by category and this schema does not.
 *
 * ⚠ Nothing consumes this table yet. The product form's unit dropdown is a
 * hardcoded array (`UNITS` in ProductDetail.tsx) and stock move lines store the
 * unit as free text, so units defined here are organisational only.
 *
 * Reads `units_of_measure` through the existing service
 * (useUnitsOfMeasure -> listUnitsOfMeasure). Legacy UnitsConfig at
 * /inventory/setup/units is untouched and still routed.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useUnitsOfMeasure } from '@/hooks/inventory/config';
import type { UnitOfMeasure } from '@/lib/services/inventory/unitsOfMeasure';
import { DocumentList, StatusPill, type ListColumn } from '@/design-system';
import '@/design-system/tokens.css';
import { uomTypeLabel } from './configMeta';

const PAGE_SIZE = 20;

export default function UomConfigList() {
  const navigate = useNavigate();
  const query = useUnitsOfMeasure();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const units = useMemo(() => query.data ?? [], [query.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return units;
    return units.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.abbreviation.toLowerCase().includes(q) ||
        uomTypeLabel(u.uomType).toLowerCase().includes(q),
    );
  }, [units, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const columns: ListColumn<UnitOfMeasure>[] = [
    {
      key: 'name',
      label: 'Unit',
      className: 'w-[28%] min-w-[130px]',
      render: (u) => (
        <span className="font-medium text-[hsl(var(--ds-link))] group-hover:underline">
          {u.name}
        </span>
      ),
    },
    {
      key: 'abbreviation',
      label: 'Symbol',
      className: 'w-[14%] min-w-[80px]',
      render: (u) => <span className="font-mono text-[hsl(var(--ds-ink))]">{u.abbreviation}</span>,
    },
    {
      key: 'uomType',
      label: 'Type',
      className: 'w-[30%] min-w-[160px]',
      render: (u) => <span className="text-[hsl(var(--ds-ink))]">{uomTypeLabel(u.uomType)}</span>,
    },
    {
      key: 'ratio',
      label: 'Ratio',
      className: 'w-[14%] min-w-[80px]',
      render: (u) => (
        <span className="tabular-nums text-[hsl(var(--ds-ink-muted))]">{u.ratio}</span>
      ),
    },
    {
      key: 'active',
      label: 'Status',
      className: 'w-[14%] min-w-[90px]',
      render: (u) =>
        u.isActive ? (
          <StatusPill tone="green">Active</StatusPill>
        ) : (
          <StatusPill tone="grey">Archived</StatusPill>
        ),
    },
  ];

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="ds-root bg-[hsl(var(--ds-canvas))] min-h-full p-4">
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex items-center gap-1 text-[var(--ds-fs-xs)]">
            <li className="font-semibold text-[hsl(var(--ds-ink))]" aria-current="page">
              Units of Measure
            </li>
          </ol>
        </nav>

        {query.error && (
          <div
            role="alert"
            className="mb-3 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-red)/0.4)] bg-[hsl(var(--ds-red-bg))] px-3 py-2 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-red))]"
          >
            {query.error instanceof Error ? query.error.message : String(query.error)}
          </div>
        )}

        <p className="mb-3 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
          Ratio is relative to the reference unit. Organisational only for now — the product
          form still uses its own fixed unit list.
        </p>

        <DocumentList<UnitOfMeasure>
          title="Units of Measure"
          rows={visible}
          columns={columns}
          getRowLabel={(u) => u.name}
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          searchPlaceholder="Search units…"
          onNew={() => navigate('/inventory/config/uom/new')}
          onRowClick={(u) => navigate(`/inventory/config/uom/${u.id}`)}
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
          minTableWidth={620}
          emptyMessage={query.isLoading ? 'Loading…' : 'No units match your search.'}
        />
      </div>
    </AppLayout>
  );
}
