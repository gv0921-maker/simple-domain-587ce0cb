/**
 * Product Variants — the FULL management surface.
 * Route: /inventory2/config/variants
 *
 * A sibling of /inventory2/config/attributes, not a section of it. Attributes
 * are a global vocabulary shared by every product; a variant belongs to exactly
 * one product. Putting both in one list would imply they are the same kind of
 * thing, and the row shapes have nothing in common.
 *
 * This is where variants are created, edited, archived and restored for any
 * product. The product form's Attributes & Variants tab does a narrower job for
 * one product; Sales can only create.
 *
 * NO DELETE anywhere — RLS forbids it and the database refuses to archive a
 * variant that has physical units. Both refusals surface verbatim.
 */
import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY2_NAV } from '@/lib/navigation';
import { DocumentList, StatusPill, Button, cn, type ListColumn, type StatusTone } from '@/design-system';
import '@/design-system/tokens.css';
import { ErrorBanner, Field, SelectInput } from '@/components/inventory2/formControls';
import { errorText } from '@/lib/inventory2/errorText';
import { VariantEditor } from '@/components/inventory2/VariantEditor';
import {
  useInv2Variants, useInv2AssignedAttributes, useInv2ProductOptions, useSetVariantStatus,
} from '@/hooks/inventory2/variants';
import type { VariantRecord, VariantStatus } from '@/lib/services/inventory2/variants';

const STATUS_TONE: Record<VariantStatus, StatusTone> = {
  provisional: 'blue',
  permanent: 'green',
  archived: 'grey',
};

const STATUS_LABEL: Record<VariantStatus, string> = {
  provisional: 'Provisional',
  permanent: 'Permanent',
  archived: 'Archived',
};

type Filter = VariantStatus | 'all' | 'live';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'live', label: 'Live' },
  { key: 'provisional', label: 'Provisional' },
  { key: 'permanent', label: 'Permanent' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'All' },
];

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function VariantsConfigList() {
  const { data: rows = [], isLoading, error } = useInv2Variants();
  const { data: products = [] } = useInv2ProductOptions();
  const setStatus = useSetVariantStatus();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('live');
  const [creatingFor, setCreatingFor] = useState<string>('');
  const [editing, setEditing] = useState<VariantRecord | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // The scope object, not just the attributes: the editor needs the category to
  // explain an empty candidate space rather than showing a blank dropdown.
  const { data: scope } = useInv2AssignedAttributes(creatingFor || undefined);

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: rows.length, live: 0 };
    for (const r of rows) {
      m[r.status] = (m[r.status] ?? 0) + 1;
      if (r.status !== 'archived') m.live += 1;
    }
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const byStatus = rows.filter((r) =>
      filter === 'all' ? true
      : filter === 'live' ? r.status !== 'archived'
      : r.status === filter);
    const q = search.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter((r) =>
      [r.sku, r.name, r.product_name, ...r.values.map((v) => v.value)]
        .some((v) => (v ?? '').toLowerCase().includes(q)));
  }, [rows, filter, search]);

  async function changeStatus(v: VariantRecord, status: VariantStatus) {
    setActionError(null);
    try {
      await setStatus.mutateAsync({ id: v.id, status });
    } catch (e) {
      // Rule 5 — "cannot be archived: 3 physical unit(s) of it are in stock…"
      // is an instruction, not noise. It stays on screen.
      setActionError(errorText(e));
    }
  }

  const columns: ListColumn<VariantRecord>[] = [
    {
      key: 'variant', label: 'Variant',
      render: (v) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-[hsl(var(--ds-ink))]">{v.name}</div>
          <div className="truncate text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">{v.sku}</div>
        </div>
      ),
    },
    {
      key: 'product', label: 'Product', className: 'w-[160px]',
      render: (v) => v.product_name ?? '—',
    },
    {
      key: 'combo', label: 'Combination', className: 'w-[240px]',
      render: (v) => (
        <span className="flex flex-wrap gap-1">
          {v.values.map((x) => (
            <StatusPill key={x.attribute_id} tone="grey">{x.value}</StatusPill>
          ))}
        </span>
      ),
    },
    {
      key: 'price', label: 'Price', className: 'w-[100px] text-right',
      render: (v) => <span className="tabular-nums">{money(v.sale_price)}</span>,
    },
    {
      key: 'onhand', label: 'On Hand', className: 'w-[85px] text-right',
      render: (v) => <span className="tabular-nums">{v.on_hand}</span>,
    },
    {
      key: 'status', label: 'Status', className: 'w-[110px]',
      render: (v) => <StatusPill tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</StatusPill>,
    },
    {
      key: 'actions', label: '', className: 'w-[150px]',
      render: (v) => (
        <span className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => { setEditing(v); setShowCreate(false); }}>
            Edit
          </Button>
          {v.status === 'archived' ? (
            <Button size="sm" variant="subtle" onClick={() => void changeStatus(v, 'provisional')}>
              Restore
            </Button>
          ) : (
            <Button
              size="sm"
              variant="subtle"
              onClick={() => void changeStatus(v, 'archived')}
              title={v.on_hand > 0
                ? `${v.on_hand} unit(s) in stock — the database will refuse this`
                : undefined}
            >
              Archive
            </Button>
          )}
        </span>
      ),
    },
  ];

  const selectedProduct = products.find((p) => p.id === creatingFor);

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY2_NAV}>
      <div className="ds-root bg-[hsl(var(--ds-canvas))] min-h-full p-4">
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex items-center gap-1 text-[var(--ds-fs-xs)]">
            <li className="font-semibold text-[hsl(var(--ds-ink))]" aria-current="page">
              Product Variants
            </li>
          </ol>
        </nav>

        {error && (
          <div className="mb-3">
            <ErrorBanner title="Failed to load variants" message={errorText(error)} />
          </div>
        )}
        {actionError && (
          <div className="mb-3">
            <ErrorBanner
              title="Could not change the variant"
              message={actionError}
              onDismiss={() => setActionError(null)}
            />
          </div>
        )}

        <p className="mb-3 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
          A variant is a sellable version of a product. Attributes and their values are the
          vocabulary and live on the{' '}
          <a href="/inventory2/config/attributes" className="text-[hsl(var(--ds-link))] hover:underline">
            Product Attributes
          </a>{' '}
          page; assigning them to a product happens on the product form. Variants are never
          deleted — archive them.
        </p>

        {/* status filter */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'h-[26px] rounded-[var(--ds-radius)] border px-2.5 text-[var(--ds-fs-xs)] font-medium transition-colors',
                filter === f.key
                  ? 'border-[hsl(var(--ds-primary))] bg-[hsl(var(--ds-primary))] text-[hsl(var(--ds-primary-fg))]'
                  : 'border-[hsl(var(--ds-border-strong))] bg-[hsl(var(--ds-surface))] text-[hsl(var(--ds-ink-muted))] hover:bg-[hsl(var(--ds-surface-alt))]',
              )}
            >
              {f.label}
              <span className="ml-1 tabular-nums opacity-70">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>

        {/* create / edit panel */}
        {(showCreate || editing) && (
          <div className="mb-3 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-surface))] p-3">
            <p className="mb-2 text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
              {editing ? `Edit ${editing.sku}` : 'New variant'}
            </p>

            {!editing && (
              <Field label="Product" required htmlFor="v-product">
                <SelectInput
                  id="v-product"
                  value={creatingFor}
                  onChange={(e) => setCreatingFor(e.target.value)}
                >
                  <option value="">Select…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku}){p.mode === 'made_to_order' ? ' — made to order' : ''}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            )}

            {!editing && selectedProduct?.mode === 'made_to_order' && (
              <p className="mb-2 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-amber))]">
                This product is set to made-to-order, which normally uses the customization
                picker rather than variants. Creating one here is allowed but probably not
                what you want — check the product's mode first.
              </p>
            )}

            {(editing || creatingFor) && (
              <VariantEditor
                productId={editing ? editing.product_id : creatingFor}
                productName={editing ? editing.product_name : selectedProduct?.name}
                scope={scope}
                existing={rows}
                createStatus="permanent"
                canEdit
                variant={editing ?? undefined}
                onDone={() => { setShowCreate(false); setEditing(null); setCreatingFor(''); }}
                onCancel={() => { setShowCreate(false); setEditing(null); setCreatingFor(''); }}
              />
            )}
          </div>
        )}

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <DocumentList<VariantRecord>
            title="Product Variants"
            rows={filtered}
            columns={columns}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search variants, products or values…"
            page={{ from: filtered.length ? 1 : 0, to: filtered.length, total: rows.length }}
            onNew={() => { setShowCreate(true); setEditing(null); }}
            newLabel="New"
            showViewSwitcher={false}
            minTableWidth={900}
            emptyMessage={
              rows.length === 0
                ? 'No variants yet. Assign attributes to a product, then create the combinations you actually sell.'
                : 'No variants match this filter.'
            }
          />
        )}
      </div>
    </AppLayout>
  );
}
