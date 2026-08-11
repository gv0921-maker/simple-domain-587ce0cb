/**
 * Inventory 2 — receipt detail. Route: /inventory2/receipts/:id
 *
 * WRITABLE as of Step 5 Part B. Every write goes through a database RPC via
 * @/lib/services/inventory2/receiptWrites — no direct table writes, and in
 * particular never a direct insert into inv_stock_item / inv_move_line /
 * inv_stock_tracking. Units enter stock only through inv_receive_serial.
 *
 * What the buttons do:
 *   Validate  inv_complete_receipt        Cancel  inv_cancel_receipt
 *   Add/edit  inv_add_receipt_line        Remove  inv_remove_receipt_line
 *   Receive   inv_receive_serial
 *
 * The RPCs own the rules; this page owns none of them. It asks, and when the
 * answer is no it prints the database's refusal verbatim (Rule 5) — those
 * messages are written to tell staff what to do instead, so paraphrasing or
 * toasting-and-forgetting them throws away the useful part.
 *
 * Layout is the Odoo shape validated in GR Pass 1, carried over unchanged:
 * always-visible fields (including when Done — the defect that rebuild
 * existed to fix), the stage ribbon, padded fixed-height line tables, a
 * per-line serial modal, and Moves / Traceability views. The ribbon gains a
 * fourth stage, In Progress, added to inv_operation_state in Step 4A.
 *
 * What is new here and has no equivalent in the old module:
 *   * per-unit QC against a named checklist (inv_test_template /
 *     inv_test_result) rather than one pass/fail boolean
 *   * on-hand shown separately from AVAILABLE, so quarantined units are
 *     visibly not sellable
 */
import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import {
  DocumentHeader, DocumentFields, DocumentTabs, Chatter, StatusPill, Button, cn,
  type DocumentField, type DocumentTab, type RibbonStage, type HeaderAction,
  type SegmentOption, type ChatterEntry, type StatusTone,
} from '@/design-system';
import '@/design-system/tokens.css';
import { useInv2Receipt } from '@/hooks/inventory2/receipts';
import {
  useInv2Products, useAddReceiptLine, useRemoveReceiptLine,
  useReceiveSerial, useCompleteReceipt, useCancelReceipt,
} from '@/hooks/inventory2/receiptMutations';
import {
  TextInput, SelectInput, ErrorBanner,
} from '@/components/inventory2/formControls';
import { errorText } from '@/lib/inventory2/errorText';
import { useActivityLog } from '@/hooks/useActivityLog';
import { useAppUsers, displayNameFor } from '@/hooks/useAppUsers';
import type {
  ReceiptDetail as Detail, InvOperationState, InvStockStatus, QcResult,
} from '@/lib/services/inventory2/receipts';

const LIST_PATH = '/inventory2/receipts';

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

/** Rows every line table shows, real + blank — the GR Pass 1 treatment. */
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

/* ------------------------------------------------------------- QC panel */

function QcPanel({
  detail, stockItemId,
}: { detail: Detail; stockItemId: string }) {
  const results = detail.results.filter((r) => r.stock_item_id === stockItemId);
  const serial = detail.serials.find((s) => s.stock_item_id === stockItemId);

  // Latest result per template — by seq, matching the database's own rule.
  const latest = useMemo(() => {
    const m = new Map<string, QcResult>();
    for (const r of [...results].sort((a, b) => a.seq - b.seq)) m.set(r.template_id, r);
    return m;
  }, [results]);

  // A template applies to a unit if it is global (no product) or targets that
  // unit's product. `serial` comes from a find(), so guard it: with no unit
  // resolved, only the global templates apply.
  const applicable = detail.templates.filter(
    (t) => t.product_id === null || t.product_id === serial?.product_id,
  );

  return (
    <div className="mt-3 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border))]">
      <div className="border-b border-[hsl(var(--ds-border))] px-3 py-2">
        <h3 className="text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
          Quality checklist
        </h3>
        <p className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
          Every <strong>required</strong> test must pass before a unit leaves quarantine.
        </p>
      </div>
      <TableShell
        head={['Test', 'Required', 'Result', 'Value', 'Notes', 'Attachments']}
        empty="No tests defined for this product."
        isEmpty={applicable.length === 0}
      >
        {applicable.map((t) => {
          const r = latest.get(t.id);
          return (
            <tr key={t.id}>
              <td className={TD}>
                <div className="text-[hsl(var(--ds-ink))]">{t.name}</div>
                {t.description && (
                  <div className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                    {t.description}
                  </div>
                )}
              </td>
              <td className={TD}>
                {t.is_required
                  ? <StatusPill tone="grey">Required</StatusPill>
                  : <span className="text-[hsl(var(--ds-ink-subtle))]">Advisory</span>}
              </td>
              <td className={TD}>
                {r
                  ? <StatusPill tone={r.result ? 'green' : 'red'}>{r.result ? 'Pass' : 'Fail'}</StatusPill>
                  : <span className="text-[hsl(var(--ds-ink-subtle))]">Not tested</span>}
              </td>
              <td className={TD}>{r?.value ?? DASH}</td>
              <td className={TD}>{r?.notes ?? DASH}</td>
              <td className={TD}>
                {r && r.attachments?.length
                  ? r.attachments.map((a, i) => (
                      <div key={i} className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-link))]">
                        {a.name ?? a.url ?? 'attachment'}
                      </div>
                    ))
                  : DASH}
              </td>
            </tr>
          );
        })}
      </TableShell>
    </div>
  );
}

/* ------------------------------------------------- detailed operations */

function DetailedOperationsModal({
  detail, moveId, operationId, editable, onClose,
}: {
  detail: Detail;
  moveId: string;
  operationId: string;
  /** False once the document is done or cancelled — the RPC would refuse anyway. */
  editable: boolean;
  onClose: () => void;
}) {
  const line = detail.lines.find((l) => l.move_id === moveId);
  const serials = detail.serials.filter((s) => s.move_id === moveId);
  const [openQc, setOpenQc] = useState<string | null>(serials[0]?.stock_item_id ?? null);

  const receive = useReceiveSerial(operationId);
  const [serial, setSerial] = useState('');
  const [cost, setCost] = useState('0');
  const [failure, setFailure] = useState<string | null>(null);

  async function submitSerial() {
    const s = serial.trim();
    if (!s) return;
    setFailure(null);
    try {
      await receive.mutateAsync({ moveId, serial: s, cost: Number(cost) || 0 });
      setSerial('');   // keep cost — a pallet usually shares one unit cost
    } catch (e) {
      setFailure(errorText(e));
    }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Detailed Operations"
      /* ds-root repeated: tokens are scoped to .ds-root and this is fixed. */
      className="ds-root fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className={cn('max-h-[88vh] w-full max-w-4xl overflow-auto',
          'bg-[hsl(var(--ds-surface))] border border-[hsl(var(--ds-border))]',
          'rounded-[var(--ds-radius)] shadow-[var(--ds-shadow-pop)]')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[hsl(var(--ds-border))] px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="text-[var(--ds-fs-md)] font-semibold text-[hsl(var(--ds-ink))]">
              Detailed Operations
            </h2>
            <p className="truncate text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))]">
              {line?.product_name ?? 'Product'}
              {line?.product_sku ? ` · ${line.product_sku}` : ''}
            </p>
          </div>
          <Button size="sm" variant="subtle" onClick={onClose}>Close</Button>
        </div>

        <div className="p-3">
          <TableShell
            head={['Lot/Serial Number', 'Store To', 'Status', 'Quantity', 'Unit', '']}
            empty="No units received on this line yet."
            isEmpty={serials.length === 0}
            filler={fillerFor(serials.length)}
          >
            {serials.map((s) => (
              <tr key={s.stock_item_id}>
                <td className={cn(TD, 'font-mono text-[var(--ds-fs-xs)]')}>{s.serial}</td>
                <td className={TD}>{s.location_name ?? DASH}</td>
                <td className={TD}>
                  <StatusPill tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</StatusPill>
                </td>
                <td className={cn(TD, 'tabular-nums')}>1</td>
                <td className={TD}>Units</td>
                <td className={cn(TD, 'text-right')}>
                  <button
                    type="button"
                    onClick={() => setOpenQc(openQc === s.stock_item_id ? null : s.stock_item_id)}
                    className="text-[hsl(var(--ds-link))] hover:underline"
                  >
                    {openQc === s.stock_item_id ? 'Hide QC' : 'QC'}
                  </button>
                </td>
              </tr>
            ))}
          </TableShell>

          {openQc && <QcPanel detail={detail} stockItemId={openQc} />}

          {/* -------------------------------------------- receive a unit */}
          {editable ? (
            <div className="mt-3 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border))] p-3">
              <h3 className="text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
                Receive a unit
              </h3>
              <p className="mt-0.5 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                One serial per unit. Received units land <strong>quarantined</strong> — on hand,
                but not available to sell until QC passes.
              </p>

              {failure && (
                <div className="mt-2">
                  <ErrorBanner
                    title="Could not receive that unit"
                    message={failure}
                    onDismiss={() => setFailure(null)}
                  />
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div className="min-w-[200px] flex-1">
                  <label htmlFor="serial" className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))]">
                    Lot / Serial Number
                  </label>
                  <TextInput
                    id="serial"
                    value={serial}
                    onChange={(e) => setSerial(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void submitSerial(); }}
                    placeholder="Scan or type a serial"
                    autoFocus
                  />
                </div>
                <div className="w-[120px]">
                  <label htmlFor="cost" className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))]">
                    Unit cost
                  </label>
                  <TextInput
                    id="cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                  />
                </div>
                <Button
                  variant="primary"
                  onClick={() => void submitSerial()}
                  disabled={!serial.trim() || receive.isPending}
                >
                  {receive.isPending ? 'Receiving…' : 'Receive'}
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
              This receipt is {detail.receipt.state} — units can no longer be received against it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function ReceiptDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const routeState = useLocation().state as { createdDestinationIgnored?: boolean } | null;

  const { data: detail, isLoading, error } = useInv2Receipt(id);
  const { data: activity } = useActivityLog('inv_operation', id, 50);
  const { data: appUsers = [] } = useAppUsers();
  const { data: products = [] } = useInv2Products();

  const [segment, setSegment] = useState<'details' | 'moves' | 'traceability'>('details');
  const [detailsMoveId, setDetailsMoveId] = useState<string | null>(null);

  /* -- writes ------------------------------------------------------------ */
  const addLine = useAddReceiptLine(id);
  const removeLine = useRemoveReceiptLine(id);
  const complete = useCompleteReceipt(id);
  const cancel = useCancelReceipt(id);

  const [newProductId, setNewProductId] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [editQty, setEditQty] = useState<Record<string, string>>({});
  const [confirmCancel, setConfirmCancel] = useState(false);
  /** The database's own words, kept on screen until dismissed. */
  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null);
  const [destIgnoredDismissed, setDestIgnoredDismissed] = useState(false);

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
      <AppLayout title="Receipt" moduleNav={INVENTORY_NAV}>
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      </AppLayout>
    );
  }

  // Rule 5 — real error text, never a swallowed blank page.
  if (error) {
    return (
      <AppLayout title="Receipt" moduleNav={INVENTORY_NAV}>
        <div className="p-6">
          <div className="rounded border border-destructive/40 bg-destructive/5 p-4">
            <p className="font-semibold text-destructive">Failed to load receipt</p>
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
      <AppLayout title="Receipt" moduleNav={INVENTORY_NAV}>
        <div className="p-6 text-sm text-muted-foreground">
          No receipt found for id <code>{id}</code>.
        </div>
      </AppLayout>
    );
  }

  const r = detail.receipt;
  const isDone = r.state === 'done';
  const isCancelled = r.state === 'cancelled';
  /** The same test the RPCs apply. Kept in one place so buttons and tables agree. */
  const editable = !isDone && !isCancelled;

  const totalReceived = detail.lines.reduce((s, l) => s + l.received_qty, 0);

  /*
   * State-dependent actions, following the Odoo reference:
   *   editable  ->  Validate (primary) · Print · Cancel (danger)
   *   done      ->  Print only; Validate and Cancel are gone, not greyed —
   *                 a completed receipt is a record, and offering to cancel it
   *                 implies an undo that does not exist.
   *   cancelled ->  Print only.
   * Validate is disabled with a reason until at least one unit exists, because
   * completing an empty receipt records an arrival that did not happen.
   */
  const actions: HeaderAction[] = editable
    ? [
        {
          key: 'validate',
          label: complete.isPending ? 'Validating…' : 'Validate',
          variant: 'primary',
          onClick: () => void run('Could not validate the receipt', () => complete.mutateAsync()),
          disabled: complete.isPending || totalReceived === 0,
          title: totalReceived === 0
            ? 'Receive at least one unit before validating'
            : undefined,
        },
        { key: 'print', label: 'Print', disabled: true, title: 'Printing coming in a later pass' },
        {
          key: 'cancel',
          label: cancel.isPending ? 'Cancelling…' : 'Cancel',
          variant: 'danger',
          onClick: () => setConfirmCancel(true),
          disabled: cancel.isPending,
        },
      ]
    : [
        { key: 'print', label: 'Print', disabled: true, title: 'Printing coming in a later pass' },
      ];

  const segments: SegmentOption[] = [
    { key: 'details', label: 'Details' },
    { key: 'moves', label: 'Moves' },
    ...(isDone ? [{ key: 'traceability', label: 'Traceability' }] : []),
  ];

  /* -- fields: rendered in EVERY state, Done included -------------------- */

  const leftFields: DocumentField[] = [
    { key: 'from', label: 'Receive From', value: r.vendor_name ?? r.source_location_name ?? DASH },
    { key: 'type', label: 'Operation Type', value: r.operation_type_name ?? DASH },
    {
      key: 'dest',
      label: 'Destination Location',
      value: (
        <span className="inline-flex items-center gap-1.5">
          {r.dest_location_name ?? DASH}
          {r.operation_type_locks_destination && (
            <span
              title="Locked by the operation type — staff cannot re-point it"
              className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]"
            >
              (locked)
            </span>
          )}
        </span>
      ),
    },
    { key: 'created', label: 'Created On', value: fmtDate(r.created_at) ?? DASH },
  ];

  const rightFields: DocumentField[] = [
    { key: 'sched', label: 'Scheduled Date', value: fmtDate(r.scheduled_at) ?? DASH, muted: !r.scheduled_at },
    ...(isDone
      ? [{ key: 'eff', label: 'Effective Date', value: fmtDate(r.done_at) ?? DASH } satisfies DocumentField]
      : []),
    { key: 'srcdoc', label: 'Source Document', value: r.source_document ?? DASH, muted: !r.source_document },
    { key: 'by', label: 'Created by', value: userName(r.created_by) ?? DASH },
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
            head={['Product', 'Demand', 'Received', 'Unit', 'Move State', '']}
            empty="This receipt has no lines."
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
                    {l.received_qty}
                    {l.received_qty > l.demand_qty && (
                      <span className="ml-1.5 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-amber))]">
                        over
                      </span>
                    )}
                  </td>
                  <td className={TD}>Units</td>
                  <td className={TD}>{l.move_state}</td>
                  <td className={cn(TD, 'text-right whitespace-nowrap')}>
                    <button
                      type="button"
                      onClick={() => setDetailsMoveId(l.move_id)}
                      className="text-[hsl(var(--ds-link))] hover:underline"
                    >
                      {editable ? 'Receive / Details' : 'Details'}
                    </button>
                    {editable && (
                      <button
                        type="button"
                        disabled={removeLine.isPending}
                        onClick={() => void run(
                          'Could not remove the line',
                          () => removeLine.mutateAsync(l.move_id),
                        )}
                        className="ml-3 text-[hsl(var(--ds-red))] hover:underline disabled:opacity-50"
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
                creating a duplicate.
              </p>
            </div>
          )}
        </>
      ),
    },
    {
      key: 'info',
      label: 'Additional Info',
      content: (
        <DocumentFields
          className="px-0 py-0"
          columns={[
            [
              { key: 'po', label: 'Purchase Order', value: r.purchase_order_number ?? DASH },
              { key: 'postate', label: 'Order Status', value: r.purchase_order_state ?? DASH },
              {
                key: 'qty', label: 'Ordered / Received',
                value: r.ordered_qty != null
                  ? `${r.ordered_qty} / ${r.received_qty}${(r.received_qty ?? 0) > r.ordered_qty ? '  (over-receipt)' : ''}`
                  : DASH,
              },
            ],
            [
              { key: 'src', label: 'Source Location', value: r.source_location_name ?? DASH },
              { key: 'state', label: 'Document State', value: r.state },
              { key: 'locked', label: 'Destination Locked', value: r.operation_type_locks_destination ? 'Yes' : 'No' },
            ],
          ]}
        />
      ),
    },
    {
      key: 'note',
      label: 'Note',
      content: r.notes
        ? <p className="whitespace-pre-wrap text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">{r.notes}</p>
        : <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-subtle))]">No note.</p>,
    },
  ];

  const totalOnHand = detail.onHand.reduce((s, b) => s + b.qty, 0);

  return (
    <AppLayout title={`Receipt ${r.number}`} moduleNav={INVENTORY_NAV}>
      <div className="ds-root p-3 md:p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0">
            <DocumentHeader
              breadcrumb={['Inventory 2', 'Receipts', r.number]}
              title={r.number}
              actions={actions}
              segments={segments}
              activeSegment={segment}
              onSegmentChange={(k) => setSegment(k as 'details' | 'moves' | 'traceability')}
              stages={RIBBON_STAGES}
              currentStage={stageFor(r.state)}
              cog={{ items: [], printDisabled: true, printDisabledTitle: 'Printing coming in a later pass' }}
            />

            <div className="rounded-b-[var(--ds-radius)] border border-t-0 border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-surface))]">
              {isCancelled && (
                <div className="flex items-center gap-2 border-b border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-red-bg))] px-3 py-2">
                  <StatusPill tone="red">Cancelled</StatusPill>
                  <span className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
                    This receipt was cancelled and never completed a stage.
                  </span>
                </div>
              )}

              {/*
                The create form sent a destination the operation type overrode.
                Saying so is the difference between "the system corrected me"
                and "the system quietly ignored me".
              */}
              {routeState?.createdDestinationIgnored && !destIgnoredDismissed && (
                <div className="border-b border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-amber-bg))] px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">
                      The destination you chose was replaced by{' '}
                      <strong>{r.dest_location_name ?? 'the type default'}</strong>, because
                      operation type <strong>{r.operation_type_name}</strong> locks its
                      destination.
                    </p>
                    <button
                      type="button"
                      onClick={() => setDestIgnoredDismissed(true)}
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
                On-hand vs AVAILABLE, side by side. Quarantined, rejected and
                attention units count as on-hand but are NOT sellable — this is
                the visible replacement for the old stock_on_hand column that
                silently counted everything.
              */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[hsl(var(--ds-border))] px-3 py-2">
                <div>
                  <div className="text-[var(--ds-fs-xs)] uppercase tracking-wide text-[hsl(var(--ds-ink-subtle))]">
                    On hand
                  </div>
                  <div className="text-[var(--ds-fs-md)] font-semibold tabular-nums text-[hsl(var(--ds-ink))]">
                    {totalOnHand}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--ds-fs-xs)] uppercase tracking-wide text-[hsl(var(--ds-ink-subtle))]">
                    Available to sell
                  </div>
                  <div className="text-[var(--ds-fs-md)] font-semibold tabular-nums text-[hsl(var(--ds-green))]">
                    {detail.availableQty}
                  </div>
                </div>
                {/*
                  The gap between the two numbers above is the whole point of the
                  QC gate, so it is spelled out rather than left to be inferred.
                */}
                {totalOnHand - detail.availableQty > 0 && (
                  <div>
                    <div className="text-[var(--ds-fs-xs)] uppercase tracking-wide text-[hsl(var(--ds-ink-subtle))]">
                      Held back
                    </div>
                    <div className="text-[var(--ds-fs-md)] font-semibold tabular-nums text-[hsl(var(--ds-amber))]">
                      {totalOnHand - detail.availableQty}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  {detail.onHand.map((b) => (
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
                    empty="No stock moves recorded for this receipt."
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
                </div>
              )}

              {segment === 'traceability' && (
                <div className="border-t border-[hsl(var(--ds-border))] p-3">
                  <TableShell
                    head={['Reference', 'Product', 'Date', 'Lot/Serial', 'From', 'To', 'Status', 'Qty']}
                    empty="Nothing to trace for this receipt."
                    isEmpty={detail.ledger.length === 0}
                    filler={fillerFor(detail.ledger.length)}
                  >
                    {detail.ledger.map((m) => {
                      const s = detail.serials.find((x) => x.stock_item_id === m.stock_item_id);
                      return (
                        <tr key={m.id}>
                          <td className={cn(TD, 'font-mono text-[var(--ds-fs-xs)]')}>{r.number}</td>
                          <td className={TD}>{m.product_name ?? DASH}</td>
                          <td className={TD}>{fmtDate(m.created_at) ?? DASH}</td>
                          <td className={cn(TD, 'font-mono text-[var(--ds-fs-xs)]')}>{m.serial}</td>
                          <td className={TD}>{m.from_location_name ?? DASH}</td>
                          <td className={TD}>{m.to_location_name ?? DASH}</td>
                          <td className={TD}>
                            {s ? <StatusPill tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</StatusPill> : DASH}
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

      {detailsMoveId && (
        <DetailedOperationsModal
          detail={detail}
          moveId={detailsMoveId}
          operationId={r.id}
          editable={editable}
          onClose={() => setDetailsMoveId(null)}
        />
      )}

      {/*
        Cancel confirmation. The refusal path is the interesting one: when units
        exist the RPC raises a paragraph explaining that cancelling would strand
        stock, and telling the user to complete + adjust instead. That paragraph
        is rendered in full by the failure banner above — it is the answer, not
        an error to be swallowed.
      */}
      {confirmCancel && (
        <div
          role="dialog" aria-modal="true" aria-label="Cancel receipt"
          className="ds-root fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
          onClick={() => setConfirmCancel(false)}
        >
          <div
            className={cn('w-full max-w-md bg-[hsl(var(--ds-surface))]',
              'border border-[hsl(var(--ds-border))]',
              'rounded-[var(--ds-radius)] shadow-[var(--ds-shadow-pop)]')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[hsl(var(--ds-border))] px-4 py-2.5">
              <h2 className="text-[var(--ds-fs-md)] font-semibold text-[hsl(var(--ds-ink))]">
                Cancel {r.number}?
              </h2>
            </div>
            <div className="px-4 py-3">
              <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">
                Cancelling marks the receipt and its open lines cancelled.
              </p>
              {totalReceived > 0 && (
                <p className="mt-2 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
                  This receipt has <strong>{totalReceived}</strong> unit(s) already received, so
                  the database is expected to refuse. Its reason will be shown in full.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--ds-border))] px-4 py-2.5">
              <Button variant="subtle" onClick={() => setConfirmCancel(false)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                disabled={cancel.isPending}
                onClick={() => {
                  setConfirmCancel(false);
                  void run('Could not cancel the receipt', () => cancel.mutateAsync());
                }}
              >
                {cancel.isPending ? 'Cancelling…' : 'Cancel receipt'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
