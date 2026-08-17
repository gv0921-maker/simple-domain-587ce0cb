/**
 * Inventory 2 — outgoing delivery detail. Route: /inventory2/deliveries/:id
 *
 * Mirrors TransferDetail's Odoo shape: always-visible fields (including when
 * Done), the stage ribbon, padded fixed-height line tables, Moves and
 * Traceability views, and a Chatter. Every write goes through a database RPC —
 * no direct table writes, and in particular never a direct insert into
 * inv_stock_item / inv_move_line / inv_stock_tracking.
 *
 * What the buttons do:
 *   Validate  inv_complete_operation      Add/edit  inv_add_operation_line
 *   Remove    inv_remove_operation_line
 *
 * ── THE PAYMENT NOTICE IS NOT DECORATION ──────────────────────────────────
 * `inv_assert_delivery_paid` exists, is named, reads the same predicate legacy
 * `complete_delivery_with_qc` uses — and raises `feature_not_supported`, because
 * sales_orders.paid_amount is not maintained until the Sales module is rebuilt.
 * It is deliberately NOT wired into `inv_complete_operation`.
 *
 * So Validate on this page completes a delivery WITHOUT ANY PAYMENT CHECK, and
 * the banner says exactly that. An inert gate nobody is told about is
 * indistinguishable from a gate that ran and approved, which is the failure the
 * whole design was shaped to avoid. When the gate is switched on, that banner
 * is the thing that comes out.
 *
 * The order's paid/total figures ARE shown, and labelled as not verified. They
 * come from the same COALESCE(grand_total, total) the gate will use, so the
 * screen and the gate cannot quote different numbers.
 *
 * ── NO QUALITY SEGMENT, DELIBERATELY ──────────────────────────────────────
 * Same reason as on a transfer, not a copy-paste: `inv_test_result` has no
 * `operation_id`, so an inspection is unit-scoped. Running QC from a delivery
 * would call inv_record_qc_results and overwrite the RECEIPT's verdict for that
 * unit; rendering results read-only would show receipt-era findings under a
 * delivery's heading. requires_qc stays false on every outgoing type. CLAUDE.md.
 *
 * ── CONDITION IS WARNED AT THE BAY, NOT BLOCKED HERE ──────────────────────
 * The scan screen asks before an unfit unit is committed, naming the condition
 * (see `scanDelivery.ts`). This page reports what was decided. It does not
 * re-litigate it: the units table flags anything that is not `ok` so a delivery
 * carrying one is legible after the fact.
 *
 * ── WHY THERE IS NO CANCEL BUTTON ─────────────────────────────────────────
 * `inv_cancel_receipt` is receipt-only. Cancelling a delivery whose units have
 * physically left is a reversal, which does not exist, and it is a business
 * decision rather than a refactor. Shown disabled with the reason.
 */
import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY2_NAV } from '@/lib/navigation';
import {
  DocumentHeader, DocumentFields, DocumentTabs, Chatter, StatusPill, Button, cn,
  type DocumentField, type DocumentTab, type RibbonStage, type HeaderAction,
  type SegmentOption, type ChatterEntry, type StatusTone,
} from '@/design-system';
import '@/design-system/tokens.css';
import { TextInput, SelectInput, ErrorBanner } from '@/components/inventory2/formControls';
import { errorText } from '@/lib/inventory2/errorText';
import { useActivityLog } from '@/hooks/useActivityLog';
import { useAppUsers, displayNameFor } from '@/hooks/useAppUsers';
import {
  useInv2Delivery, useInv2DeliveryProducts,
  useAddDeliveryLine, useRemoveDeliveryLine, useCompleteDelivery,
} from '@/hooks/inventory2/deliveries';
import type {
  InvOperationState, InvStockStatus, DeliverySalesOrder,
} from '@/lib/services/inventory2/deliveries';

/* ------------------------------------------------------------ state map */

const RIBBON_STAGES: RibbonStage[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'ready', label: 'Ready' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

function stageFor(state: InvOperationState): string {
  switch (state) {
    case 'draft': return 'draft';
    case 'waiting': return 'draft';
    case 'ready': return 'ready';
    case 'in_progress': return 'in_progress';
    case 'done': return 'done';
    default: return '__none__';
  }
}

const STATUS_TONE: Record<InvStockStatus, StatusTone> = {
  ok: 'green',
  attention: 'amber',
  quarantined: 'blue',
  rejected: 'red',
  damaged: 'red',
  destroyed: 'red',
  lost: 'grey',
};

const STATUS_LABEL: Record<InvStockStatus, string> = {
  ok: 'OK',
  attention: 'Attention',
  quarantined: 'Quarantined',
  rejected: 'Rejected',
  damaged: 'Damaged',
  destroyed: 'Destroyed',
  lost: 'Lost',
};

/* ---------------------------------------------------------------- format */

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try { return format(parseISO(iso), 'dd/MM/yyyy HH:mm:ss'); } catch { return iso; }
}
function fmtTime(iso: string): string {
  try { return format(parseISO(iso), 'HH:mm'); } catch { return iso; }
}
function dayBucket(iso: string): string {
  try {
    const d = parseISO(iso);
    if (isToday(d)) return 'Today';
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'd MMMM yyyy');
  } catch { return iso.slice(0, 10); }
}
const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DASH = <span className="text-[hsl(var(--ds-ink-subtle))]">—</span>;

/* ----------------------------------------------------------------- table */

const LINE_TABLE_MIN_ROWS = 6;
const fillerFor = (n: number) => LINE_TABLE_MIN_ROWS - Math.max(n, 1);

const TD = 'px-2 py-1.5 border-b border-[hsl(var(--ds-border)/0.7)] align-top';

function TableShell({
  head, children, empty, isEmpty, filler = 0,
}: {
  head: string[];
  children: React.ReactNode;
  empty: string;
  isEmpty: boolean;
  filler?: number;
}) {
  return (
    <div className="ds-scroll-x overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[var(--ds-fs-sm)]">
        <thead>
          <tr className="border-b border-[hsl(var(--ds-border-strong))]">
            {head.map((h) => (
              <th key={h} className="px-2 py-1.5 text-left font-semibold text-[hsl(var(--ds-ink-muted))]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr>
              <td colSpan={head.length} className="px-2 py-6 text-center text-[hsl(var(--ds-ink-subtle))]">
                {empty}
              </td>
            </tr>
          ) : children}
          {Array.from({ length: Math.max(0, filler) }, (_, i) => (
            <tr key={`filler-${i}`} aria-hidden="true">
              {head.map((h) => <td key={h} className={TD}>&nbsp;</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EndValue({ name, locked, typeName, which }: {
  name: string | null;
  locked: boolean;
  typeName: string | null;
  which: 'source' | 'destination';
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {name ?? DASH}
      {locked && (
        <span
          title={`Locked by operation type ${typeName ?? ''} — staff cannot change the ${which}`}
          className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]"
        >
          (locked)
        </span>
      )}
    </span>
  );
}

/**
 * The inert-gate banner. Amber, always shown, never dismissible.
 *
 * Not dismissible on purpose: this is a standing fact about the system, not an
 * event that has been acknowledged. It disappears when the gate is switched on,
 * and not before.
 */
function PaymentGateBanner({ order }: { order: DeliverySalesOrder | null }) {
  const shortfall = order ? order.total - order.paid_amount : 0;
  return (
    <div className="flex items-start gap-2 border-b border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-amber-bg))] px-3 py-2">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--ds-amber))]" aria-hidden />
      <div className="min-w-0 text-[var(--ds-fs-sm)]">
        <p className="font-semibold text-[hsl(var(--ds-amber))]">
          Payment verification is not active until the Sales module is complete
        </p>
        <p className="mt-0.5 text-[hsl(var(--ds-ink))]">
          Validating this delivery will <strong>not</strong> check whether it has been paid for.
          The gate exists and is named <code>inv_assert_delivery_paid</code>, but it refuses
          rather than approves — it cannot verify payment, so it says so instead of returning
          a pass — and it is deliberately not wired into completion.
        </p>
        {order ? (
          <p className="mt-1 text-[hsl(var(--ds-ink-muted))]">
            {order.reference ?? 'This order'} records{' '}
            <strong className="tabular-nums">{money(order.paid_amount)}</strong> paid of{' '}
            <strong className="tabular-nums">{money(order.total)}</strong>
            {shortfall > 0.005
              ? <> — <strong className="tabular-nums">{money(shortfall)}</strong> outstanding.</>
              : '.'}{' '}
            <em>
              These figures are shown, not verified: Sales does not maintain them yet, so they
              are not evidence either way.
            </em>
          </p>
        ) : (
          <p className="mt-1 text-[hsl(var(--ds-ink-muted))]">
            No sales order is recorded on this delivery, so there would be nothing for the gate
            to read even once it is switched on.
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function DeliveryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const routeState = useLocation().state as {
    createdSourceIgnored?: boolean;
    createdDestinationIgnored?: boolean;
  } | null;

  const { data: detail, isLoading, error } = useInv2Delivery(id);
  const { data: activity } = useActivityLog('inv_operation', id, 50);
  const { data: appUsers = [] } = useAppUsers();
  const { data: products = [] } = useInv2DeliveryProducts();

  const [segment, setSegment] = useState<'details' | 'moves' | 'traceability'>('details');

  const addLine = useAddDeliveryLine(id);
  const removeLine = useRemoveDeliveryLine(id);
  const complete = useCompleteDelivery(id);

  const [newProductId, setNewProductId] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [editQty, setEditQty] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null);
  const [ignoredDismissed, setIgnoredDismissed] = useState(false);

  async function run(title: string, fn: () => Promise<unknown>) {
    setFailure(null);
    try {
      await fn();
    } catch (e) {
      setFailure({ title, message: errorText(e) });
    }
  }

  const userName = useMemo(
    () => (uid: string | null): string | null => {
      if (!uid) return null;
      const u = appUsers.find((x) => x.user_id === uid);
      return displayNameFor(u) || uid;   // surfaced, never blanked
    },
    [appUsers],
  );

  const chatterEntries: ChatterEntry[] = useMemo(() => {
    const rows = activity?.entries ?? [];
    return [...rows]
      .sort((a, b) => a.changed_at.localeCompare(b.changed_at))
      .map((e) => ({
        id: e.id,
        author: userName(e.changed_by) || e.changed_by_name || 'System',
        time: fmtTime(e.changed_at),
        day: dayBucket(e.changed_at),
        kind: e.action_type === 'manual_note' ? 'note' : 'log',
        body: e.note_text ?? `${e.action_type} ${e.field_name ?? ''}`.trim(),
      } satisfies ChatterEntry));
  }, [activity, userName]);

  if (isLoading) {
    return (
      <AppLayout title="Delivery" moduleNav={INVENTORY2_NAV}>
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      </AppLayout>
    );
  }

  // Rule 5 — real error text, never a swallowed blank page.
  if (error) {
    return (
      <AppLayout title="Delivery" moduleNav={INVENTORY2_NAV}>
        <div className="p-6">
          <div className="rounded border border-destructive/40 bg-destructive/5 p-4">
            <p className="font-semibold text-destructive">Failed to load delivery</p>
            <pre className="mt-2 whitespace-pre-wrap text-xs">
              {String((error as Error).message ?? error)}
            </pre>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!detail) {
    return (
      <AppLayout title="Delivery" moduleNav={INVENTORY2_NAV}>
        <div className="p-6 text-sm text-muted-foreground">
          No delivery found for id <code>{id}</code>.
        </div>
      </AppLayout>
    );
  }

  const d = detail.delivery;
  const isDone = d.state === 'done';
  const isCancelled = d.state === 'cancelled';
  const editable = !isDone && !isCancelled;

  const totalShipped = detail.lines.reduce((s, l) => s + l.shipped_qty, 0);
  const totalDemand = detail.lines.reduce((s, l) => s + l.demand_qty, 0);
  const unfitCount = detail.units.filter((u) => u.status !== 'ok').length;

  const actions: HeaderAction[] = editable
    ? [
        {
          key: 'validate',
          label: complete.isPending ? 'Validating…' : 'Validate',
          variant: 'primary',
          onClick: () => void run('Could not validate the delivery', () => complete.mutateAsync()),
          disabled: complete.isPending || totalShipped === 0,
          title: totalShipped === 0
            ? 'Deliver at least one unit onto this document before validating'
            : undefined,
        },
        { key: 'print', label: 'Print', disabled: true, title: 'Printing coming in a later pass' },
        {
          key: 'cancel',
          label: 'Cancel',
          disabled: true,
          title:
            'Cancelling is not built for deliveries. inv_cancel_receipt is receipt-only: a '
            + 'receipt refuses cancel once units exist because it created them, but a '
            + 'delivery’s units already existed and have physically left, so cancelling would '
            + 'mean reversing a movement — a decision, not a refactor.',
        },
      ]
    : [
        { key: 'print', label: 'Print', disabled: true, title: 'Printing coming in a later pass' },
      ];

  const segments: SegmentOption[] = [
    { key: 'details', label: 'Details' },
    { key: 'moves', label: 'Moves' },
    { key: 'barcode', label: 'Barcode' },
    // NO Quality segment. See the header — this is a decision, not a gap.
    ...(isDone ? [{ key: 'traceability', label: 'Traceability' }] : []),
  ];

  /* -- fields: rendered in EVERY state, Done included -------------------- */

  const leftFields: DocumentField[] = [
    { key: 'type', label: 'Operation Type', value: d.operation_type_name ?? DASH },
    {
      key: 'customer',
      label: 'Customer',
      value: d.customer_name ?? DASH,
      muted: !d.customer_name,
    },
    {
      key: 'so',
      label: 'Sales Order',
      value: detail.salesOrder?.reference ?? DASH,
      muted: !detail.salesOrder,
    },
    { key: 'created', label: 'Created On', value: fmtDate(d.created_at) ?? DASH },
  ];

  const rightFields: DocumentField[] = [
    {
      key: 'src',
      label: 'Source Location',
      value: (
        <EndValue
          name={d.source_location_name}
          locked={d.operation_type_locks_source}
          typeName={d.operation_type_name}
          which="source"
        />
      ),
    },
    {
      key: 'dest',
      label: 'Destination Location',
      value: (
        <EndValue
          name={d.dest_location_name}
          locked={d.operation_type_locks_destination}
          typeName={d.operation_type_name}
          which="destination"
        />
      ),
    },
    ...(isDone
      ? [{ key: 'eff', label: 'Effective Date', value: fmtDate(d.done_at) ?? DASH } satisfies DocumentField]
      : [{ key: 'sched', label: 'Scheduled Date', value: fmtDate(d.scheduled_at) ?? DASH, muted: !d.scheduled_at } satisfies DocumentField]),
    { key: 'by', label: 'Created by', value: userName(d.created_by) ?? DASH },
  ];

  /* -- tabs -------------------------------------------------------------- */

  const tabs: DocumentTab[] = [
    {
      key: 'operations',
      label: 'Operations',
      badge: detail.lines.length,
      content: (
        <>
          <TableShell
            head={['Product', 'Demand', 'Delivered', 'Unit', 'Move State', '']}
            empty="This delivery has no lines. Add a product line, then scan units onto it."
            isEmpty={detail.lines.length === 0}
            filler={fillerFor(detail.lines.length)}
          >
            {detail.lines.map((l) => {
              const draft = editQty[l.move_id];
              const dirty = draft !== undefined && draft !== String(l.demand_qty);
              return (
                <tr key={l.move_id}>
                  <td className={TD}>
                    <div className="text-[hsl(var(--ds-ink))]">{l.product_name ?? '—'}</div>
                    {l.product_sku && (
                      <div className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                        {l.product_sku}
                      </div>
                    )}
                  </td>
                  <td className={cn(TD, 'tabular-nums')}>
                    {editable ? (
                      <div className="flex items-center gap-1">
                        <TextInput
                          type="number"
                          min="0"
                          aria-label={`Demand for ${l.product_name ?? 'line'}`}
                          className="h-[26px] w-[70px] px-1.5 py-0"
                          value={draft ?? String(l.demand_qty)}
                          onChange={(e) =>
                            setEditQty({ ...editQty, [l.move_id]: e.target.value })}
                        />
                        {dirty && (
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={addLine.isPending}
                            onClick={() => void run('Could not update the line', async () => {
                              await addLine.mutateAsync({
                                productId: l.product_id,
                                demandQty: Number(draft),
                              });
                              setEditQty((m) => {
                                const next = { ...m };
                                delete next[l.move_id];
                                return next;
                              });
                            })}
                          >
                            Save
                          </Button>
                        )}
                      </div>
                    ) : l.demand_qty}
                  </td>
                  <td className={cn(TD, 'tabular-nums')}>
                    {l.shipped_qty}
                    {l.shipped_qty > l.demand_qty && (
                      <span className="ml-1.5 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-amber))]">
                        over
                      </span>
                    )}
                  </td>
                  <td className={TD}>Units</td>
                  <td className={TD}>{l.move_state}</td>
                  <td className={cn(TD, 'text-right whitespace-nowrap')}>
                    {editable && (
                      <button
                        type="button"
                        disabled={removeLine.isPending}
                        onClick={() => void run(
                          'Could not remove the line',
                          () => removeLine.mutateAsync(l.move_id),
                        )}
                        className="text-[hsl(var(--ds-red))] hover:underline disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </TableShell>

          {editable && (
            <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-[hsl(var(--ds-border))] pt-2">
              <div className="min-w-[220px] flex-1">
                <label htmlFor="addprod" className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))]">
                  Add product line
                </label>
                <SelectInput
                  id="addprod"
                  value={newProductId}
                  onChange={(e) => setNewProductId(e.target.value)}
                >
                  <option value="">Select a product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.sku ? ` · ${p.sku}` : ''}
                    </option>
                  ))}
                </SelectInput>
              </div>
              <div className="w-[100px]">
                <label htmlFor="addqty" className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))]">
                  Demand
                </label>
                <TextInput
                  id="addqty"
                  type="number"
                  min="0"
                  value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                />
              </div>
              <Button
                variant="primary"
                disabled={!newProductId || addLine.isPending}
                onClick={() => void run('Could not add the line', async () => {
                  await addLine.mutateAsync({
                    productId: newProductId,
                    demandQty: Number(newQty) || 0,
                  });
                  setNewProductId('');
                  setNewQty('1');
                })}
              >
                {addLine.isPending ? 'Adding…' : 'Add line'}
              </Button>
              <p className="w-full text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                Adding a product that already has a line updates that line's demand instead of
                creating a duplicate. Units are delivered onto a line by scanning, not from here.
              </p>
            </div>
          )}
        </>
      ),
    },
    {
      key: 'units',
      label: 'Units',
      badge: detail.units.length,
      content: (
        <>
          <TableShell
            head={['Lot/Serial Number', 'From', 'To', 'Now At', 'Condition', 'Delivered At']}
            empty="No units have been delivered onto this document yet. Scan them at the bay."
            isEmpty={detail.units.length === 0}
            filler={fillerFor(detail.units.length)}
          >
            {detail.units.map((u) => (
              <tr key={u.stock_item_id}>
                <td className={cn(TD, 'font-mono text-[var(--ds-fs-xs)]')}>{u.serial}</td>
                {/* From the MOVE LINE — where the unit actually was, not the
                    document's configured source. */}
                <td className={TD}>{u.from_location_name ?? DASH}</td>
                <td className={TD}>{u.to_location_name ?? DASH}</td>
                <td className={TD}>{u.location_name ?? DASH}</td>
                <td className={TD}>
                  <StatusPill tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</StatusPill>
                </td>
                <td className={TD}>{fmtDate(u.done_at) ?? DASH}</td>
              </tr>
            ))}
          </TableShell>
          {unfitCount > 0 ? (
            <p className="mt-2 text-[var(--ds-fs-xs)] leading-relaxed text-[hsl(var(--ds-amber))]">
              <strong>{unfitCount} unit(s) on this delivery are not in OK condition.</strong>{' '}
              Each was warned about by name and condition at the bay before it was added, and
              accepted deliberately. Shown here so the decision is legible afterwards — the
              database records no such warning, because it does not check condition at all.
            </p>
          ) : (
            <p className="mt-2 text-[var(--ds-fs-xs)] leading-relaxed text-[hsl(var(--ds-ink-subtle))]">
              A delivery does not change a unit's condition — it ships stock, it does not
              re-inspect it. Every unit here was OK when it was scanned; anything else would
              have raised a warning naming its condition at the bay.
            </p>
          )}
        </>
      ),
    },
    {
      key: 'note',
      label: 'Note',
      content: d.notes
        ? <p className="whitespace-pre-wrap text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">{d.notes}</p>
        : <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-subtle))]">No note.</p>,
    },
  ];

  const ignoredAnEnd = !!routeState?.createdSourceIgnored || !!routeState?.createdDestinationIgnored;

  return (
    <AppLayout title={`Delivery ${d.number}`} moduleNav={INVENTORY2_NAV}>
      <div className="ds-root p-3 md:p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0">
            <DocumentHeader
              breadcrumb={['Inventory 2', 'Deliveries', d.number]}
              title={d.number}
              actions={actions}
              segments={segments}
              activeSegment={segment}
              onSegmentChange={(k) => {
                if (k === 'barcode') {
                  navigate(`/inventory2/barcode?operation=${id}`);
                  return;
                }
                setSegment(k as 'details' | 'moves' | 'traceability');
              }}
              stages={RIBBON_STAGES}
              currentStage={stageFor(d.state)}
              cog={{ items: [], printDisabled: true, printDisabledTitle: 'Printing coming in a later pass' }}
            />

            <div className="rounded-b-[var(--ds-radius)] border border-t-0 border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-surface))]">
              {isCancelled && (
                <div className="flex items-center gap-2 border-b border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-red-bg))] px-3 py-2">
                  <StatusPill tone="red">Cancelled</StatusPill>
                  <span className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
                    This delivery was cancelled and never completed a stage.
                  </span>
                </div>
              )}

              {/* Standing, not dismissible. See PaymentGateBanner. */}
              <PaymentGateBanner order={detail.salesOrder} />

              {ignoredAnEnd && !ignoredDismissed && (
                <div className="border-b border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-amber-bg))] px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">
                      {routeState?.createdSourceIgnored && (
                        <>
                          The source you chose was replaced by{' '}
                          <strong>{d.source_location_name ?? 'the type default'}</strong>.{' '}
                        </>
                      )}
                      {routeState?.createdDestinationIgnored && (
                        <>
                          The destination you chose was replaced by{' '}
                          <strong>{d.dest_location_name ?? 'the type default'}</strong>.{' '}
                        </>
                      )}
                      Operation type <strong>{d.operation_type_name}</strong> fixes that end of
                      the route.
                    </p>
                    <button
                      type="button"
                      onClick={() => setIgnoredDismissed(true)}
                      className="shrink-0 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))] hover:underline"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Rule 5 — the RPC's refusal, verbatim, until dismissed. */}
              {failure && (
                <div className="border-b border-[hsl(var(--ds-border))] p-3">
                  <ErrorBanner
                    title={failure.title}
                    message={failure.message}
                    onDismiss={() => setFailure(null)}
                  />
                </div>
              )}

              {/*
                The party first, then the route. On a delivery the route is the
                same for every document — one CUSTOMERS node — so leading with
                it would put the least informative fact in the most prominent
                place.
              */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[hsl(var(--ds-border))] px-3 py-2">
                <div>
                  <div className="text-[var(--ds-fs-xs)] uppercase tracking-wide text-[hsl(var(--ds-ink-subtle))]">
                    Customer
                  </div>
                  <div className="text-[var(--ds-fs-md)] font-semibold text-[hsl(var(--ds-ink))]">
                    {d.customer_name ?? <span className="font-normal text-[hsl(var(--ds-ink-subtle))]">none recorded</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
                    {d.source_location_name ?? '—'}
                  </span>
                  <ArrowRight className="h-4 w-4 text-[hsl(var(--ds-ink-subtle))]" aria-hidden />
                  <span className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
                    {d.dest_location_name ?? '—'}
                  </span>
                </div>
                <div>
                  <div className="text-[var(--ds-fs-xs)] uppercase tracking-wide text-[hsl(var(--ds-ink-subtle))]">
                    Units delivered
                  </div>
                  <div className="text-[var(--ds-fs-md)] font-semibold tabular-nums text-[hsl(var(--ds-ink))]">
                    {totalShipped}
                    <span className="text-[var(--ds-fs-sm)] font-normal text-[hsl(var(--ds-ink-subtle))]">
                      {' '}/ {totalDemand}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {detail.unitBuckets.map((b) => (
                    <StatusPill key={b.location_name + b.status} tone={STATUS_TONE[b.status]}>
                      {b.qty} {STATUS_LABEL[b.status]} · {b.location_name}
                    </StatusPill>
                  ))}
                </div>
              </div>

              {/* Fields render in EVERY state — Done included. */}
              <DocumentFields columns={[leftFields, rightFields]} />

              {segment === 'details' && <DocumentTabs tabs={tabs} />}

              {segment === 'moves' && (
                <div className="border-t border-[hsl(var(--ds-border))] p-3">
                  <TableShell
                    head={['Product', 'Serial', 'From', 'To', 'Type', 'Date']}
                    empty="No stock moves recorded for this delivery."
                    isEmpty={detail.ledger.length === 0}
                    filler={fillerFor(detail.ledger.length)}
                  >
                    {detail.ledger.map((m) => (
                      <tr key={m.id}>
                        <td className={TD}>{m.product_name ?? DASH}</td>
                        <td className={cn(TD, 'font-mono text-[var(--ds-fs-xs)]')}>{m.serial}</td>
                        <td className={TD}>{m.from_location_name ?? DASH}</td>
                        <td className={TD}>{m.to_location_name ?? DASH}</td>
                        <td className={TD}>{m.entry_type}</td>
                        <td className={TD}>{fmtDate(m.created_at) ?? DASH}</td>
                      </tr>
                    ))}
                  </TableShell>
                  <p className="mt-2 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                    Scoped to this document. A unit's full history spans every document it has
                    ever been on; showing all of it here would credit this delivery with
                    movements it did not perform.
                  </p>
                </div>
              )}

              {segment === 'traceability' && (
                <div className="border-t border-[hsl(var(--ds-border))] p-3">
                  <TableShell
                    head={['Reference', 'Product', 'Date', 'Lot/Serial', 'From', 'To', 'Condition', 'Qty']}
                    empty="Nothing to trace for this delivery."
                    isEmpty={detail.ledger.length === 0}
                    filler={fillerFor(detail.ledger.length)}
                  >
                    {detail.ledger.map((m) => {
                      const u = detail.units.find((x) => x.stock_item_id === m.stock_item_id);
                      return (
                        <tr key={m.id}>
                          <td className={cn(TD, 'font-mono text-[var(--ds-fs-xs)]')}>{d.number}</td>
                          <td className={TD}>{m.product_name ?? DASH}</td>
                          <td className={TD}>{fmtDate(m.created_at) ?? DASH}</td>
                          <td className={cn(TD, 'font-mono text-[var(--ds-fs-xs)]')}>{m.serial}</td>
                          <td className={TD}>{m.from_location_name ?? DASH}</td>
                          <td className={TD}>{m.to_location_name ?? DASH}</td>
                          <td className={TD}>
                            {u ? <StatusPill tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</StatusPill> : DASH}
                          </td>
                          <td className={cn(TD, 'tabular-nums')}>1</td>
                        </tr>
                      );
                    })}
                  </TableShell>
                </div>
              )}
            </div>
          </div>

          <Chatter entries={chatterEntries} followers={0} className="self-start" />
        </div>
      </div>
    </AppLayout>
  );
}
