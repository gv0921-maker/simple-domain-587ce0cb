/**
 * Inventory 2 — the dedicated barcode screen. Route: /inventory2/barcode
 *
 * Odoo-style: pick an open document, then scan into it. Full-bleed and dark-
 * chromed once scanning starts, because this is used at the delivery bay at
 * arm's length and one-handed, not at a desk.
 *
 * WHAT IS RECEIPT-SPECIFIC HERE: the adapter, and the two words in the picker.
 * Everything else — resolution, line selection, the over-receipt gate, the
 * session feed, validate — runs off `ScanDocument`, which is built from
 * inv_operation / inv_move / inv_move_line and knows nothing about receipts.
 *
 * SCAN FLAGS ARE UI POLICY. mandatory_scan_product, mandatory_scan_serial,
 * mandatory_scan_dest_location and allow_extra_products are read from
 * inv_operation_type and enforced here, in the browser. Pass 7 Part A confirmed
 * none of them is enforced by the database: it will accept a unit that was
 * never scanned, and it will accept more units than were ordered. This screen
 * being strict is a promise the screen makes, not a guarantee the data carries.
 *
 * OFFLINE: not supported, deliberately. Connection state is shown prominently
 * and every scan is a live RPC round trip carrying its own pending/confirmed/
 * failed state. Nothing is queued for later — a failed scan stays on screen
 * with the database's own words and a retry the operator presses.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Loader2, PackageCheck, Wifi, WifiOff } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY2_NAV } from '@/lib/navigation';
import { Button, cn } from '@/design-system';
import '@/design-system/tokens.css';
import { ScanCapture } from '@/components/inventory2/ScanCapture';
import { ScanFeed, type ScanEvent, type ScanPhase } from '@/components/inventory2/ScanFeed';
import { ErrorBanner, TextInput } from '@/components/inventory2/formControls';
import { errorText } from '@/lib/inventory2/errorText';
import {
  useCommitUnit, useCompleteScanDocument, useOpenScanDocuments, useScanDocument,
} from '@/hooks/inventory2/scan';
import { resolveScan, type ScanDocLine } from '@/lib/services/inventory2/scan';
import { RECEIPT_SCAN_ADAPTER } from '@/lib/services/inventory2/scanReceipt';

/** Pass 7 builds the receipt case. The picker and adapter are the only spots
 *  that name a kind; both move together when the next adapter lands. */
const ADAPTER = RECEIPT_SCAN_ADAPTER;

let seq = 0;
const nextId = () => `scan-${Date.now()}-${seq++}`;

function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/* ------------------------------------------------------------- the picker */

function DocumentPicker() {
  const navigate = useNavigate();
  const { data: docs = [], isLoading, error } = useOpenScanDocuments(ADAPTER.kind);

  return (
    <AppLayout title="Barcode" moduleNav={INVENTORY2_NAV}>
      <div className="ds-root p-3 md:p-4">
        <h1 className="text-[var(--ds-fs-lg)] font-semibold text-[hsl(var(--ds-ink))]">
          Scan into a {ADAPTER.documentNoun}
        </h1>
        <p className="mt-1 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
          Pick the document you are working, then scan units into it. Only open
          {' '}{ADAPTER.documentNoun}s are listed — a validated one cannot take further units.
        </p>

        {error && (
          <div className="mt-3">
            <ErrorBanner title="Failed to load open documents" message={errorText(error)} />
          </div>
        )}

        {isLoading ? (
          <div className="p-6 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">Loading…</div>
        ) : docs.length === 0 ? (
          <div className="mt-4 rounded-[var(--ds-radius)] border border-dashed border-[hsl(var(--ds-border-strong))] p-6 text-center">
            <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
              No open {ADAPTER.documentNoun}s. Create one first.
            </p>
            <Button className="mt-3" onClick={() => navigate('/inventory2/receipts/new')}>
              New receipt
            </Button>
          </div>
        ) : (
          <ul className="mt-4 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2">
            {docs.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/inventory2/barcode?receipt=${d.id}`)}
                  className={cn(
                    'w-full rounded-[var(--ds-radius)] border p-3 text-left transition-colors',
                    'border-[hsl(var(--ds-border-strong))] bg-[hsl(var(--ds-surface))]',
                    'hover:border-[hsl(var(--ds-primary))] hover:bg-[hsl(var(--ds-primary)/0.04)]',
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[var(--ds-fs-base)] font-bold text-[hsl(var(--ds-ink))]">
                      {d.number}
                    </span>
                    <span className="text-[var(--ds-fs-xs)] uppercase tracking-wide text-[hsl(var(--ds-ink-subtle))]">
                      {d.state}
                    </span>
                  </div>
                  <div className="mt-1 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
                    {d.vendor_name ?? d.type_name}
                    {d.dest_location_name && ` → ${d.dest_location_name}`}
                  </div>
                  <div className="mt-2 text-[var(--ds-fs-sm)] tabular-nums text-[hsl(var(--ds-ink))]">
                    <strong className="text-[18px]">{d.received_qty}</strong>
                    <span className="text-[hsl(var(--ds-ink-subtle))]"> / {d.demand_qty} units</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppLayout>
  );
}

/* ------------------------------------------------------------ the scanner */

interface OverReceipt {
  code: string;
  line: ScanDocLine;
  nextCount: number;
}

function Scanner({ operationId }: { operationId: string }) {
  const navigate = useNavigate();
  const online = useOnline();
  const { data: doc, isLoading, error, refetch } = useScanDocument(operationId);
  const commit = useCommitUnit(ADAPTER, operationId);
  const complete = useCompleteScanDocument(ADAPTER, operationId);

  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [activeMoveId, setActiveMoveId] = useState<string | null>(null);
  const [cost, setCost] = useState('0');
  const [overReceipt, setOverReceipt] = useState<OverReceipt | null>(null);
  const [confirmValidate, setConfirmValidate] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);
  /** Honours mandatory_scan_dest_location without inventing a fourth scan
   *  target: the operator confirms the destination before units are accepted. */
  const [destAck, setDestAck] = useState(false);

  const costRef = useRef(cost);
  costRef.current = cost;

  const push = useCallback((phase: ScanPhase, code: string, message: string, retry?: ScanEvent['retry']) => {
    const id = nextId();
    setEvents((prev) => [{ id, code, phase, message, at: Date.now(), retry }, ...prev].slice(0, 100));
    return id;
  }, []);

  const settle = useCallback((id: string, phase: ScanPhase, message: string, retry?: ScanEvent['retry']) => {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, phase, message, retry } : e)));
  }, []);

  const refuseReason = doc ? ADAPTER.refuseScanReason(doc) : null;
  const needsDestAck = !!doc?.flags.mandatory_scan_dest_location && !destAck;

  const activeLine = useMemo(
    () => doc?.lines.find((l) => l.move_id === activeMoveId) ?? null,
    [doc, activeMoveId],
  );

  // A single-line document has nothing to choose; pre-select it unless the
  // operation type insists the product is scanned first.
  useEffect(() => {
    if (!doc || activeMoveId) return;
    if (doc.flags.mandatory_scan_product) return;
    if (doc.lines.length === 1) setActiveMoveId(doc.lines[0].move_id);
  }, [doc, activeMoveId]);

  /* -- committing one unit ---------------------------------------------- */

  const commitUnit = useCallback(async (
    line: ScanDocLine,
    serial: string,
    eventId?: string,
  ) => {
    const id = eventId ?? push('pending', serial, `Receiving onto ${line.product_name}…`);
    if (eventId) settle(eventId, 'pending', `Retrying ${serial}…`, undefined);
    const unitCost = Number(costRef.current) || 0;
    try {
      await commit.mutateAsync({
        moveId: line.move_id,
        serial,
        cost: unitCost,
        // Receipts create the unit, so there is no existing unit to assert a
        // location for. A transfer/delivery adapter passes unitRef(resolved)
        // here — the unit's OWN location, never the operation's source.
        existing: null,
      });
      settle(id, 'confirmed', `${serial} received onto ${line.product_name}.`);
      await refetch();
    } catch (e) {
      // Verbatim (Rule 5). These RPCs raise sentences meant to be read.
      settle(id, 'failed', errorText(e), { moveId: line.move_id, serial, cost: unitCost });
    }
  }, [commit, push, settle, refetch]);

  /* -- the scan handler -------------------------------------------------- */

  const chain = useRef<Promise<void>>(Promise.resolve());

  const handleScan = useCallback((raw: string) => {
    // Serialised: a handheld can fire faster than a round trip, and two scans
    // racing would both read the same received count and both slip past the
    // over-receipt gate.
    chain.current = chain.current.then(async () => {
      const code = raw.trim();
      if (!code || !doc) return;

      let resolution;
      try {
        resolution = await resolveScan(code);
      } catch (e) {
        push('failed', code, errorText(e));
        return;
      }

      if (resolution.kind === 'empty') return;

      /* product → select the line */
      if (resolution.kind === 'product') {
        const line = doc.lines.find((l) => l.product_id === resolution.product_id);
        if (line) {
          setActiveMoveId(line.move_id);
          push('info', code,
            `Line selected: ${line.product_name} (matched on ${resolution.matched}). ${line.received_qty} of ${line.demand_qty} received. Scan each unit's serial now.`);
          return;
        }
        push('failed', code, doc.flags.allow_extra_products
          ? `${resolution.product_name} is not on ${doc.number}. This ${ADAPTER.documentNoun} allows extra products, but the line must be added on the receipt page first — the scan screen does not create lines.`
          : `${resolution.product_name} is not on ${doc.number}, and this operation type does not allow extra products (allow_extra_products is off).`);
        return;
      }

      /* an existing unit → either a re-scan of ours, or a foreign serial */
      if (resolution.kind === 'unit') {
        const mine = doc.units.find((u) => u.stock_item_id === resolution.stock_item_id);
        if (mine) {
          const line = doc.lines.find((l) => l.move_id === mine.move_id);
          push('duplicate', code,
            `${resolution.serial} is already on ${doc.number}${line ? ` against ${line.product_name}` : ''}. No second unit was created — the database treats a re-scan of the same serial as the same unit.`);
          return;
        }
        // Belongs to another document. Let the database refuse it and show its
        // own words: it explains the rule better than a paraphrase would.
      }

      /* a serial to receive */
      if (needsDestAck) {
        push('failed', code,
          `This operation type sets mandatory_scan_dest_location. Confirm the destination (${doc.dest_location_name ?? '—'}) before scanning units.`);
        return;
      }

      let line = activeLine;
      if (!line) {
        if (doc.flags.mandatory_scan_product) {
          push('failed', code,
            `No line selected. This operation type sets mandatory_scan_product, so scan the product barcode before its serials.`);
          return;
        }
        if (doc.lines.length === 1) {
          line = doc.lines[0];
          setActiveMoveId(line.move_id);
        } else {
          push('failed', code, 'No line selected. Scan the product barcode first, or tap a line.');
          return;
        }
      }

      const nextCount = line.received_qty + 1;
      if (nextCount > line.demand_qty) {
        // Never silently accepted, never hard-blocked. The operator decides,
        // with the numbers stated plainly.
        setOverReceipt({ code, line, nextCount });
        return;
      }

      await commitUnit(line, code);
    });
  }, [doc, activeLine, needsDestAck, push, commitUnit]);

  const onRetry = useCallback((event: ScanEvent, serial: string) => {
    if (!doc || !event.retry || !serial) return;
    const line = doc.lines.find((l) => l.move_id === event.retry!.moveId);
    if (!line) return;
    chain.current = chain.current.then(() => commitUnit(line, serial, event.id));
  }, [doc, commitUnit]);

  const onDismiss = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  /* -- validate ---------------------------------------------------------- */

  async function onValidate() {
    setValidateError(null);
    try {
      await complete.mutateAsync();
      setConfirmValidate(false);
      await refetch();
      push('info', doc?.number ?? '', `${doc?.number} validated.`);
    } catch (e) {
      setValidateError(errorText(e));
    }
  }

  /* -- render ------------------------------------------------------------ */

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[hsl(var(--ds-navy))] text-white">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="ds-root min-h-screen bg-[hsl(var(--ds-surface))] p-4">
        <ErrorBanner
          title="Could not open this document"
          message={error ? errorText(error) : `Operation ${operationId} was not found.`}
        />
        <Button className="mt-3" variant="outline" onClick={() => navigate('/inventory2/barcode')}>
          Back to the list
        </Button>
      </div>
    );
  }

  const totalDemand = doc.lines.reduce((s, l) => s + l.demand_qty, 0);
  const totalReceived = doc.lines.reduce((s, l) => s + l.received_qty, 0);
  const linesDone = doc.lines.filter((l) => l.received_qty >= l.demand_qty).length;
  const blocked = !!refuseReason || !!overReceipt || confirmValidate;

  const hint = refuseReason
    ? 'Scanning is closed on this document'
    : overReceipt
      ? 'Confirm the extra unit to continue'
      : needsDestAck
        ? 'Confirm the destination to begin'
        : activeLine
          ? `Scan a serial for ${activeLine.product_name}`
          : 'Scan a product barcode';

  return (
    <div className="ds-root flex min-h-screen flex-col" style={{ background: 'hsl(var(--ds-navy))' }}>
      {/* ---- dark header ---- */}
      <div
        className="flex shrink-0 items-center gap-2 px-2.5 py-2.5 text-[hsl(var(--ds-navy-fg))]"
        style={{ background: 'hsl(var(--ds-navy-soft))' }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate('/inventory2/barcode')}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--ds-radius)] hover:bg-white/10"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold leading-tight">{doc.number}</div>
          <div className="truncate text-[var(--ds-fs-xs)] leading-tight text-white/55">
            {doc.vendor_name ?? doc.type_name}
            {doc.dest_location_name && ` → ${doc.dest_location_name}`}
          </div>
        </div>

        {/* Connection state, prominent: this screen has no offline mode. */}
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-[var(--ds-radius-pill)] px-2.5 py-1',
            'text-[var(--ds-fs-xs)] font-bold uppercase tracking-wide',
            online ? 'bg-white/10 text-white/75' : 'bg-[hsl(var(--ds-red))] text-white',
          )}
        >
          {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {online ? 'Online' : 'Offline'}
        </span>

        <span className="shrink-0 rounded-[var(--ds-radius-pill)] bg-white/10 px-2.5 py-1 text-[var(--ds-fs-xs)] font-bold tabular-nums text-white/80">
          {linesDone}/{doc.lines.length}
        </span>
      </div>

      {!online && (
        <div className="shrink-0 bg-[hsl(var(--ds-red))] px-3 py-2 text-center text-[var(--ds-fs-sm)] font-semibold text-white">
          No connection. Scans cannot be sent and nothing is queued — wait for the
          connection to return, then scan again.
        </div>
      )}

      {refuseReason && (
        <div className="shrink-0 bg-[hsl(var(--ds-amber))] px-3 py-2.5 text-center text-[var(--ds-fs-sm)] font-semibold text-white">
          {refuseReason}
        </div>
      )}

      <ScanCapture onScan={handleScan} enabled={!blocked && online} hint={hint} />

      {/* ---- destination acknowledgement (mandatory_scan_dest_location) ---- */}
      {needsDestAck && !refuseReason && (
        <div className="shrink-0 border-b border-white/10 bg-[hsl(var(--ds-navy))] px-3 py-3">
          <p className="text-[var(--ds-fs-sm)] text-white/80">
            This operation type requires the destination to be confirmed before units are
            scanned.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded-[var(--ds-radius)] bg-white/10 px-2.5 py-1.5 text-[var(--ds-fs-sm)] font-semibold text-white">
              {doc.dest_location_name ?? '—'}
            </span>
            <button
              type="button"
              onClick={() => setDestAck(true)}
              className="h-10 rounded-[var(--ds-radius)] bg-[hsl(var(--ds-primary))] px-4 text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-primary-fg))]"
            >
              Confirm destination
            </button>
          </div>
        </div>
      )}

      {/* ---- body: lines + feed ---- */}
      <div className="flex min-h-0 flex-1 flex-col bg-[hsl(var(--ds-surface))] lg:flex-row">
        <div className="min-h-0 flex-1 overflow-y-auto lg:border-r lg:border-[hsl(var(--ds-border))]">
          <ul className="m-0 list-none p-0">
            {doc.lines.map((l) => {
              const complete_ = l.received_qty >= l.demand_qty && l.demand_qty > 0;
              const over = l.received_qty > l.demand_qty;
              const active = l.move_id === activeMoveId;
              return (
                <li key={l.move_id}>
                  <button
                    type="button"
                    onClick={() => setActiveMoveId(l.move_id)}
                    className={cn(
                      'flex w-full items-center gap-3 border-b px-3 py-4 text-left transition-colors',
                      'border-[hsl(var(--ds-border))]',
                      active
                        ? 'bg-[hsl(var(--ds-primary)/0.10)] shadow-[inset_4px_0_0_0_hsl(var(--ds-primary))]'
                        : complete_
                          ? 'bg-[hsl(var(--ds-green-bg)/0.45)]'
                          : 'bg-[hsl(var(--ds-surface))]',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[17px] font-bold text-[hsl(var(--ds-ink))]">
                        {l.product_name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
                        {l.product_barcode && (
                          <span className="font-mono">{l.product_barcode}</span>
                        )}
                        {l.product_sku && l.product_sku !== l.product_barcode && (
                          <span className="font-mono">{l.product_sku}</span>
                        )}
                      </div>
                      {/* Destination per line. */}
                      <div className="mt-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                        To {doc.dest_location_name ?? '—'}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-baseline gap-1 tabular-nums">
                      <span
                        className={cn(
                          'text-[30px] font-bold leading-none',
                          over
                            ? 'text-[hsl(var(--ds-red))]'
                            : complete_
                              ? 'text-[hsl(var(--ds-green))]'
                              : 'text-[hsl(var(--ds-ink))]',
                        )}
                      >
                        {l.received_qty}
                      </span>
                      <span className="text-[var(--ds-fs-sm)] font-medium text-[hsl(var(--ds-ink-subtle))]">
                        / {l.demand_qty}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="px-3 py-3 text-[var(--ds-fs-xs)] leading-relaxed text-[hsl(var(--ds-ink-subtle))]">
            Units land <strong>quarantined</strong> and are not sellable until they pass QC.
            Scan rules on this screen come from the operation type
            ({doc.type_name}); the database does not enforce them.
          </div>
        </div>

        <div className="flex min-h-0 w-full flex-col border-t border-[hsl(var(--ds-border))] lg:w-[380px] lg:border-t-0 xl:w-[420px]">
          <div className="flex items-center gap-2 border-b border-[hsl(var(--ds-border))] px-3 py-2">
            <label htmlFor="scan-cost" className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
              Unit cost
            </label>
            <div className="w-[120px]">
              <TextInput
                id="scan-cost"
                type="number"
                min="0"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </div>
            <span className="ml-auto text-[var(--ds-fs-sm)] tabular-nums text-[hsl(var(--ds-ink-muted))]">
              {totalReceived} / {totalDemand} units
            </span>
          </div>

          <ScanFeed events={events} onRetry={onRetry} onDismiss={onDismiss} />
        </div>
      </div>

      {/* ---- over-receipt confirmation ---- */}
      {overReceipt && (
        <div className="shrink-0 border-t-2 border-[hsl(var(--ds-amber))] bg-[hsl(var(--ds-amber-bg))] p-3">
          <p className="text-[16px] font-bold text-[hsl(var(--ds-ink))]">
            This is unit {overReceipt.nextCount} of {overReceipt.line.demand_qty} ordered
            {' '}— confirm?
          </p>
          <p className="mt-1 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">
            <span className="font-mono font-semibold">{overReceipt.code}</span> would take
            {' '}{overReceipt.line.product_name} past its ordered quantity. The extra unit is
            recorded either way — the database does not block over-receipt.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                const { line, code } = overReceipt;
                setOverReceipt(null);
                chain.current = chain.current.then(() => commitUnit(line, code));
              }}
              className="h-12 flex-1 rounded-[var(--ds-radius)] bg-[hsl(var(--ds-amber))] text-[15px] font-bold text-white"
            >
              Receive it anyway
            </button>
            <button
              type="button"
              onClick={() => {
                push('info', overReceipt.code,
                  `Not received. ${overReceipt.line.product_name} stays at ${overReceipt.line.received_qty} of ${overReceipt.line.demand_qty}.`);
                setOverReceipt(null);
              }}
              className="h-12 flex-1 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))] bg-[hsl(var(--ds-surface))] text-[15px] font-semibold text-[hsl(var(--ds-ink))]"
            >
              Skip this unit
            </button>
          </div>
        </div>
      )}

      {/* ---- validate ---- */}
      <div className="shrink-0 p-2" style={{ background: 'hsl(var(--ds-navy))' }}>
        {validateError && (
          <div className="mb-2">
            <ErrorBanner
              title={`Could not validate ${doc.number}`}
              message={validateError}
              onDismiss={() => setValidateError(null)}
            />
          </div>
        )}

        {confirmValidate ? (
          <div className="rounded-[var(--ds-radius)] bg-[hsl(var(--ds-surface))] p-3">
            <p className="text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
              Validate {doc.number} with {totalReceived} of {totalDemand} units received?
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onValidate}
                disabled={complete.isPending}
                className="h-12 flex-1 rounded-[var(--ds-radius)] bg-[hsl(var(--ds-primary))] text-[15px] font-bold text-[hsl(var(--ds-primary-fg))] disabled:opacity-50"
              >
                {complete.isPending ? 'Validating…' : 'Yes, validate'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmValidate(false)}
                className="h-12 flex-1 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))] text-[15px] font-semibold text-[hsl(var(--ds-ink))]"
              >
                Keep scanning
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setValidateError(null); setConfirmValidate(true); }}
            disabled={!!refuseReason || !online}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-[var(--ds-radius)] py-4',
              'text-[16px] font-bold',
              'bg-[hsl(var(--ds-primary))] text-[hsl(var(--ds-primary-fg))]',
              'hover:bg-[hsl(var(--ds-primary-hover))] active:bg-[hsl(var(--ds-primary-active))]',
              'disabled:opacity-40',
            )}
          >
            <PackageCheck className="h-5 w-5" />
            Validate
          </button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- the route */

export default function BarcodeScan() {
  const [params] = useSearchParams();
  const operationId = params.get('receipt');
  return operationId ? <Scanner operationId={operationId} /> : <DocumentPicker />;
}
