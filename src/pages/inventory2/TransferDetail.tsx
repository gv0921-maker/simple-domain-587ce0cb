/**
 * Inventory 2 — internal transfer detail. Route: /inventory2/transfers/:id
 *
 * Mirrors ReceiptDetail's Odoo shape: always-visible fields (including when
 * Done), the stage ribbon, padded fixed-height line tables, Moves and
 * Traceability views, and a Chatter. Every write goes through a database RPC —
 * no direct table writes, and in particular never a direct insert into
 * inv_stock_item / inv_move_line / inv_stock_tracking.
 *
 * What the buttons do:
 *   Validate  inv_complete_operation      Add/edit  inv_add_operation_line
 *   Remove    inv_remove_operation_line
 *
 * ── BOTH ENDS, ALWAYS, WITH THE LOCK SHOWN ────────────────────────────────
 * Source and destination are both rendered in every state, each carrying a
 * "(locked)" affordance when its operation type fixes it. This is the treatment
 * the receipt page gives `locks_destination`, applied to both ends because a
 * transfer HAS two meaningful ends — the route is the document's meaning.
 * `locks_source` is read here and on the create form and nowhere else in the
 * codebase; transfers are its first consumer.
 *
 * ── NO QUALITY SEGMENT, DELIBERATELY ──────────────────────────────────────
 * Not an oversight and not "later". `inv_test_result` has no `operation_id`, so
 * an inspection is unit-scoped: it is a permanent fact about the unit with no
 * record of which document it was performed on. Running QC from a transfer
 * would call inv_record_qc_results, which re-derives the unit's status against
 * its ENTIRE applicable checklist and marks prior rows not-latest — overwriting
 * the receipt's verdict for that unit. Rendering the results read-only would be
 * no better: the screen would show receipt-era findings under a transfer's
 * heading with nothing saying they belong to a different event.
 *
 * requires_qc therefore stays false on every internal type. See CLAUDE.md.
 * When `operation_id` lands on inv_test_result, this comment is what comes out.
 *
 * ── WHY THERE IS NO CANCEL BUTTON ─────────────────────────────────────────
 * `inv_cancel_receipt` is receipt-only and was deliberately NOT generalised
 * with the line RPCs. Cancelling a receipt refuses once units exist because it
 * would strand units the document CREATED. A transfer's units already existed
 * and have physically moved, so cancelling asks a different question — does it
 * move them back? that is a reversal, which does not exist — and that is a
 * business decision, not a refactor. The action is shown disabled with the
 * reason rather than hidden, so the gap is legible instead of mysterious.
 */
import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { ArrowRight } from 'lucide-react';
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
  useInv2Transfer, useInv2TransferProducts,
  useAddTransferLine, useRemoveTransferLine, useCompleteTransfer,
} from '@/hooks/inventory2/transfers';
import type {
  InvOperationState, InvStockStatus,
} from '@/lib/services/inventory2/transfers';

/* ------------------------------------------------------------ state map */

const RIBBON_STAGES: RibbonStage[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'ready', label: 'Ready' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

/** Six states collapse onto four stages; cancelled is off-ribbon by design. */
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
          {/* Spacer rows: gridlines only, inert, aria-hidden. */}
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

/** A location value with the lock affordance when the type fixes it. */
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

/* ------------------------------------------------------------------ page */

export default function TransferDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const routeState = useLocation().state as {
    createdSourceIgnored?: boolean;
    createdDestinationIgnored?: boolean;
  } | null;

  const { data: detail, isLoading, error } = useInv2Transfer(id);
  const { data: activity } = useActivityLog('inv_operation', id, 50);
  const { data: appUsers = [] } = useAppUsers();
  const { data: products = [] } = useInv2TransferProducts();

  const [segment, setSegment] = useState<'details' | 'moves' | 'traceability'>('details');

  const addLine = useAddTransferLine(id);
  const removeLine = useRemoveTransferLine(id);
  const complete = useCompleteTransfer(id);

  const [newProductId, setNewProductId] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [editQty, setEditQty] = useState<Record<string, string>>({});
  /** The database's own words, kept on screen until dismissed. */
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
      <AppLayout title="Transfer" moduleNav={INVENTORY2_NAV}>
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      </AppLayout>
    );
  }

  // Rule 5 — real error text, never a swallowed blank page.
  if (error) {
    return (
      <AppLayout title="Transfer" moduleNav={INVENTORY2_NAV}>
        <div className="p-6">
          <div className="rounded border border-destructive/40 bg-destructive/5 p-4">
            <p className="font-semibold text-destructive">Failed to load transfer</p>
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
      <AppLayout title="Transfer" moduleNav={INVENTORY2_NAV}>
        <div className="p-6 text-sm text-muted-foreground">
          No transfer found for id <code>{id}</code>.
        </div>
      </AppLayout>
    );
  }

  const t = detail.transfer;
  const isDone = t.state === 'done';
  const isCancelled = t.state === 'cancelled';
  /** The same test the RPCs apply. Kept in one place so buttons and tables agree. */
  const editable = !isDone && !isCancelled;

  const totalMoved = detail.lines.reduce((s, l) => s + l.moved_qty, 0);
  const totalDemand = detail.lines.reduce((s, l) => s + l.demand_qty, 0);

  /*
   * State-dependent actions, following the receipt page:
   *   editable  ->  Validate (primary) · Print · Cancel (disabled, with reason)
   *   done      ->  Print only — a completed transfer is a record.
   * Validate is disabled with a reason until at least one unit has moved,
   * because completing an empty transfer records a movement that did not happen.
   */
  const actions: HeaderAction[] = editable
    ? [
        {
          key: 'validate',
          label: complete.isPending ? 'Validating…' : 'Validate',
          variant: 'primary',
          onClick: () => void run('Could not validate the transfer', () => complete.mutateAsync()),
          disabled: complete.isPending || totalMoved === 0,
          title: totalMoved === 0
            ? 'Move at least one unit onto this transfer before validating'
            : undefined,
        },
        { key: 'print', label: 'Print', disabled: true, title: 'Printing coming in a later pass' },
        {
          key: 'cancel',
          label: 'Cancel',
          disabled: true,
          title:
            'Cancelling is not built for transfers. inv_cancel_receipt is receipt-only and was '
            + 'deliberately not generalised: a receipt refuses cancel once units exist because it '
            + 'created them, but a transfer’s units already existed and have moved, so cancelling '
            + 'would mean reversing a movement — a decision, not a refactor.',
        },
      ]
    : [
        { key: 'print', label: 'Print', disabled: true, title: 'Printing coming in a later pass' },
      ];

  const segments: SegmentOption[] = [
    { key: 'details', label: 'Details' },
    { key: 'moves', label: 'Moves' },
    // Hands off to the scan screen carrying this transfer. Not the legacy
    // /barcode queue, and not ScanWorkspace's scan_queue — both belong to
    // other models and are left exactly as they are.
    { key: 'barcode', label: 'Barcode' },
    // NO Quality segment. See the header — this is a decision, not a gap.
    ...(isDone ? [{ key: 'traceability', label: 'Traceability' }] : []),
  ];

  /* -- fields: rendered in EVERY state, Done included -------------------- */

  const leftFields: DocumentField[] = [
    { key: 'type', label: 'Operation Type', value: t.operation_type_name ?? DASH },
    {
      key: 'src',
      label: 'Source Location',
      value: (
        <EndValue
          name={t.source_location_name}
          locked={t.operation_type_locks_source}
          typeName={t.operation_type_name}
          which="source"
        />
      ),
    },
    {
      key: 'dest',
      label: 'Destination Location',
      value: (
        <EndValue
          name={t.dest_location_name}
          locked={t.operation_type_locks_destination}
          typeName={t.operation_type_name}
          which="destination"
        />
      ),
    },
    { key: 'created', label: 'Created On', value: fmtDate(t.created_at) ?? DASH },
  ];

  const rightFields: DocumentField[] = [
    { key: 'sched', label: 'Scheduled Date', value: fmtDate(t.scheduled_at) ?? DASH, muted: !t.scheduled_at },
    ...(isDone
      ? [{ key: 'eff', label: 'Effective Date', value: fmtDate(t.done_at) ?? DASH } satisfies DocumentField]
      : []),
    { key: 'srcdoc', label: 'Source Document', value: t.source_document ?? DASH, muted: !t.source_document },
    { key: 'by', label: 'Created by', value: userName(t.created_by) ?? DASH },
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
            head={['Product', 'Demand', 'Moved', 'Unit', 'Move State', '']}
            empty="This transfer has no lines. Add a product line, then scan units onto it."
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
                              // Upsert by product — the RPC updates the existing move.
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
                    {l.moved_qty}
                    {l.moved_qty > l.demand_qty && (
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
                creating a duplicate. Units are moved onto a line by scanning, not from here.
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
            head={['Lot/Serial Number', 'From', 'To', 'Now At', 'Condition', 'Moved At']}
            empty="No units have been moved onto this transfer yet. Scan them at the bay."
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
          <p className="mt-2 text-[var(--ds-fs-xs)] leading-relaxed text-[hsl(var(--ds-ink-subtle))]">
            A transfer does not change a unit's condition — it relocates stock, it does not
            re-inspect it. Quarantined and rejected units move freely here on purpose:
            relocating badly-placed quarantined stock is exactly what a transfer is for, and
            sending rejected stock out to a vendor is a different document type.
          </p>
        </>
      ),
    },
    {
      key: 'note',
      label: 'Note',
      content: t.notes
        ? <p className="whitespace-pre-wrap text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">{t.notes}</p>
        : <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-subtle))]">No note.</p>,
    },
  ];

  const ignoredAnEnd = !!routeState?.createdSourceIgnored || !!routeState?.createdDestinationIgnored;

  return (
    <AppLayout title={`Transfer ${t.number}`} moduleNav={INVENTORY2_NAV}>
      <div className="ds-root p-3 md:p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0">
            <DocumentHeader
              breadcrumb={['Inventory 2', 'Internal Transfers', t.number]}
              title={t.number}
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
              currentStage={stageFor(t.state)}
              cog={{ items: [], printDisabled: true, printDisabledTitle: 'Printing coming in a later pass' }}
            />

            <div className="rounded-b-[var(--ds-radius)] border border-t-0 border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-surface))]">
              {isCancelled && (
                <div className="flex items-center gap-2 border-b border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-red-bg))] px-3 py-2">
                  <StatusPill tone="red">Cancelled</StatusPill>
                  <span className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
                    This transfer was cancelled and never completed a stage.
                  </span>
                </div>
              )}

              {/*
                The create form sent an end the operation type overrode. Saying
                so is the difference between "the system corrected me" and "the
                system quietly ignored me". This is the first screen anywhere to
                report a locks_SOURCE override.
              */}
              {ignoredAnEnd && !ignoredDismissed && (
                <div className="border-b border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-amber-bg))] px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">
                      {routeState?.createdSourceIgnored && (
                        <>
                          The source you chose was replaced by{' '}
                          <strong>{t.source_location_name ?? 'the type default'}</strong>.{' '}
                        </>
                      )}
                      {routeState?.createdDestinationIgnored && (
                        <>
                          The destination you chose was replaced by{' '}
                          <strong>{t.dest_location_name ?? 'the type default'}</strong>.{' '}
                        </>
                      )}
                      Operation type <strong>{t.operation_type_name}</strong> fixes that end of
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

              {/* The route, stated once, prominently: it IS the document. */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[hsl(var(--ds-border))] px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[var(--ds-fs-md)] font-semibold text-[hsl(var(--ds-ink))]">
                    {t.source_location_name ?? '—'}
                  </span>
                  <ArrowRight className="h-4 w-4 text-[hsl(var(--ds-ink-subtle))]" aria-hidden />
                  <span className="text-[var(--ds-fs-md)] font-semibold text-[hsl(var(--ds-ink))]">
                    {t.dest_location_name ?? '—'}
                  </span>
                </div>
                <div>
                  <div className="text-[var(--ds-fs-xs)] uppercase tracking-wide text-[hsl(var(--ds-ink-subtle))]">
                    Units moved
                  </div>
                  <div className="text-[var(--ds-fs-md)] font-semibold tabular-nums text-[hsl(var(--ds-ink))]">
                    {totalMoved}
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
                    empty="No stock moves recorded for this transfer."
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
                    ever been on; showing all of it here would credit this transfer with
                    movements it did not perform.
                  </p>
                </div>
              )}

              {segment === 'traceability' && (
                <div className="border-t border-[hsl(var(--ds-border))] p-3">
                  <TableShell
                    head={['Reference', 'Product', 'Date', 'Lot/Serial', 'From', 'To', 'Condition', 'Qty']}
                    empty="Nothing to trace for this transfer."
                    isEmpty={detail.ledger.length === 0}
                    filler={fillerFor(detail.ledger.length)}
                  >
                    {detail.ledger.map((m) => {
                      const u = detail.units.find((x) => x.stock_item_id === m.stock_item_id);
                      return (
                        <tr key={m.id}>
                          <td className={cn(TD, 'font-mono text-[var(--ds-fs-xs)]')}>{t.number}</td>
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
