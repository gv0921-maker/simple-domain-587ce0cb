/**
 * Inventory 2 — QC queue. Route: /inventory2/qc
 *
 * Every unit in the system with its condition and the receipt it arrived on,
 * so inspection is a worklist rather than a hunt through documents. Defaults
 * to Quarantined — the units actually awaiting a decision.
 *
 * This is a plain client query: inv_stock_item's SELECT policy is `true` for
 * authenticated, so no view and no RPC were needed for it.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY2_NAV } from '@/lib/navigation';
import { DocumentList, StatusPill, Button, cn, type ListColumn } from '@/design-system';
import '@/design-system/tokens.css';
import { QcRunner } from '@/components/inventory2/QcRunner';
import { useQcQueue } from '@/hooks/inventory2/qc';
import { STATUS_LABEL, STATUS_TONE, type InvStockStatus } from '@/lib/inventory2/status';
import type { QcUnit } from '@/lib/services/inventory2/qc';

type Filter = InvStockStatus | 'all' | 'awaiting';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'quarantined', label: 'Quarantined' },
  { key: 'awaiting', label: 'Not sellable' },
  { key: 'ok', label: 'OK' },
  { key: 'attention', label: 'Attention' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try { return format(parseISO(iso), 'dd/MM/yyyy HH:mm'); } catch { return iso; }
}

export default function QcQueue() {
  const navigate = useNavigate();
  const { data: units = [], isLoading, error } = useQcQueue();
  const [filter, setFilter] = useState<Filter>('quarantined');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<QcUnit | null>(null);

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: units.length, awaiting: 0 };
    for (const u of units) {
      m[u.status] = (m[u.status] ?? 0) + 1;
      if (u.status !== 'ok') m.awaiting += 1;
    }
    return m;
  }, [units]);

  const filtered = useMemo(() => {
    const byStatus = units.filter((u) =>
      filter === 'all' ? true
      : filter === 'awaiting' ? u.status !== 'ok'
      : u.status === filter);
    const q = search.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter((u) =>
      [u.serial, u.product_name, u.product_sku, u.operation_number, u.location_name]
        .some((v) => (v ?? '').toLowerCase().includes(q)));
  }, [units, filter, search]);

  const columns: ListColumn<QcUnit>[] = [
    {
      key: 'serial', label: 'Lot / Serial', className: 'w-[190px]',
      render: (u) => (
        <span className="font-mono text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink))]">{u.serial}</span>
      ),
    },
    {
      key: 'product', label: 'Product',
      render: (u) => (
        <div>
          <div>{u.product_name ?? '—'}</div>
          {u.product_sku && (
            <div className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">{u.product_sku}</div>
          )}
        </div>
      ),
    },
    {
      key: 'receipt', label: 'Receipt', className: 'w-[150px]',
      render: (u) => u.operation_number
        ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (u.operation_id) navigate(`/inventory2/receipts/${u.operation_id}`);
            }}
            className="text-[hsl(var(--ds-link))] hover:underline"
          >
            {u.operation_number}
          </button>
        )
        : <span className="text-[hsl(var(--ds-ink-subtle))]">—</span>,
    },
    { key: 'loc', label: 'Location', className: 'w-[130px]', render: (u) => u.location_name ?? '—' },
    {
      key: 'received', label: 'Received', className: 'w-[140px]',
      render: (u) => <span className="tabular-nums">{fmt(u.received_at)}</span>,
    },
    {
      key: 'status', label: 'Condition', className: 'w-[130px]',
      render: (u) => <StatusPill tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</StatusPill>,
    },
    {
      key: 'act', label: '', className: 'w-[90px] text-right',
      render: (u) => (
        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setActive(u); }}>
          Run QC
        </Button>
      ),
    },
  ];

  return (
    <AppLayout title="Quality Control" moduleNav={INVENTORY2_NAV}>
      <div className="ds-root p-3 md:p-4">
        {error && (
          <div className="mb-3 rounded border border-destructive/40 bg-destructive/5 p-4">
            <p className="font-semibold text-destructive">Failed to load the QC queue</p>
            <pre className="mt-2 whitespace-pre-wrap text-xs">
              {String((error as Error).message ?? error)}
            </pre>
          </div>
        )}

        {/* Status filter. Counts come from the unfiltered set, so the tabs
            keep showing the size of the backlog while you are inside one. */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-[var(--ds-radius-pill)] border px-2.5 py-1 text-[var(--ds-fs-xs)]',
                filter === f.key
                  ? 'border-[hsl(var(--ds-primary))] bg-[hsl(var(--ds-primary))] text-[hsl(var(--ds-primary-fg))]'
                  : 'border-[hsl(var(--ds-border-strong))] text-[hsl(var(--ds-ink-muted))] hover:bg-[hsl(var(--ds-surface-sunken))]',
              )}
            >
              {f.label}
              <span className="ml-1 tabular-nums opacity-80">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <DocumentList<QcUnit>
            title="Units"
            rows={filtered}
            columns={columns}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search serial, product, receipt…"
            page={{ from: filtered.length ? 1 : 0, to: filtered.length, total: units.length }}
            showViewSwitcher={false}
            emptyMessage="Nothing in this bucket."
            onRowClick={(u) => setActive(u)}
          />
        )}

        <p className="mt-3 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
          Only units in <strong>OK</strong> count towards available-to-sell. Everything else is on
          hand but held back.
        </p>
      </div>

      {active && (
        <QcRunner
          stockItemId={active.stock_item_id}
          productId={active.product_id}
          serial={active.serial}
          currentStatus={active.status}
          operationId={active.operation_id ?? undefined}
          onClose={() => setActive(null)}
        />
      )}
    </AppLayout>
  );
}
