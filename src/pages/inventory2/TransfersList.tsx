/**
 * Inventory 2 — internal transfers list. Route: /inventory2/transfers
 *
 * A read; it never writes. New routes to the create form, which calls
 * inv_create_operation.
 *
 * BOTH ENDS ARE COLUMNS. A transfer's meaning IS its route — "Godown →
 * Showroom" — so a list that showed only a destination would be describing half
 * the document. The receipt list gets away with one location column because a
 * receipt's other end is a vendor; a transfer has no partner at all.
 *
 * The legacy screens at /inventory/internal-movements are untouched and still
 * live. This mounts alongside them. Note that they are backed by
 * `internal_movements`, which has ZERO rows — the live legacy data is in
 * `internal_transfer_orders`, a third model again, and neither is read here.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ArrowRight } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY2_NAV } from '@/lib/navigation';
import { DocumentList, StatusPill, type ListColumn, type StatusTone } from '@/design-system';
import '@/design-system/tokens.css';
import { useInv2Transfers } from '@/hooks/inventory2/transfers';
import type { TransferRow, InvOperationState } from '@/lib/services/inventory2/transfers';

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

export default function TransfersList() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading, error } = useInv2Transfers();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.number, r.operation_type_name, r.source_location_name, r.dest_location_name, r.source_document]
        .some((v) => (v ?? '').toLowerCase().includes(q)));
  }, [rows, search]);

  const columns: ListColumn<TransferRow>[] = [
    {
      key: 'number', label: 'Reference', className: 'w-[160px]',
      render: (r) => <span className="font-medium text-[hsl(var(--ds-ink))]">{r.number}</span>,
    },
    { key: 'type', label: 'Operation Type', render: (r) => r.operation_type_name ?? '—' },
    {
      key: 'route', label: 'Route',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span>{r.source_location_name ?? '—'}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--ds-ink-subtle))]" aria-hidden />
          <span>{r.dest_location_name ?? '—'}</span>
        </span>
      ),
    },
    {
      key: 'units', label: 'Moved', className: 'w-[90px] text-right',
      render: (r) => (
        <span className="tabular-nums">
          {r.unit_count}
          <span className="text-[hsl(var(--ds-ink-subtle))]"> / {r.demand_qty}</span>
        </span>
      ),
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
    <AppLayout title="Internal Transfers" moduleNav={INVENTORY2_NAV}>
      <div className="ds-root p-3 md:p-4">
        {/* Rule 5 — show the real error, never a blank page. */}
        {error && (
          <div className="mb-3 rounded border border-destructive/40 bg-destructive/5 p-4">
            <p className="font-semibold text-destructive">Failed to load transfers</p>
            <pre className="mt-2 whitespace-pre-wrap text-xs">
              {String((error as Error).message ?? error)}
            </pre>
          </div>
        )}

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <DocumentList<TransferRow>
            title="Internal Transfers"
            rows={filtered}
            columns={columns}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search transfers…"
            page={{ from: filtered.length ? 1 : 0, to: filtered.length, total: rows.length }}
            onNew={() => navigate('/inventory2/transfers/new')}
            newLabel="New"
            onRowClick={(r) => navigate(`/inventory2/transfers/${r.id}`)}
          />
        )}

        <p className="mt-3 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
          Inventory 2 preview. The legacy screens at{' '}
          <code>/inventory/internal-movements</code> are unaffected by anything done here.
        </p>
      </div>
    </AppLayout>
  );
}
