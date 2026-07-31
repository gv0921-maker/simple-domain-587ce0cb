/**
 * Product Attributes — list view (rebuilt on the design system).
 *
 * `listAttributes()` already returns each attribute with its values attached
 * (two queries joined client-side), so the value preview costs nothing extra.
 *
 * ⚠ Nothing consumes these yet. `product_attribute_assignments` has 0 rows and
 * the one product's `variants` jsonb carries `attributes: {}`, so attributes are
 * defined but not applied to any product. The machinery exists — ProductDetail
 * renders ProductAttributesAssignment — it has simply never been used.
 *
 * Reads `product_attributes` + `product_attribute_values` through the existing
 * service (useProductAttributes -> listAttributes). Legacy AttributesConfig at
 * /inventory/setup/attributes is untouched and still routed.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useProductAttributes } from '@/hooks/inventory/config';
import type { ProductAttribute } from '@/lib/services/inventory/attributes';
import { DocumentList, StatusPill, type ListColumn } from '@/design-system';
import '@/design-system/tokens.css';
import { displayTypeLabel } from './configMeta';

const PAGE_SIZE = 20;

export default function AttributesConfigList() {
  const navigate = useNavigate();
  const query = useProductAttributes();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const attributes = useMemo(() => query.data ?? [], [query.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return attributes;
    return attributes.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        displayTypeLabel(a.displayType).toLowerCase().includes(q) ||
        (a.values ?? []).some((v) => v.value.toLowerCase().includes(q)),
    );
  }, [attributes, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const columns: ListColumn<ProductAttribute>[] = [
    {
      key: 'name',
      label: 'Attribute',
      className: 'w-[24%] min-w-[130px]',
      render: (a) => (
        <span className="font-medium text-[hsl(var(--ds-link))] group-hover:underline">
          {a.name}
        </span>
      ),
    },
    {
      key: 'displayType',
      label: 'Display Type',
      className: 'w-[20%] min-w-[130px]',
      render: (a) => (
        <span className="text-[hsl(var(--ds-ink))]">{displayTypeLabel(a.displayType)}</span>
      ),
    },
    {
      key: 'values',
      label: 'Values',
      className: 'w-[42%] min-w-[190px]',
      render: (a) => {
        const values = a.values ?? [];
        if (!values.length) {
          return <span className="italic text-[hsl(var(--ds-ink-subtle))]">no values</span>;
        }
        return (
          <span className="flex flex-wrap items-center gap-1">
            <span className="tabular-nums text-[hsl(var(--ds-ink-muted))]">
              {values.length}
            </span>
            <span className="truncate text-[hsl(var(--ds-ink-muted))]">
              — {values.map((v) => v.value).join(', ')}
            </span>
          </span>
        );
      },
    },
    {
      key: 'active',
      label: 'Status',
      className: 'w-[14%] min-w-[90px]',
      render: (a) =>
        a.isActive ? (
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
              Product Attributes
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
          Attributes and their values are defined here; assigning them to a product happens
          on the product form. No product uses them yet.
        </p>

        <DocumentList<ProductAttribute>
          title="Product Attributes"
          rows={visible}
          columns={columns}
          getRowLabel={(a) => a.name}
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          searchPlaceholder="Search attributes or values…"
          onNew={() => navigate('/inventory/config/attributes/new')}
          onRowClick={(a) => navigate(`/inventory/config/attributes/${a.id}`)}
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
          minTableWidth={640}
          emptyMessage={query.isLoading ? 'Loading…' : 'No attributes match your search.'}
        />
      </div>
    </AppLayout>
  );
}
