/**
 * Product Categories — list view (rebuilt on the design system).
 *
 * Hierarchical: `product_categories.parent_category_id` is a nullable self-FK
 * (ON DELETE SET NULL), so rows show their full path and sort by it, the same
 * pattern as the Locations page.
 *
 * ⚠ Nothing consumes this table yet. The product form's category dropdown is a
 * hardcoded array (`CATEGORIES` in ProductDetail.tsx), `products.category` is
 * free text, and `products.category_id` is NULL on every row. Categories are
 * therefore organisational only until the product form is repointed — the list
 * says so rather than implying otherwise.
 *
 * Reads/writes `product_categories` through the existing service
 * (useProductCategories -> listCategories). Legacy CategoriesConfig at
 * /inventory/setup/categories is untouched and still routed.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useProductCategories } from '@/hooks/inventory/config';
import type { ProductCategory } from '@/lib/services/inventory/categories';
import { DocumentList, StatusPill, type ListColumn } from '@/design-system';
import '@/design-system/tokens.css';
import { categoryPath, indexById } from './configMeta';

const PAGE_SIZE = 20;

type PathRow = { id: string; category: ProductCategory; path: string };

export default function CategoriesConfigList() {
  const navigate = useNavigate();
  const query = useProductCategories();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const categories = useMemo(() => query.data ?? [], [query.data]);

  const withPaths = useMemo<PathRow[]>(() => {
    const byId = indexById(categories);
    return categories
      .map((c) => ({ id: c.id, category: c, path: categoryPath(c, byId) }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return withPaths;
    return withPaths.filter(
      (r) =>
        r.path.toLowerCase().includes(q) ||
        (r.category.description ?? '').toLowerCase().includes(q),
    );
  }, [withPaths, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const columns: ListColumn<PathRow>[] = [
    {
      key: 'path',
      label: 'Category',
      className: 'w-[40%] min-w-[180px]',
      render: (r) => (
        <span className="font-medium text-[hsl(var(--ds-link))] group-hover:underline">
          {r.path}
        </span>
      ),
    },
    {
      key: 'description',
      label: 'Description',
      className: 'w-[34%] min-w-[160px]',
      render: (r) => (
        <span className="block truncate text-[hsl(var(--ds-ink-muted))]">
          {r.category.description || '—'}
        </span>
      ),
    },
    {
      key: 'sort',
      label: 'Sort',
      className: 'w-[12%] min-w-[70px]',
      render: (r) => (
        <span className="tabular-nums text-[hsl(var(--ds-ink-muted))]">
          {r.category.sortOrder}
        </span>
      ),
    },
    {
      key: 'active',
      label: 'Status',
      className: 'w-[14%] min-w-[90px]',
      render: (r) =>
        r.category.isActive ? (
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
              Product Categories
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
          Organisational only for now — the product form still uses its own fixed category
          list, so categories defined here do not yet appear on products.
        </p>

        <DocumentList<PathRow>
          title="Product Categories"
          rows={visible}
          columns={columns}
          getRowLabel={(r) => r.path}
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          searchPlaceholder="Search categories…"
          onNew={() => navigate('/inventory/config/categories/new')}
          onRowClick={(r) => navigate(`/inventory/config/categories/${r.id}`)}
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
          minTableWidth={600}
          emptyMessage={
            query.isLoading
              ? 'Loading…'
              : search
                ? 'No categories match your search.'
                : 'No categories yet — use New to add the first one.'
          }
        />
      </div>
    </AppLayout>
  );
}
