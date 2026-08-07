/**
 * Inventory 2 — receipts list. Route: /inventory2/receipts
 *
 * READ-ONLY. No New button, no row actions beyond navigating to the detail
 * page. The old module at /inventory/goods-receipts is untouched and still
 * live; this mounts alongside it.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { DocumentList, StatusPill, type ListColumn, type StatusTone } from '@/design-system';
import '@/design-system/tokens.css';
import { useInv2Receipts } from '@/hooks/inventory2/receipts';
import type { ReceiptRow, InvOperationState } from '@/lib/services/inventory2/receipts';

const STATE_LABEL: Record<InvOperationState, string> = {
  draft: 'Draft',
  waiting: 'Waiting',
  ready: 'Ready',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

const STATE_TONE: Record<InvOperationState, StatusTone> = {
  draft: 'grey',
  waiting: 'grey',
  ready: 'blue',
  in_progress: 'amber',
  done: 'green',
  cancelled: 'red',
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try { return format(parseISO(iso), 'dd/MM/yyyy'); } catch { return iso; }
}

export default function ReceiptsList() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading, error } = useInv2Receipts();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.number, r.vendor_name, r.operation_type_name, r.dest_location_name, r.source_document]
        .some((v) => (v ?? '').toLowerCase().includes(q)));
  }, [rows, search]);

  const columns: ListColumn<ReceiptRow>[] = [
    {
      key: 'number', label: 'Reference', className: 'w-[160px]',
      render: (r) => <span className="font-medium text-[hsl(var(--ds-ink))]">{r.number}</span>,
    },
    {
      key: 'vendor', label: 'Receive From',
      render: (r) => r.vendor_name ?? r.source_location_name ?? '—',
    },
    { key: 'type', label: 'Operation Type', render: (r) => r.operation_type_name ?? '—' },
    { key: 'dest', label: 'Destination', render: (r) => r.dest_location_name ?? '—' },
    {
      key: 'units', label: 'Units', className: 'w-[70px] text-right',
      render: (r) => <span className="tabular-nums">{r.unit_count}</span>,
    },
    {
      key: 'sched', label: 'Scheduled', className: 'w-[110px]',
      render: (r) => <span className="tabular-nums">{fmt(r.scheduled_at)}</span>,
    },
    {
      key: 'done', label: 'Effective', className: 'w-[110px]',
      render: (r) => <span className="tabular-nums">{fmt(r.done_at)}</span>,
    },
    {
      key: 'state', label: 'Status', className: 'w-[120px]',
      render: (r) => <StatusPill tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</StatusPill>,
    },
  ];

  return (
    <AppLayout title="Receipts" moduleNav={INVENTORY_NAV}>
      <div className="ds-root p-3 md:p-4">
        {/* Rule 5 — show the real error, never a blank page. */}
        {error && (
          <div className="mb-3 rounded border border-destructive/40 bg-destructive/5 p-4">
            <p className="font-semibold text-destructive">Failed to load receipts</p>
            <pre className="mt-2 whitespace-pre-wrap text-xs">
              {String((error as Error).message ?? error)}
            </pre>
          </div>
        )}

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <DocumentList<ReceiptRow>
            title="Receipts"
            rows={filtered}
            columns={columns}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search receipts…"
            page={{ from: filtered.length ? 1 : 0, to: filtered.length, total: rows.length }}
            onRowClick={(r) => navigate(`/inventory2/receipts/${r.id}`)}
          />
        )}

        <p className="mt-3 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
          Inventory 2 preview — read-only. The live module remains at{' '}
          <code>/inventory/goods-receipts</code>.
        </p>
      </div>
    </AppLayout>
  );
}
