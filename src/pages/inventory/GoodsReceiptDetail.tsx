/**
 * Goods Receipt — DETAIL / RECORD view, rebuilt on the design system (Pass 1 of 4).
 *
 * Route: /inventory/goods-receipts/:id
 *
 * SCOPE — this is the detail view only. Not the create wizard (Pass 2), not the
 * barcode screen (Pass 3), not the list (Pass 4). The legacy detail path lives at
 * `src/_archive/GoodsReceiptWizard.detail.legacy.tsx`; `GoodsReceiptWizard.tsx` is
 * untouched and still serves `/inventory/goods-receipts/new`.
 *
 * THE CORE FIX: the legacy page keyed its whole body off `gr.status` and, once the
 * receipt was `completed`, rendered only a "Completed" card — the receipt's own
 * fields disappeared. Here `DocumentFields` renders in every state, Done included.
 *
 * READ-ONLY. Pass 1 displays; it does not mutate. Every header action is rendered
 * disabled with a tooltip saying why (decision: no new service code this pass).
 * Line editing stays in the create/scan flows.
 *
 * Data notes, all verified against the live schema rather than assumed:
 *   * `goods_receipt_lines` has NO unit column and NO line-description column, so
 *     Unit is the literal "Units" and the product cell shows `product_name_cached`.
 *   * `goods_receipts` has NO `scheduled_date` column. The field is shown, per the
 *     layout spec, but reads as an explicit "not stored" rather than a fake date.
 *   * QC state is read from `goods_receipt_serials` (qc_status / qc_notes /
 *     qc_images / stock_status). `goods_receipt_qc` DOES NOT EXIST — see the TODO
 *     at the foot of this file.
 *   * `goods_receipt_serials.current_location` is TEXT holding a location UUID, so
 *     it is resolved through the locations index for display.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import {
  DocumentHeader,
  DocumentFields,
  DocumentTabs,
  Chatter,
  StatusPill,
  Button,
  cn,
  type DocumentField,
  type DocumentTab,
  type RibbonStage,
  type HeaderAction,
  type SegmentOption,
  type ChatterEntry,
} from '@/design-system';
import '@/design-system/tokens.css';
import {
  useGoodsReceipt,
  useGoodsReceipts,
  useGoodsReceiptMoves,
  useCancelGoodsReceipt,
} from '@/hooks/inventory/goodsReceipts';
import { useOperationTypes } from '@/hooks/inventory/config';
import { useLocationsQuery } from '@/hooks/inventory/useLocations';
import { useActivityLog } from '@/hooks/useActivityLog';
import { useAppUsers, displayNameFor } from '@/hooks/useAppUsers';
import type {
  GoodsReceipt,
  GoodsReceiptLine,
  GoodsReceiptSerial,
  GRStatus,
} from '@/lib/services/inventory/goodsReceipt';
import type { ActivityLogEntry } from '@/lib/services/activityLog';

const LIST_PATH = '/inventory/goods-receipts';

/** The legacy scan flow. Rebuilt in Pass 3 — pointed at, never touched, here. */
const BARCODE_PATH = '/barcode';

/* ------------------------------------------------------------------ state map */

/**
 * Six database statuses collapse onto Odoo's three-stage ribbon.
 * `cancelled` is deliberately NOT a stage — a cancelled receipt never reached a
 * stage, so it renders off-ribbon as its own banner.
 */
const RIBBON_STAGES: RibbonStage[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'ready', label: 'Ready' },
  { key: 'done', label: 'Done' },
];

type RibbonKey = 'draft' | 'ready' | 'done';

function ribbonStageFor(status: GRStatus): RibbonKey | null {
  switch (status) {
    case 'draft':
    case 'quantity_pending':
      return 'draft';
    case 'labels_pending':
    case 'qc_pending':
      return 'ready';
    case 'completed':
      return 'done';
    case 'cancelled':
      return null;
    default:
      return null;
  }
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  quantity_pending: 'Quantity Pending',
  labels_pending: 'Labels Pending',
  qc_pending: 'QC Pending',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/* -------------------------------------------------------------------- format */

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso), 'dd/MM/yyyy HH:mm:ss');
  } catch {
    return iso;
  }
}

function dayBucket(iso: string): string {
  try {
    const d = parseISO(iso);
    if (isToday(d)) return 'Today';
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'd MMMM yyyy');
  } catch {
    return iso.slice(0, 10);
  }
}

function fmtTime(iso: string): string {
  try {
    return format(parseISO(iso), 'HH:mm');
  } catch {
    return iso;
  }
}

function friendlyField(name: string | null): string {
  if (!name) return 'field';
  return name.replace(/_id$/i, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Placeholder cell — dimmed, never a blank that reads as "zero". */
const DASH = <span className="text-[hsl(var(--ds-ink-subtle))]">—</span>;

/* ------------------------------------------------------------------- tables */

function TableShell({
  head,
  children,
  empty,
  isEmpty,
  filler = 0,
}: {
  head: string[];
  children: React.ReactNode;
  empty: string;
  isEmpty: boolean;
  /**
   * Blank rows appended after the real ones so the grid holds a fixed height
   * instead of collapsing to its content — Odoo always shows a full block.
   * Defaults to 0, so Moves, Traceability and the Detailed Operations modal
   * keep their existing content-height behaviour untouched.
   */
  filler?: number;
}) {
  return (
    <div className="ds-scroll-x overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[var(--ds-fs-sm)]">
        <thead>
          <tr className="border-b border-[hsl(var(--ds-border-strong))]">
            {head.map((h) => (
              <th
                key={h}
                className="px-2 py-1.5 text-left font-semibold text-[hsl(var(--ds-ink-muted))]"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr>
              <td
                colSpan={head.length}
                className="px-2 py-6 text-center text-[hsl(var(--ds-ink-subtle))]"
              >
                {empty}
              </td>
            </tr>
          ) : (
            children
          )}

          {/*
            Spacer rows: gridlines only, no content and nothing focusable, so
            they read as empty grid to a screen reader and cannot be clicked.
            `&nbsp;` sets the height to one text line — matching a single-line
            data row rather than the taller product/SKU rows.
          */}
          {Array.from({ length: Math.max(0, filler) }, (_, i) => (
            <tr key={`filler-${i}`} aria-hidden="true">
              {head.map((h) => (
                <td key={h} className={TD}>
                  &nbsp;
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Rows every line table always shows, real + blank. Chosen to match the height
 * of a full panel in the Odoo reference; change this one number to retune all
 * three. Real rows beyond this count simply extend the table.
 *
 * Shared by Operations, Moves and Traceability so switching between the three
 * views does not resize the panel. The Detailed Operations modal is excluded —
 * it is a popover sized to its content, not one of the three panel views.
 */
const LINE_TABLE_MIN_ROWS = 6;

/**
 * Blank rows needed to reach that height. An empty table still renders its
 * empty-state message, which occupies one row — hence `max(…, 1)`, so the
 * message keeps its place and the padding fills in beneath it.
 */
function fillerFor(rowCount: number): number {
  return LINE_TABLE_MIN_ROWS - Math.max(rowCount, 1);
}

const TD = 'px-2 py-1.5 border-b border-[hsl(var(--ds-border)/0.7)] align-top';

/* ------------------------------------------------------- detailed operations */

/**
 * "Detailed Operations" — the per-line serial sub-list, read-only in Pass 1.
 * Generate / Import Serials belong to the create + scan flows and are not wired
 * here on purpose.
 */
function DetailedOperationsModal({
  line,
  serials,
  locationName,
  onClose,
}: {
  line: GoodsReceiptLine;
  serials: GoodsReceiptSerial[];
  locationName: (id: string | null) => string | null;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Detailed Operations"
      /*
       * `ds-root` must be repeated here. The overlay is `position: fixed`, but
       * the `--ds-*` tokens are scoped to `.ds-root` in tokens.css — without it
       * every `hsl(var(--ds-…))` resolves to nothing and the panel renders
       * fully transparent over the page.
       */
      className="ds-root fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          'max-h-[85vh] w-full max-w-3xl overflow-auto',
          'bg-[hsl(var(--ds-surface))] border border-[hsl(var(--ds-border))]',
          'rounded-[var(--ds-radius)] shadow-[var(--ds-shadow-pop)]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[hsl(var(--ds-border))] px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="text-[var(--ds-fs-md)] font-semibold text-[hsl(var(--ds-ink))]">
              Detailed Operations
            </h2>
            <p className="truncate text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))]">
              {line.product_name_cached ?? 'Product'}
              {line.product_sku_cached ? ` · ${line.product_sku_cached}` : ''}
            </p>
          </div>
          <Button size="sm" variant="subtle" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="p-3">
          <TableShell
            head={['Lot/Serial Number', 'Store To', 'QC', 'Quantity', 'Unit']}
            empty="No serials generated for this line yet."
            isEmpty={serials.length === 0}
          >
            {serials.map((s) => (
              <tr key={s.id}>
                <td className={cn(TD, 'font-mono text-[var(--ds-fs-xs)]')}>{s.serial_number}</td>
                <td className={TD}>{locationName(s.current_location) ?? DASH}</td>
                <td className={TD}>
                  <StatusPill
                    tone={
                      s.qc_status === 'passed' ? 'green' : s.qc_status === 'failed' ? 'red' : 'grey'
                    }
                  >
                    {s.qc_status}
                  </StatusPill>
                  {s.qc_notes && (
                    <div className="mt-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                      {s.qc_notes}
                    </div>
                  )}
                </td>
                <td className={cn(TD, 'tabular-nums')}>1</td>
                <td className={TD}>Units</td>
              </tr>
            ))}
          </TableShell>

          <p className="mt-2 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
            Read-only in this pass. Serials are generated and scanned from the create and
            barcode flows.
          </p>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- page */

export default function GoodsReceiptDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: detail, isLoading, error } = useGoodsReceipt(id);
  const { data: allReceipts = [] } = useGoodsReceipts();
  const { data: moves = [] } = useGoodsReceiptMoves(id);
  const { data: operationTypes = [] } = useOperationTypes();
  const { data: locations = [] } = useLocationsQuery();
  const { data: activity } = useActivityLog('goods_receipt', id, 50);
  const { data: appUsers = [] } = useAppUsers();

  const [segment, setSegment] = useState<'details' | 'moves' | 'traceability'>('details');
  const [detailsLineId, setDetailsLineId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const cancelGr = useCancelGoodsReceipt(id ?? '');

  const gr = detail?.gr ?? null;
  const lines = detail?.lines ?? [];
  const serials = detail?.serials ?? [];

  /* -- lookups ----------------------------------------------------------- */

  const locationById = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of locations) m.set(l.id, l.name);
    return m;
  }, [locations]);

  const locationName = useMemo(
    () => (locId: string | null) => (locId ? locationById.get(locId) ?? null : null),
    [locationById],
  );

  /**
   * created_by / received_by are bare UUIDs — there is no name column on
   * `goods_receipts` and no FK to a profiles table (there is no profiles table).
   * Resolution order, best source first:
   *   1. `list-app-users` edge function (auth users + metadata name)
   *   2. the activity log's own `changed_by_name`, which the
   *      `get_activity_log_with_users` RPC already resolves server-side via
   *      employees.full_name -> email local-part
   *   3. the raw UUID — never blank, so a missing name is visible rather than silent
   */
  const nameFromLog = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of activity?.entries ?? []) {
      if (e.changed_by && e.changed_by_name) m.set(e.changed_by, e.changed_by_name);
    }
    return m;
  }, [activity]);

  const userName = useMemo(
    () =>
      (uid: string | null): string | null => {
        if (!uid) return null;
        const appUser = appUsers.find((u) => u.user_id === uid);
        const fromApp = displayNameFor(appUser);
        if (fromApp) return fromApp;
        const fromLog = nameFromLog.get(uid);
        if (fromLog && fromLog !== 'Unknown user') return fromLog;
        return uid; // surfaced, not blanked
      },
    [appUsers, nameFromLog],
  );

  /* -- pager ------------------------------------------------------------- */

  const pagerIndex = allReceipts.findIndex((r) => r.id === id);
  const pager =
    pagerIndex >= 0 && allReceipts.length > 0
      ? {
          index: pagerIndex + 1,
          total: allReceipts.length,
          onPrev:
            pagerIndex > 0
              ? () => navigate(`${LIST_PATH}/${allReceipts[pagerIndex - 1].id}`)
              : undefined,
          onNext:
            pagerIndex < allReceipts.length - 1
              ? () => navigate(`${LIST_PATH}/${allReceipts[pagerIndex + 1].id}`)
              : undefined,
        }
      : undefined;

  /* -- chatter ----------------------------------------------------------- */

  const chatterEntries: ChatterEntry[] = useMemo(() => {
    const rows = (activity?.entries ?? []) as ActivityLogEntry[];
    // Oldest-first reads as a history; the RPC returns newest-first.
    return [...rows]
      .sort((a, b) => a.changed_at.localeCompare(b.changed_at))
      .map((e) => {
        /**
         * `note_text` wins over the old/new pair, and not only for manual notes.
         * The QC RPCs log through `log_activity(...)`, which writes
         * action_type = 'status_change' with the human message in `note_text`
         * and old_value/new_value NULL — rendering those as "Status: — → —"
         * silently destroys the only content the row has ("QC batch — 1 passed,
         * 0 failed", "Goods Receipt completed").
         */
        let body: React.ReactNode;
        if (e.note_text) {
          // Manual notes are rich text from the composer; RPC logs are plain.
          body =
            e.action_type === 'manual_note' ? (
              <span dangerouslySetInnerHTML={{ __html: e.note_text }} />
            ) : (
              e.note_text
            );
        } else if (e.action_type === 'created') {
          body = 'Record created';
        } else if (e.old_value != null || e.new_value != null) {
          body = (
            <>
              {e.action_type === 'status_change' ? 'Status' : friendlyField(e.field_name)}:{' '}
              <strong>{e.old_value ?? '—'}</strong> → <strong>{e.new_value ?? '—'}</strong>
            </>
          );
        } else {
          // Nothing to show but the shape of the event — say that, don't blank.
          body = `${friendlyField(e.field_name)} changed`;
        }
        return {
          id: e.id,
          /*
           * `userName` first, not `changed_by_name`: the RPC resolves names from
           * employees.full_name -> email local-part ("vigu0921"), while the
           * app-users edge function has the real display name ("Vignesh").
           * Preferring the RPC here made the same person appear under two names
           * on one screen — Chatter said vigu0921, "Created by" said Vignesh.
           * `userName` already falls back to the log name, then the raw UUID.
           */
          author: userName(e.changed_by) || e.changed_by_name || 'System',
          time: fmtTime(e.changed_at),
          day: dayBucket(e.changed_at),
          kind: e.action_type === 'manual_note' ? 'note' : 'log',
          body,
        } satisfies ChatterEntry;
      });
  }, [activity, userName]);

  /* -- guards ------------------------------------------------------------ */

  if (isLoading) {
    return (
      <AppLayout title="Goods Receipt" moduleNav={INVENTORY_NAV}>
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      </AppLayout>
    );
  }

  // Rule 5 — show the real error text, never a swallowed blank page.
  if (error) {
    return (
      <AppLayout title="Goods Receipt" moduleNav={INVENTORY_NAV}>
        <div className="p-6">
          <div className="rounded border border-destructive/40 bg-destructive/5 p-4">
            <p className="font-semibold text-destructive">Failed to load goods receipt</p>
            <pre className="mt-2 whitespace-pre-wrap text-xs">{String((error as Error).message ?? error)}</pre>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!gr) {
    return (
      <AppLayout title="Goods Receipt" moduleNav={INVENTORY_NAV}>
        <div className="p-6 text-sm text-muted-foreground">
          No goods receipt found for id <code>{id}</code>.
        </div>
      </AppLayout>
    );
  }

  /* -- derived ----------------------------------------------------------- */

  const stage = ribbonStageFor(gr.status);
  const isDone = gr.status === 'completed';
  const isCancelled = gr.status === 'cancelled';
  const isReady = stage === 'ready';

  const operationType = operationTypes.find((t) => t.id === gr.operation_type_id) ?? null;

  /**
   * Odoo's "Receive From" is the partner the goods come from. This schema has no
   * partner link on `goods_receipts` — only `source_type` (every live row is
   * `manual`), an optional `source_document_reference`, and the vendor-side
   * `source_location_id` the operation type stamped on. The source location is
   * the closest true value, so that is what is shown.
   */
  const receiveFrom =
    locationName(gr.source_location_id) ??
    (gr.source_document_reference || STATUS_LABELS[gr.source_type] || gr.source_type);

  const DISABLED_PRINT = 'Printing coming in a later pass';

  /**
   * Three of the four spec'd actions have no backend to call, so they render
   * disabled with the real reason rather than a stub that fakes the write:
   *
   *   Check Availability — no reservation concept exists for receipts.
   *     `reserve_serials` is sales-order-keyed (_so_id) and does not apply.
   *   Validate — completion is driven per-serial by `complete_gr_line_qc`,
   *     which posts the stock ledger. A blanket "Validate" would have to
   *     invent QC results for every serial, or set status='completed'
   *     directly and leave a Done receipt with no moves. Both corrupt data.
   *   Return — `create_return_request` takes p_invoice_id; there is no
   *     goods-receipt return path.
   *
   * Cancel IS wired: it is a plain status write with no ledger consequence.
   */
  const NO_RESERVE =
    'No backend support: goods receipts have no availability/reservation step (reserve_serials is sales-order-only). Needs a backend decision.';
  const NO_VALIDATE =
    'No backend support: completion runs per-serial through complete_gr_line_qc from the scan flow. A blanket Validate would fabricate QC results or post a Done receipt with no stock moves. Needs a backend decision.';
  const NO_RETURN =
    'No backend support: create_return_request is invoice-keyed; there is no goods-receipt return path yet. Needs a backend decision.';

  const cancelTitle = cancelGr.isPending ? 'Cancelling…' : 'Cancel this goods receipt';

  const actions: HeaderAction[] = isReady
    ? [
        { key: 'check', label: 'Check Availability', disabled: true, title: NO_RESERVE },
        { key: 'validate', label: 'Validate', variant: 'primary', disabled: true, title: NO_VALIDATE },
        { key: 'print', label: 'Print', disabled: true, title: DISABLED_PRINT },
        {
          key: 'cancel',
          label: 'Cancel',
          variant: 'danger',
          disabled: cancelGr.isPending,
          title: cancelTitle,
          onClick: () => setConfirmCancel(true),
        },
      ]
    : isDone
      ? [
          { key: 'print', label: 'Print', disabled: true, title: DISABLED_PRINT },
          { key: 'return', label: 'Return', disabled: true, title: NO_RETURN },
        ]
      : [];

  // Traceability mirrors Odoo: it only exists once the receipt is Done.
  const segments: SegmentOption[] = [
    { key: 'details', label: 'Details' },
    { key: 'moves', label: 'Moves' },
    { key: 'barcode', label: 'Barcode' },
    ...(isDone ? [{ key: 'traceability', label: 'Traceability' }] : []),
  ];

  /* -- fields (ALWAYS rendered, Done included) --------------------------- */

  const leftFields: DocumentField[] = [
    { key: 'from', label: 'Receive From', value: receiveFrom || DASH },
    {
      key: 'optype',
      label: 'Operation Type',
      value: operationType?.name ?? (gr.operation_type_id ? gr.operation_type_id : DASH),
      muted: !operationType && !gr.operation_type_id,
    },
    {
      key: 'dest',
      label: 'Destination Location',
      value: locationName(gr.dest_location_id) ?? DASH,
      muted: !gr.dest_location_id,
    },
    { key: 'created', label: 'Created On', value: fmtDate(gr.created_at) ?? DASH },
  ];

  const rightFields: DocumentField[] = [
    {
      key: 'scheduled',
      label: 'Scheduled Date',
      // `goods_receipts` has no scheduled_date column. Say so rather than
      // inventing one or silently rendering a blank.
      value: <span title="goods_receipts has no scheduled_date column">not stored</span>,
      muted: true,
    },
    // Effective Date is a Done-only fact; hidden until then, exactly as specified.
    ...(isDone
      ? [
          {
            key: 'effective',
            label: 'Effective Date',
            value: fmtDate(gr.received_at) ?? DASH,
            muted: !gr.received_at,
          } satisfies DocumentField,
        ]
      : []),
    {
      key: 'srcdoc',
      label: 'Source Document',
      value: gr.source_document_reference ?? DASH,
      muted: !gr.source_document_reference,
    },
    { key: 'by', label: 'Created by', value: userName(gr.created_by) ?? DASH },
  ];

  /* -- tabs -------------------------------------------------------------- */

  const tabs: DocumentTab[] = [
    {
      key: 'operations',
      label: 'Operations',
      badge: lines.length,
      content: (
        <TableShell
          head={['Product', 'Demand', 'Quantity', 'Unit', '']}
          empty="This receipt has no lines."
          isEmpty={lines.length === 0}
          filler={fillerFor(lines.length)}
        >
          {lines.map((l) => (
            <tr key={l.id}>
              <td className={TD}>
                <div className="text-[hsl(var(--ds-ink))]">{l.product_name_cached ?? '—'}</div>
                {l.product_sku_cached && (
                  <div className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                    {l.product_sku_cached}
                  </div>
                )}
              </td>
              <td className={cn(TD, 'tabular-nums')}>{l.expected_quantity}</td>
              <td className={cn(TD, 'tabular-nums')}>{l.received_quantity}</td>
              <td className={TD}>Units</td>
              <td className={cn(TD, 'text-right')}>
                <button
                  type="button"
                  onClick={() => setDetailsLineId(l.id)}
                  className="text-[hsl(var(--ds-link))] hover:underline"
                >
                  Details
                </button>
              </td>
            </tr>
          ))}
        </TableShell>
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
              // Per spec: Responsible is whoever created the receipt.
              { key: 'resp', label: 'Responsible', value: userName(gr.created_by) ?? DASH },
              { key: 'srctype', label: 'Source Type', value: gr.source_type },
            ],
            [
              { key: 'status', label: 'Status', value: STATUS_LABELS[gr.status] ?? gr.status },
              {
                key: 'labels',
                label: 'Labels Generated',
                value: gr.labels_generated ? (fmtDate(gr.labels_generated_at) ?? 'Yes') : 'No',
              },
            ],
          ]}
        />
      ),
    },
    {
      key: 'note',
      label: 'Note',
      content: gr.notes ? (
        <p className="whitespace-pre-wrap text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">
          {gr.notes}
        </p>
      ) : (
        <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-subtle))]">No note.</p>
      ),
    },
  ];

  const detailsLine = lines.find((l) => l.id === detailsLineId) ?? null;

  /* -- render ------------------------------------------------------------ */

  return (
    <AppLayout title={`Goods Receipt ${gr.gr_number}`} moduleNav={INVENTORY_NAV}>
      <div className="ds-root p-3 md:p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0">
            <DocumentHeader
              breadcrumb={['Inventory', 'Goods Receipts', gr.gr_number]}
              title={gr.gr_number}
              actions={actions}
              segments={segments}
              activeSegment={segment}
              onSegmentChange={(k) => {
                // Barcode is not a view here — it hands off to the legacy scan
                // flow, which Pass 3 rebuilds. Nothing about scan is touched.
                if (k === 'barcode') {
                  navigate(BARCODE_PATH);
                  return;
                }
                setSegment(k as 'details' | 'moves' | 'traceability');
              }}
              stages={RIBBON_STAGES}
              // A cancelled receipt matches no stage on purpose; it is announced
              // by the banner below instead.
              currentStage={stage ?? '__none__'}
              pager={pager}
              cog={{
                // Only actions with real backing belong here. Pass 1 has none,
                // so the menu is Print (disabled) and nothing else — no fakes.
                items: [],
                printDisabled: true,
                printDisabledTitle: DISABLED_PRINT,
              }}
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

              {gr.discrepancy_status !== 'matched' && (
                <div className="border-b border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-amber-bg))] px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone="amber">
                      {(gr.discrepancy_status ?? '').replace(/_/g, ' ')}
                    </StatusPill>
                    {gr.discrepancy_approved_at ? (
                      <span className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
                        Approved by {userName(gr.discrepancy_approved_by) ?? '—'} on{' '}
                        {fmtDate(gr.discrepancy_approved_at)}
                      </span>
                    ) : (
                      <span className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
                        Awaiting approval
                      </span>
                    )}
                  </div>
                  {gr.discrepancy_reason && (
                    <p className="mt-1 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">
                      Reason: {gr.discrepancy_reason}
                    </p>
                  )}
                </div>
              )}

              {/*
                The fields render in EVERY state — Done included. This is the
                defect the rebuild exists to fix; do not gate this on status.
              */}
              <DocumentFields columns={[leftFields, rightFields]} />

              {segment === 'details' && <DocumentTabs tabs={tabs} />}

              {segment === 'moves' && (
                <div className="border-t border-[hsl(var(--ds-border))] p-3">
                  <TableShell
                    head={['Product', 'Serial', 'From', 'To', 'Qty', 'Date']}
                    empty="No stock moves yet. Moves are written when QC passes a serial."
                    isEmpty={moves.length === 0}
                    filler={fillerFor(moves.length)}
                  >
                    {moves.map((m) => (
                      <tr key={m.line_id}>
                        <td className={TD}>
                          <div>{m.product_name ?? '—'}</div>
                          {m.product_sku && (
                            <div className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                              {m.product_sku}
                            </div>
                          )}
                        </td>
                        <td className={cn(TD, 'font-mono text-[var(--ds-fs-xs)]')}>
                          {m.serial_numbers.join(', ') || DASH}
                        </td>
                        <td className={TD}>{m.source_location_name ?? DASH}</td>
                        <td className={TD}>{m.destination_location_name ?? DASH}</td>
                        <td className={cn(TD, 'tabular-nums')}>{m.done_qty}</td>
                        <td className={TD}>{fmtDate(m.scheduled_date) ?? DASH}</td>
                      </tr>
                    ))}
                  </TableShell>
                </div>
              )}

              {segment === 'traceability' && (
                <div className="border-t border-[hsl(var(--ds-border))] p-3">
                  <TableShell
                    head={['Reference', 'Product', 'Date', 'Lot/Serial', 'From', 'To', 'Quantity']}
                    empty="Nothing to trace for this receipt."
                    isEmpty={moves.length === 0}
                    filler={fillerFor(moves.length)}
                  >
                    {moves.map((m) => (
                      <tr key={m.line_id}>
                        <td className={cn(TD, 'font-mono text-[var(--ds-fs-xs)]')}>
                          {m.reference ?? DASH}
                        </td>
                        <td className={TD}>{m.product_name ?? DASH}</td>
                        <td className={TD}>{fmtDate(m.scheduled_date) ?? DASH}</td>
                        <td className={cn(TD, 'font-mono text-[var(--ds-fs-xs)]')}>
                          {m.serial_numbers.join(', ') || DASH}
                        </td>
                        <td className={TD}>{m.source_location_name ?? DASH}</td>
                        <td className={TD}>{m.destination_location_name ?? DASH}</td>
                        <td className={cn(TD, 'tabular-nums')}>{m.done_qty}</td>
                      </tr>
                    ))}
                  </TableShell>
                </div>
              )}
            </div>
          </div>

          {/* right rail — real activity_log, keyed record_type + record_id */}
          <Chatter entries={chatterEntries} followers={0} className="self-start" />
        </div>
      </div>

      {detailsLine && (
        <DetailedOperationsModal
          line={detailsLine}
          serials={serials.filter((s) => s.goods_receipt_line_id === detailsLine.id)}
          locationName={locationName}
          onClose={() => setDetailsLineId(null)}
        />
      )}

      {confirmCancel && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Cancel goods receipt"
          /* `ds-root` repeated — see the note in DetailedOperationsModal. */
          className="ds-root fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
          onClick={() => !cancelGr.isPending && setConfirmCancel(false)}
        >
          <div
            className={cn(
              'w-full max-w-md',
              'bg-[hsl(var(--ds-surface))] border border-[hsl(var(--ds-border))]',
              'rounded-[var(--ds-radius)] shadow-[var(--ds-shadow-pop)] p-4',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[var(--ds-fs-md)] font-semibold text-[hsl(var(--ds-ink))]">
              Cancel {gr.gr_number}?
            </h2>
            <p className="mt-1 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
              The receipt moves to <strong>Cancelled</strong> and leaves the Draft › Ready ›
              Done flow. No stock moves are written or reversed.
            </p>

            {/* Rule 5 — the Postgres/RPC message verbatim, never swallowed. */}
            {cancelGr.error && (
              <div className="mt-3 rounded border border-destructive/40 bg-destructive/5 p-2">
                <pre className="whitespace-pre-wrap text-xs text-destructive">
                  {String((cancelGr.error as Error).message ?? cancelGr.error)}
                </pre>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button
                size="sm"
                variant="subtle"
                disabled={cancelGr.isPending}
                onClick={() => setConfirmCancel(false)}
              >
                Keep it
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={cancelGr.isPending}
                onClick={() =>
                  cancelGr.mutate(undefined, { onSuccess: () => setConfirmCancel(false) })
                }
              >
                {cancelGr.isPending ? 'Cancelling…' : 'Cancel receipt'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

/*
 * TODO (retire dead code, not this pass): `src/lib/services/qc/api.ts:78` inserts
 * into `goods_receipt_qc`, a table that DOES NOT EXIST in any schema — the call
 * throws at runtime. This page deliberately reads QC from
 * `goods_receipt_serials` instead and never touches that path. See
 * docs/REBUILD_MAP.md "goods_receipt_qc and delivery_qc tables" for the full
 * six-call-site inventory; archive them when Inventory is signed off (rule 4).
 */
