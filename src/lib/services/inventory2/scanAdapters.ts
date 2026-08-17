/**
 * Inventory 2 — the scan adapter REGISTRY, keyed by `inv_operation_kind`.
 *
 * The last receipt-shaped thing in the scan path. Before this file,
 * `BarcodeScan.tsx` opened with
 *
 *   const ADAPTER = RECEIPT_SCAN_ADAPTER;
 *
 * with a comment promising that the constant would move when the next adapter
 * landed. The adapter landed; this is the constant moving.
 *
 * ── THE KIND COMES FROM THE DOCUMENT, NOT FROM THE URL ────────────────────
 * `getScanDocument()` already reads `inv_operation_type.kind` and puts it on
 * `ScanDocument.kind`. That is the ONLY thing that decides which adapter runs.
 * The screen does not infer the kind from the route it was reached by, from a
 * query parameter, or from which list linked to it — all three can be stale or
 * hand-edited, and picking the wrong adapter means calling the wrong RPC
 * against a real document.
 *
 * ── A MISSING ADAPTER IS AN ANSWER, NOT A CRASH ───────────────────────────
 * `adjustment` is a real, active operation kind with a real operation type
 * configured (STOCK ADJUSTMENT) and no adapter yet. Handing this screen one of
 * those documents must produce a sentence saying so — not an undefined
 * dereference, and emphatically not a silent fallback to the receipt adapter,
 * which would call inv_receive_serial and INVENT units on a document meant to
 * correct a count.
 *
 * `outgoing` was in that sentence until the delivery pass; the warning it
 * carried was the right one, and it is left here almost unchanged because one
 * kind still needs it.
 *
 * That is why `adapterFor` returns `null` rather than defaulting, and why
 * `SCAN_ADAPTERS` is a Partial record: the type system makes the gap visible at
 * every call site instead of letting one be forgotten.
 */
import type { ScanAdapter, ScanDocKind } from './scan';
import { RECEIPT_SCAN_ADAPTER } from './scanReceipt';
import { TRANSFER_SCAN_ADAPTER } from './scanTransfer';
import { DELIVERY_SCAN_ADAPTER } from './scanDelivery';

/**
 * Every kind the scan screen can currently work.
 *
 * Adding a kind is: write the sibling adapter, add one line here. Pass 7's
 * claim was that `scan.ts` itself needs no edit for that, and the transfer
 * adapter tested it — the verdict, including where the claim failed, is at the
 * top of `scan.ts`.
 */
export const SCAN_ADAPTERS: Partial<Record<ScanDocKind, ScanAdapter>> = {
  receipt: RECEIPT_SCAN_ADAPTER,
  internal: TRANSFER_SCAN_ADAPTER,
  outgoing: DELIVERY_SCAN_ADAPTER,
};

/** The kinds with an adapter, in the order the picker should show them. */
export const SCANNABLE_KINDS = Object.keys(SCAN_ADAPTERS) as ScanDocKind[];

/** The adapter for a kind, or null when that kind is not built yet. */
export function adapterFor(kind: ScanDocKind): ScanAdapter | null {
  return SCAN_ADAPTERS[kind] ?? null;
}

/**
 * Why this document cannot be scanned, when no adapter claims its kind.
 *
 * Separate from `ScanAdapter.refuseScanReason` on purpose: that one is asked
 * *by* an adapter about a document it owns. This one is asked when there is no
 * adapter to ask.
 */
export function unsupportedKindReason(kind: ScanDocKind, number: string): string {
  return (
    `${number} is a ${kind} operation, and the scan screen has no adapter for ${kind} yet. ` +
    `Scanning is built for ${SCANNABLE_KINDS.join(' and ')} documents. ` +
    `This is a missing feature, not a problem with the document — nothing has been changed or refused on it.`
  );
}
