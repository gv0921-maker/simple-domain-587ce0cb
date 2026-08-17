/**
 * Inventory 2 — outgoing deliveries list. Route: /inventory2/deliveries
 *
 * A read; it never writes. New routes to the create form, which calls
 * inv_create_operation.
 *
 * THE ROUTE COLUMN IS ALWAYS THE SAME, AND THE CUSTOMER COLUMN IS NOT. Every
 * delivery runs DELIVERY ORDER → CUSTOMERS, because there is one CUSTOMERS node
 * rather than one per customer. So the route is shown for completeness and the
 * column that actually distinguishes two deliveries is the CUSTOMER — read from
 * inv_operation.partner_customer_id, which is where the party lives. See the
 * header of `deliveries.ts` for why place and party are separate questions.
 *
 * The legacy delivery screens at /inventory/delivery-notes are untouched and
 * still live, backed by `delivery_notes` and driven by
 * complete_delivery_with_qc. Nothing here reads or writes them.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ArrowRight } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY2_NAV } from '@/lib/navigation';
import { DocumentList, StatusPill, type ListColumn, type StatusTone } from '@/design-system';
import '@/design-system/tokens.css';
import { useInv2Deliveries } from '@/hooks/inventory2/deliveries';
import type { DeliveryRow, InvOperationState } from '@/lib/services/inventory2/deliveries';

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

export default function DeliveriesList() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading, error } = useInv2Deliveries();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.number, r.operation_type_name, r.customer_name, r.sales_order_reference,
       r.source_location_name, r.dest_location_name, r.source_document]
        .some((v) => (v ?? '').toLowerCase().includes(q)));
  }, [rows, search]);

  const columns: ListColumn<DeliveryRow>[] = [
    {
      key: 'number', label: 'Reference', className: 'w-[160px]',
      render: (r) => <span className="font-medium text-[hsl(var(--ds-ink))]">{r.number}</span>,
    },
    {
      key: 'customer', label: 'Customer',
      render: (r) => r.customer_name ?? (
        <span className="text-[hsl(var(--ds-ink-subtle))]">— no customer recorded</span>
      ),
    },
    {
      key: 'so', label: 'Sales Order', className: 'w-[150px]',
      render: (r) => r.sales_order_reference
        ? <span className="tabular-nums">{r.sales_order_reference}</span>
        : <span className="text-[hsl(var(--ds-ink-subtle))]">—</span>,
    },
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
      key: 'units', label: 'Delivered', className: 'w-[90px] text-right',
      render: (r) => (
        <span className="tabular-nums">
          {r.unit_count}
          <span className="text-[hsl(var(--ds-ink-subtle))]"> / {r.demand_qty}</span>
        </span>
      ),
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
    <AppLayout title="Deliveries" moduleNav={INVENTORY2_NAV}>
      <div className="ds-root p-3 md:p-4">
        {/* Rule 5 — show the real error, never a blank page. */}
        {error && (
          <div className="mb-3 rounded border border-destructive/40 bg-destructive/5 p-4">
            <p className="font-semibold text-destructive">Failed to load deliveries</p>
            <pre className="mt-2 whitespace-pre-wrap text-xs">
              {String((error as Error).message ?? error)}
            </pre>
          </div>
        )}

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <DocumentList<DeliveryRow>
            title="Deliveries"
            rows={filtered}
            columns={columns}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search deliveries…"
            page={{ from: filtered.length ? 1 : 0, to: filtered.length, total: rows.length }}
            onNew={() => navigate('/inventory2/deliveries/new')}
            newLabel="New"
            onRowClick={(r) => navigate(`/inventory2/deliveries/${r.id}`)}
          />
        )}

        <p className="mt-3 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
          Inventory 2 preview. Payment verification is <strong>not active</strong> — see any
          delivery for what that means. The legacy screens at{' '}
          <code>/inventory/delivery-notes</code> are unaffected by anything done here.
        </p>
      </div>
    </AppLayout>
  );
}
