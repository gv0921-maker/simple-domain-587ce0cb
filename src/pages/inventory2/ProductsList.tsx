/**
 * Inventory 2 — products list. Route: /inventory2/products
 *
 * Read-only. Creating and editing happen on the form at
 * /inventory2/products/new and /inventory2/products/:id.
 *
 * The "On Hand" column is DERIVED from inv_stock_item via the inv_on_hand
 * view. It is not products.stock_on_hand — that legacy column reads 10 for the
 * one product that actually holds 23 units, and this list would inherit the lie
 * if it read it.
 *
 * The derived figure is SCOPED TO INTERNAL LOCATIONS. inv_on_hand carries no
 * predicate of its own, so without the location join this column read 25: the
 * 23 in GODOWN plus 2 sitting at DELIVERY ORDER, a `transit` location. Deriving
 * the number is only half the job; scoping it is the other half.
 *
 * The legacy module at /inventory/products is untouched and still live; this
 * mounts alongside it.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY2_NAV } from '@/lib/navigation';
import { DocumentList, StatusPill, type ListColumn } from '@/design-system';
import '@/design-system/tokens.css';
import { ErrorBanner } from '@/components/inventory2/formControls';
import { errorText } from '@/lib/inventory2/errorText';
import { useInv2ProductList } from '@/hooks/inventory2/products';
import type { ProductListRow } from '@/lib/services/inventory2/products';

const TYPE_LABEL: Record<string, string> = {
  stockable: 'Stockable',
  consumable: 'Consumable',
  service: 'Service',
};

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Inv2ProductsList() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading, error } = useInv2ProductList();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.sku, r.barcode, r.category_name, r.uom_name]
        .some((v) => (v ?? '').toLowerCase().includes(q)));
  }, [rows, search]);

  const columns: ListColumn<ProductListRow>[] = [
    {
      key: 'name', label: 'Product',
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-[hsl(var(--ds-ink))]">{r.name}</div>
          <div className="truncate text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
            {r.sku}
          </div>
        </div>
      ),
    },
    {
      key: 'type', label: 'Type', className: 'w-[110px]',
      render: (r) => TYPE_LABEL[r.type] ?? r.type,
    },
    {
      key: 'category', label: 'Category', className: 'w-[140px]',
      render: (r) => r.category_name ?? <span className="text-[hsl(var(--ds-ink-subtle))]">—</span>,
    },
    {
      key: 'uom', label: 'UoM', className: 'w-[90px]',
      render: (r) => r.uom_name ?? <span className="text-[hsl(var(--ds-ink-subtle))]">—</span>,
    },
    {
      key: 'cost', label: 'Cost', className: 'w-[100px] text-right',
      render: (r) => <span className="tabular-nums">{money(r.cost_price)}</span>,
    },
    {
      key: 'onhand', label: 'On Hand', className: 'w-[90px] text-right',
      render: (r) => <span className="tabular-nums">{r.on_hand}</span>,
    },
    {
      key: 'active', label: 'Status', className: 'w-[100px]',
      render: (r) => (
        <StatusPill tone={r.is_active ? 'green' : 'grey'}>
          {r.is_active ? 'Active' : 'Archived'}
        </StatusPill>
      ),
    },
  ];

  return (
    <AppLayout title="Products" moduleNav={INVENTORY2_NAV}>
      <div className="ds-root p-3 md:p-4">
        {/* Rule 5 — show the real error, never a blank page. */}
        {error && (
          <div className="mb-3">
            <ErrorBanner title="Failed to load products" message={errorText(error)} />
          </div>
        )}

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <DocumentList<ProductListRow>
            title="Products"
            rows={filtered}
            columns={columns}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search products…"
            page={{ from: filtered.length ? 1 : 0, to: filtered.length, total: rows.length }}
            onNew={() => navigate('/inventory2/products/new')}
            newLabel="New"
            onRowClick={(r) => navigate(`/inventory2/products/${r.id}`)}
          />
        )}

        <p className="mt-3 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
          On Hand is derived from received units (<code>inv_stock_item</code>), counted
          across every status but only at <strong>internal</strong> locations — stock we
          hold. Units at supplier, customer, transit, production, scrap and
          inventory-loss locations are excluded; they have left the building or not yet
          arrived. The legacy module remains at{' '}
          <code>/inventory/products</code> and is unaffected by anything done here.
        </p>
      </div>
    </AppLayout>
  );
}
