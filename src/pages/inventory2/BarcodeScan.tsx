/**
 * Inventory 2 — the dedicated barcode screen. Route: /inventory2/barcode
 *
 * Odoo-style: pick an open document, then scan into it. Full-bleed and dark-
 * chromed once scanning starts, because this is used at the delivery bay at
 * arm's length and one-handed, not at a desk.
 *
 * NOTHING ON THIS SCREEN IS RECEIPT-SPECIFIC ANY MORE. It used to open with
 * `const ADAPTER = RECEIPT_SCAN_ADAPTER` and a comment promising the constant
 * would move when a second adapter landed. It has moved: the adapter is looked
 * up from `SCAN_ADAPTERS` by the loaded document's OWN kind, and every
 * kind-specific word on screen — the noun, the past-tense verb, whether a unit
 * cost is captured — comes off that adapter.
 *
 * THE KIND COMES FROM THE DOCUMENT, NEVER FROM THE URL. `getScanDocument()`
 * reads inv_operation_type.kind. A query parameter could be stale or
 * hand-edited, and choosing an adapter from one would mean calling the wrong
 * RPC against a real document — inv_receive_serial on a delivery would INVENT
 * units on a document meant to ship them out.
 *
 * SCAN FLAGS ARE UI POLICY. mandatory_scan_product, mandatory_scan_serial,
 * mandatory_scan_dest_location and allow_extra_products are read from
 * inv_operation_type and enforced here, in the browser. Pass 7 Part A confirmed
 * none of them is enforced by the database: it will accept a unit that was
 * never scanned, and it will accept more units than were ordered. This screen
 * being strict is a promise the screen makes, not a guarantee the data carries.
 *
 * THE DESTINATION IS THIS SCREEN'S RESPONSIBILITY. inv_transfer_stock_item
 * asserts where a unit came FROM and takes where it is going TO on trust — see
 * CLAUDE.md. `commitUnit` therefore lists the destination in its dependency
 * array, and that is load-bearing, not tidiness.
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
import {
  resolveScan, unitRef,
  type ResolvedUnit,
  type ScanAdapter, type ScanDocKind, type ScanDocLine, type ScanDocument,
  type ScannedUnitRef,
} from '@/lib/services/inventory2/scan';
import {
  SCAN_ADAPTERS, SCANNABLE_KINDS, adapterFor, unsupportedKindReason,
} from '@/lib/services/inventory2/scanAdapters';

/**
 * Where a new document of each kind is created.
 *
 * Routes are a page concern, so they live here rather than on the service-layer
 * adapter. A kind with no entry simply gets no button — the empty state still
 * explains itself, which is better than a link to a route that does not exist.
 */
const NEW_DOCUMENT_PATH: Partial<Record<ScanDocKind, string>> = {
  receipt: '/inventory2/receipts/new',
  internal: '/inventory2/transfers/new',
  outgoing: '/inventory2/deliveries/new',
};

/** The scan screen's own URL for a document. */
const scanPath = (operationId: string) => `/inventory2/barcode?operation=${operationId}`;

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

/**
 * One section of the picker: the open documents of a single kind.
 *
 * Rendered once per registered adapter. The list of adapters is a module-level
 * constant, so the number and order of these components — and therefore of the
 * hooks inside them — is fixed for the life of the page.
 */
function KindSection({ adapter }: { adapter: ScanAdapter }) {
  const navigate = useNavigate();
  const { data: docs = [], isLoading, error } = useOpenScanDocuments(adapter.kind);
  const newPath = NEW_DOCUMENT_PATH[adapter.kind];

  return (
    <section className="mt-5 first:mt-4">
      <h2 className="text-[var(--ds-fs-base)] font-semibold capitalize text-[hsl(var(--ds-ink))]">
        {adapter.documentNoun}s
      </h2>

      {error && (
        <div className="mt-2">
          <ErrorBanner
            title={`Failed to load open ${adapter.documentNoun}s`}
            message={errorText(error)}
          />
        </div>
      )}

      {isLoading ? (
        <div className="py-4 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">Loading…</div>
      ) : docs.length === 0 ? (
        <div className="mt-2 rounded-[var(--ds-radius)] border border-dashed border-[hsl(var(--ds-border-strong))] p-5 text-center">
          <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
            No open {adapter.documentNoun}s. Create one first.
          </p>
          {newPath && (
            <Button className="mt-3" onClick={() => navigate(newPath)}>
              New {adapter.documentNoun}
            </Button>
          )}
        </div>
      ) : (
        <ul className="mt-2 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2">
          {docs.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => navigate(scanPath(d.id))}
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
    </section>
  );
}

function DocumentPicker() {
  return (
    <AppLayout title="Barcode" moduleNav={INVENTORY2_NAV}>
      <div className="ds-root p-3 md:p-4">
        <h1 className="text-[var(--ds-fs-lg)] font-semibold text-[hsl(var(--ds-ink))]">
          Scan into a document
        </h1>
        <p className="mt-1 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
          Pick the document you are working, then scan units into it. Only open documents are
          listed — a validated one cannot take further units.
        </p>

        {SCANNABLE_KINDS.map((kind) => {
          const adapter = SCAN_ADAPTERS[kind];
          return adapter ? <KindSection key={kind} adapter={adapter} /> : null;
        })}
      </div>
    </AppLayout>
  );
}

/* ------------------------------------------------------- the route refusal */

/**
 * Why this unit cannot be scanned onto this document, or null to proceed.
 *
 * ── THIS IS A MESSAGE, NOT THE ENFORCEMENT ────────────────────────────────
 * THE SERVER IS THE AUTHORITY, and it is not this function.
 * `inv_transfer_stock_item` calls `inv_route_is_legal` at the single choke
 * point that writes `inv_stock_item.location_id` and `inv_stock_tracking`, and
 * it refuses there whatever this screen decides. Route enforcement does not
 * depend on this code running, or on it being right.
 *
 * What this buys is WHEN the operator finds out: at the bay, holding the unit,
 * with the remedy in the sentence — instead of after a round trip. That is the
 * entire value, and it is a real one, but it is presentation.
 *
 * DO NOT "optimise" by trusting a pass here. Specifically: do not skip the
 * server call because this returned null, and do not weaken the server check
 * because the screen now filters. `doc` is a cached snapshot — a session left
 * open for an hour holds an hour-old allowed-set, and the unit may have moved
 * since it was fetched. Only the server reads the unit at the moment it moves.
 *
 * ── IT MUST NEVER BE NARROWER THAN THE SERVER ─────────────────────────────
 * `allowed_from_location_ids` is a deliberate SUPERSET of what
 * `inv_route_is_legal` permits (the authority is a pair check over both ends of
 * the move; a flat set cannot express a pair). The asymmetry is safe in exactly
 * one direction — too generous means a late refusal, too narrow means a LAWFUL
 * unit refused at the bay with no way past it. Hence the empty-set rule below,
 * and hence the membership test being nothing but a membership test.
 *
 * NO HIERARCHY WALK HAPPENS HERE. `inv_location_ancestors` is the single
 * definition of containment and the set already has it applied — GODOWN is a
 * child of STOCK, so a STOCK-sourced document's set contains GODOWN outright.
 * Re-deriving that client-side would be a second definition, and two
 * definitions of containment is how they start disagreeing.
 */
function routeRefusal(doc: ScanDocument, unit: ResolvedUnit): string | null {
  /*
   * AN EMPTY SET IS "NO OPINION", NOT "NOTHING IS ALLOWED".
   *
   * The set comes back empty when the document has no source location, and
   * refusing every unit on that basis would make the screen NARROWER than the
   * server — the one direction this design forbids. Falling through costs a
   * late message on a misconfigured document; refusing would strand an
   * operator at the bay with no way past it.
   */
  if (doc.allowed_from_location_ids.length === 0) return null;
  if (doc.allowed_from_location_ids.includes(unit.location_id)) return null;

  const from = unit.location_name ?? 'an unknown location';
  const source = doc.source_location_name ?? 'its source location';
  return (
    `${unit.serial} is in ${from}. ${doc.number} moves stock from ${source}. ` +
    `Nothing has been recorded. ` +
    `Transfer the unit to ${source} first, then scan it here.`
  );
}

/* ------------------------------------------------------------ the scanner */

/** A unit already in stock, as an adapter needs it. */
type ExistingUnit = ScannedUnitRef;

interface OverScan {
  code: string;
  line: ScanDocLine;
  nextCount: number;
  /**
   * The unit as it resolved a moment ago, carried rather than re-resolved.
   * The operator confirmed the unit they were shown; re-running resolveScan on
   * confirm could return a different answer if the unit moved in between.
   */
  existing: ExistingUnit | null;
}

/**
 * A unit whose CONDITION the adapter wants confirmed before it is committed.
 *
 * Deliberately a separate gate from `OverScan` rather than a shared "pending
 * confirmation" object. They ask different questions — over-receipt is about
 * the LINE's count, this is about the UNIT's fitness — and a unit can trip both
 * on the same scan. Merging them would silently drop one of the two questions,
 * and it would be the condition one, because the count is checked last.
 */
interface ConditionWarn {
  code: string;
  line: ScanDocLine;
  message: string;
  existing: ExistingUnit;
  /**
   * Set when the warning came from a RETRY, so the confirm resumes that event
   * row instead of opening a new one.
   *
   * The retry path needs this gate as much as the first scan does, and the
   * reason is easy to miss: the retry row lets the operator CORRECT the serial,
   * so what gets re-resolved may be a different unit in a different condition
   * from the one that originally failed.
   */
  eventId?: string;
}

/**
 * The scanning session for ONE document, with its adapter already resolved.
 *
 * Split out from the loader below so the adapter is a prop rather than
 * something guessed before the document arrives: the mutations here are built
 * from it, and building them from a placeholder would mean the first render
 * held a mutation pointed at the wrong RPC.
 */
function ScanSession({
  doc, adapter, operationId, refetch,
}: {
  doc: ScanDocument;
  adapter: ScanAdapter;
  operationId: string;
  refetch: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const online = useOnline();
  const commit = useCommitUnit(adapter, operationId);
  const complete = useCompleteScanDocument(adapter, operationId);

  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [activeMoveId, setActiveMoveId] = useState<string | null>(null);
  const [cost, setCost] = useState('0');
  const [overScan, setOverScan] = useState<OverScan | null>(null);
  const [conditionWarn, setConditionWarn] = useState<ConditionWarn | null>(null);
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

  const refuseReason = adapter.refuseScanReason(doc);
  const needsDestAck = !!doc.flags.mandatory_scan_dest_location && !destAck;

  const activeLine = useMemo(
    () => doc.lines.find((l) => l.move_id === activeMoveId) ?? null,
    [doc, activeMoveId],
  );

  // A single-line document has nothing to choose; pre-select it unless the
  // operation type insists the product is scanned first.
  useEffect(() => {
    if (activeMoveId) return;
    if (doc.flags.mandatory_scan_product) return;
    if (doc.lines.length === 1) setActiveMoveId(doc.lines[0].move_id);
  }, [doc, activeMoveId]);

  /* -- committing one unit ---------------------------------------------- */

  const commitUnit = useCallback(async (
    line: ScanDocLine,
    serial: string,
    /** The resolved unit, when the scan found one already in stock. */
    existing: ExistingUnit | null,
    eventId?: string,
  ) => {
    const id = eventId ?? push('pending', serial, `Sending ${serial} onto ${line.product_name}…`);
    if (eventId) settle(eventId, 'pending', `Retrying ${serial}…`, undefined);
    const unitCost = Number(costRef.current) || 0;
    try {
      await commit.mutateAsync({
        moveId: line.move_id,
        // Both added in the transfer pass. The receipt adapter ignores them —
        // inv_receive_serial derives the operation and the destination from the
        // move itself — but every adapter that calls inv_transfer_stock_item
        // directly needs them, and the destination in particular can only come
        // from here: mandatory_scan_dest_location means the screen holds the
        // answer, not the operation row.
        operationId,
        toLocationId: doc.dest_location_id,
        serial,
        cost: unitCost,
        // Receipts CREATE the unit, so this is null on a receipt scan and the
        // receipt adapter ignores it. A transfer MOVES an existing one and its
        // adapter requires it — carrying the unit's OWN location, never the
        // operation's source.
        existing,
      });
      settle(id, 'confirmed', `${serial} ${adapter.unitCommittedVerb} onto ${line.product_name}.`);
      await refetch();
    } catch (e) {
      // Verbatim (Rule 5). These RPCs raise sentences meant to be read.
      settle(id, 'failed', errorText(e), { moveId: line.move_id, serial, cost: unitCost });
    }
    // operationId and the destination are real dependencies, not noise: a
    // stale closure here would commit units against the previous document or
    // send them to the previous destination, and inv_transfer_stock_item would
    // accept that happily because BOTH values are structurally valid and
    // NEITHER is checked server-side. See CLAUDE.md.
  }, [commit, push, settle, refetch, operationId, doc.dest_location_id, adapter]);

  /**
   * The over-receipt gate, then the commit.
   *
   * Split out of the scan handler so the condition warning can hand control
   * back to it after the operator confirms. Both entry points therefore ask the
   * count question — before this existed, confirming a condition would have
   * skipped it.
   */
  const countGateThenCommit = useCallback(async (
    line: ScanDocLine,
    code: string,
    existing: ExistingUnit | null,
  ) => {
    const nextCount = line.received_qty + 1;
    if (nextCount > line.demand_qty) {
      // Never silently accepted, never hard-blocked. The operator decides,
      // with the numbers stated plainly.
      setOverScan({ code, line, nextCount, existing });
      return;
    }
    await commitUnit(line, code, existing);
  }, [commitUnit]);

  /* -- the scan handler -------------------------------------------------- */

  const chain = useRef<Promise<void>>(Promise.resolve());

  const handleScan = useCallback((raw: string) => {
    // Serialised: a handheld can fire faster than a round trip, and two scans
    // racing would both read the same received count and both slip past the
    // over-receipt gate.
    chain.current = chain.current.then(async () => {
      const code = raw.trim();
      if (!code) return;

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
            `Line selected: ${line.product_name} (matched on ${resolution.matched}). ${line.received_qty} of ${line.demand_qty} done. Scan each unit's serial now.`);
          return;
        }
        push('failed', code, doc.flags.allow_extra_products
          ? `${resolution.product_name} is not on ${doc.number}. This ${adapter.documentNoun} allows extra products, but the line must be added on the ${adapter.documentNoun} page first — the scan screen does not create lines.`
          : `${resolution.product_name} is not on ${doc.number}, and this operation type does not allow extra products (allow_extra_products is off).`);
        return;
      }

      /*
       * An existing unit. Two things to settle before it can be committed:
       * whether it is already on THIS document, and — the part that differs
       * per kind — whether the adapter needs the unit at all.
       */
      let existing: ExistingUnit | null = null;
      if (resolution.kind === 'unit') {
        const mine = doc.units.find((u) => u.stock_item_id === resolution.stock_item_id);
        if (mine) {
          const line = doc.lines.find((l) => l.move_id === mine.move_id);
          push('duplicate', code,
            `${resolution.serial} is already on ${doc.number}${line ? ` against ${line.product_name}` : ''}. No second unit was created — the database treats a re-scan of the same serial as the same unit.`);
          return;
        }
        // Not on this document. On a receipt that means a foreign serial and
        // the database is left to refuse it in its own words. On a transfer it
        // is the NORMAL case: the unit exists in stock and is about to be moved
        // onto this document for the first time.
        /*
         * ROUTE FIRST — AHEAD OF BOTH GATES, AND AHEAD OF EVERYTHING ELSE.
         *
         * A route refusal is not a decision the operator gets to make, which is
         * what separates it from the two gates below. There is no point asking
         * "ship this REJECTED unit?" or "accept an extra one?" about a unit
         * that cannot lawfully leave where it is standing: the operator would
         * answer a question, and then be refused anyway — by the server, in a
         * different sentence, about a different subject.
         *
         * It also sits ahead of the line-selection and destination-ack checks
         * on purpose. Those are the SCREEN's prerequisites; this is a fact
         * about the unit and the document that no amount of selecting lines
         * changes. Telling an operator "no line selected" first would send them
         * to pick a line, rescan, and only then learn the unit was never
         * eligible.
         *
         * Only reachable for a unit that already exists. A receipt scanning an
         * unknown serial CREATES the unit at the operation's own destination,
         * so there is no origin to be wrong about.
         */
        const refusal = routeRefusal(doc, resolution);
        if (refusal) {
          push('failed', code, refusal);
          return;
        }
        // Built through unitRef() rather than by hand: it is the one place
        // that knows every field the seam expects, so a field added there
        // (status, in the delivery pass) cannot be silently missed here.
        existing = unitRef(resolution);
      }

      /* a serial to commit */
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

      /*
       * CONDITION FIRST, COUNT SECOND, and the order is deliberate.
       *
       * Both gates can fire on one scan. Asking about the count first would
       * mean an operator confirms "yes, an extra unit" and the unit is
       * committed — with its REJECTED status never mentioned, because the
       * count gate commits directly. Asking about the condition first means
       * the count question is still reached afterwards, via countGateThenCommit.
       *
       * The adapter decides whether there is anything to ask: a transfer
       * returns null here, a delivery returns a sentence naming the condition.
       */
      const warning = existing ? adapter.warnBeforeCommit(existing, code) : null;
      if (warning) {
        setConditionWarn({ code, line, message: warning, existing: existing! });
        return;
      }

      await countGateThenCommit(line, code, existing);
    });
  }, [doc, adapter, activeLine, needsDestAck, push, countGateThenCommit]);

  /**
   * Retry a failed scan, RE-RESOLVING the serial rather than reusing what the
   * first attempt resolved.
   *
   * The retry row lets the operator CORRECT the serial, and that is exactly why
   * the old resolution cannot be carried forward. An adapter that moves an
   * existing unit is driven by `existing.stockItemId`, not by the serial
   * string — reusing a stale ref would move the ORIGINAL unit while the feed
   * displayed the corrected serial, and both the ledger and the screen would be
   * internally consistent and wrong.
   *
   * On a receipt the extra round trip changes nothing, because the receipt
   * adapter ignores `existing` and the serial IS the payload. Paying it on both
   * paths keeps one code path instead of a kind test.
   */
  const onRetry = useCallback((event: ScanEvent, serial: string) => {
    if (!event.retry || !serial) return;
    const line = doc.lines.find((l) => l.move_id === event.retry!.moveId);
    if (!line) return;
    chain.current = chain.current.then(async () => {
      let existing: ExistingUnit | null = null;
      try {
        const resolution = await resolveScan(serial);
        if (resolution.kind === 'unit') {
          /*
           * The retry path needs this gate for the same reason it needs the
           * condition one, and it is easy to miss: the retry row lets the
           * operator CORRECT the serial, so what just resolved may be a
           * DIFFERENT UNIT IN A DIFFERENT PLACE from the one that failed.
           * Checking only on the first scan would let a corrected serial walk
           * straight past the refusal that the original scan was shown.
           *
           * The retry row is kept (`event.retry`) rather than settled away: a
           * route refusal is often a typo, and the operator needs the same row
           * to correct again.
           */
          const refusal = routeRefusal(doc, resolution);
          if (refusal) {
            settle(event.id, 'failed', refusal, event.retry);
            return;
          }
          existing = unitRef(resolution);
        }
      } catch (e) {
        settle(event.id, 'failed', errorText(e), event.retry);
        return;
      }
      // Same gate as a first scan. The serial may have been corrected to a
      // different unit, so the condition that applied a moment ago may not be
      // the condition that applies now.
      const warning = existing ? adapter.warnBeforeCommit(existing, serial) : null;
      if (warning) {
        setConditionWarn({ code: serial, line, message: warning, existing: existing!, eventId: event.id });
        return;
      }
      await commitUnit(line, serial, existing, event.id);
    });
  }, [doc, adapter, commitUnit, settle]);

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
      push('info', doc.number, `${doc.number} validated.`);
    } catch (e) {
      setValidateError(errorText(e));
    }
  }

  /* -- render ------------------------------------------------------------ */

  const totalDemand = doc.lines.reduce((s, l) => s + l.demand_qty, 0);
  const totalReceived = doc.lines.reduce((s, l) => s + l.received_qty, 0);
  const linesDone = doc.lines.filter((l) => l.received_qty >= l.demand_qty).length;
  const blocked = !!refuseReason || !!overScan || !!conditionWarn || confirmValidate;

  const hint = refuseReason
    ? 'Scanning is closed on this document'
    : conditionWarn
      ? "Confirm the unit's condition to continue"
      : overScan
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
            {/*
              Both ends, not just the destination. On a transfer the source is
              half the document's meaning — "Godown → Showroom" is the whole
              instruction — and hiding it is what the old module did.
            */}
            {doc.source_location_name && ` · ${doc.source_location_name}`}
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
            {/*
              FROM THE ADAPTER, not from a kind test here. This was
              `doc.kind === 'receipt' ? … : …`, and the delivery pass caught it
              in preview: a delivery inherited the transfer's words and told the
              operator that shipping a quarantined unit "is often the point",
              directly contradicting the warning the adapter raises moments
              later. A binary test on a four-member enum is a bug waiting for
              its third case.
            */}
            {adapter.conditionBlurb}
            {' '}Scan rules on this screen come from the operation type
            ({doc.type_name}); the database does not enforce them.
          </div>
        </div>

        <div className="flex min-h-0 w-full flex-col border-t border-[hsl(var(--ds-border))] lg:w-[380px] lg:border-t-0 xl:w-[420px]">
          <div className="flex items-center gap-2 border-b border-[hsl(var(--ds-border))] px-3 py-2">
            {/*
              Only where the adapter actually uses it. inv_transfer_stock_item
              has no cost parameter, so on a transfer this box would collect a
              number that is silently discarded.
            */}
            {adapter.capturesUnitCost && (
              <>
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
              </>
            )}
            <span className="ml-auto text-[var(--ds-fs-sm)] tabular-nums text-[hsl(var(--ds-ink-muted))]">
              {totalReceived} / {totalDemand} units
            </span>
          </div>

          <ScanFeed
            events={events}
            onRetry={onRetry}
            onDismiss={onDismiss}
            /* "Received" is a lie on a transfer. Comes off the adapter. */
            confirmedLabel={adapter.unitCommittedVerb}
          />
        </div>
      </div>

      {/*
        ---- unit-condition confirmation ----
        Red rather than the over-scan amber, and the wording names the condition
        rather than asking a generic "are you sure". An extra unit on a line is
        untidy; an unfit unit in a customer's house is not recoverable.
      */}
      {conditionWarn && (
        <div className="shrink-0 border-t-2 border-[hsl(var(--ds-red))] bg-[hsl(var(--ds-red-bg))] p-3">
          <p className="text-[16px] font-bold text-[hsl(var(--ds-red))]">
            Check this unit's condition
          </p>
          <p className="mt-1 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">
            {conditionWarn.message}
          </p>
          <p className="mt-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))]">
            Nothing has been recorded yet. The database does not block this — it checks the
            unit's product and location and says nothing about its condition, so this
            question is the only one being asked.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                const { line, code, existing, eventId } = conditionWarn;
                setConditionWarn(null);
                chain.current = chain.current.then(() =>
                  // A retry resumes its own event row and has already passed the
                  // count gate; a first scan still has to face it.
                  eventId
                    ? commitUnit(line, code, existing, eventId)
                    : countGateThenCommit(line, code, existing));
              }}
              className="h-12 flex-1 rounded-[var(--ds-radius)] bg-[hsl(var(--ds-red))] text-[15px] font-bold text-white"
            >
              Deliver it anyway
            </button>
            <button
              type="button"
              onClick={() => {
                push('info', conditionWarn.code,
                  `Held back. ${conditionWarn.code} was not added to ${doc.number} — its condition is ${conditionWarn.existing.status}.`);
                setConditionWarn(null);
              }}
              className="h-12 flex-1 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))] bg-[hsl(var(--ds-surface))] text-[15px] font-semibold text-[hsl(var(--ds-ink))]"
            >
              Hold it back
            </button>
          </div>
        </div>
      )}

      {/* ---- over-scan confirmation ---- */}
      {overScan && (
        <div className="shrink-0 border-t-2 border-[hsl(var(--ds-amber))] bg-[hsl(var(--ds-amber-bg))] p-3">
          <p className="text-[16px] font-bold text-[hsl(var(--ds-ink))]">
            This is unit {overScan.nextCount} of {overScan.line.demand_qty} on this line
            {' '}— confirm?
          </p>
          <p className="mt-1 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">
            <span className="font-mono font-semibold">{overScan.code}</span> would take
            {' '}{overScan.line.product_name} past the demand on its line. The extra unit is
            recorded either way — the database does not block it.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                const { line, code, existing } = overScan;
                setOverScan(null);
                chain.current = chain.current.then(() => commitUnit(line, code, existing));
              }}
              className="h-12 flex-1 rounded-[var(--ds-radius)] bg-[hsl(var(--ds-amber))] text-[15px] font-bold text-white"
            >
              Accept it anyway
            </button>
            <button
              type="button"
              onClick={() => {
                push('info', overScan.code,
                  `Skipped. ${overScan.line.product_name} stays at ${overScan.line.received_qty} of ${overScan.line.demand_qty}.`);
                setOverScan(null);
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
              Validate {doc.number} with {totalReceived} of {totalDemand} units{' '}
              {adapter.unitCommittedVerb}?
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

/**
 * Loads the document, then hands it to a session with the right adapter.
 *
 * The adapter cannot be chosen before this point, because the kind lives on the
 * document.
 */
function Scanner({ operationId }: { operationId: string }) {
  const navigate = useNavigate();
  const { data: doc, isLoading, error, refetch } = useScanDocument(operationId);

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

  const adapter = adapterFor(doc.kind);

  // A kind with no adapter is REFUSED IN WORDS, never fallen back to another
  // kind's adapter. Falling back to the receipt adapter here would call
  // inv_receive_serial on, say, a delivery note — inventing units on a document
  // whose whole purpose is to send them away.
  if (!adapter) {
    return (
      <div className="ds-root min-h-screen bg-[hsl(var(--ds-surface))] p-4">
        <ErrorBanner
          title={`Scanning is not built for ${doc.kind} documents yet`}
          message={unsupportedKindReason(doc.kind, doc.number)}
        />
        <Button className="mt-3" variant="outline" onClick={() => navigate('/inventory2/barcode')}>
          Back to the list
        </Button>
      </div>
    );
  }

  return (
    <ScanSession
      key={doc.id}
      doc={doc}
      adapter={adapter}
      operationId={operationId}
      refetch={refetch}
    />
  );
}

/* -------------------------------------------------------------- the route */

export default function BarcodeScan() {
  const [params] = useSearchParams();
  /*
   * `operation` is the parameter now — the screen takes documents of any kind
   * and `receipt=` was a lie on three quarters of them.
   *
   * `receipt=` is still READ, and deliberately not redirected away from: links
   * to it exist in the wild (the Barcode segment on every receipt printed into
   * someone's notes, browser history, bookmarks). Rule 4 in spirit — the old
   * entry point keeps working rather than being deleted out from under whoever
   * saved it.
   */
  const operationId = params.get('operation') ?? params.get('receipt');
  return operationId ? <Scanner operationId={operationId} /> : <DocumentPicker />;
}
