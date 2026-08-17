/**
 * Inventory 2 — the OUTGOING DELIVERY adapter for the scan engine.
 *
 * The third adapter, and the second test of Pass 7's claim that adding a kind
 * costs one sibling file and no edit to `scan.ts`. The verdict is recorded at
 * the top of `scan.ts`; the short version is that the PAYLOAD held this time
 * and the SEAM needed one new question.
 *
 * ── MECHANICALLY, THIS IS THE TRANSFER ADAPTER ────────────────────────────
 * A delivery moves units that already exist, exactly as a transfer does, so it
 * calls the same `inv_transfer_stock_item` with the same two ends:
 *
 *   from   input.existing.currentLocationId — the unit's OWN location, read at
 *          scan time. NEVER the operation's source_location_id.
 *   to     input.toLocationId — the destination the SCREEN holds.
 *
 * What differs is not the movement. It is what the movement MEANS.
 *
 * ── A DELIVERY IS THE ONE MOVE YOU CANNOT TAKE BACK ───────────────────────
 * A transfer that puts a rejected unit in the wrong aisle is fixed by another
 * transfer. A delivery hands it to a customer. The unit is out of the building,
 * the ledger is append-only, and the correction is a conversation rather than a
 * document.
 *
 * The database will not stop it. `inv_transfer_stock_item` asserts the unit's
 * product and its current location and says NOTHING about its status — it will
 * ship a `destroyed` unit to a customer as happily as an `ok` one, and record
 * it as a real move with a real ledger row. CLAUDE.md, "THE DESTINATION OF A
 * MOVE IS TAKEN ON TRUST": the server checks that the right product is on the
 * right line, and nothing else.
 *
 * So the condition check is THIS ADAPTER'S RESPONSIBILITY, and it is a warning
 * rather than a block:
 *
 *   WARN AND CONFIRM, never silent   the operator is told the unit's condition
 *                                    in words and decides. Same shape as the
 *                                    over-receipt gate, which is already the
 *                                    house pattern for "unusual, not forbidden".
 *   NEVER HARD-BLOCK                 a blocked screen is worked around, and
 *                                    there are real reasons to ship a damaged
 *                                    unit (a customer accepting a floor model
 *                                    at a discount). Refusing outright would
 *                                    move that decision off the system.
 *
 * `attention` is in the warned set DELIBERATELY. It is the softest of the bad
 * statuses — an advisory check failed, the unit is "sellable-adjacent" — and it
 * is precisely the one that would get waved through if it were treated as
 * clean. CLAUDE.md is explicit that an advisory failure means "review before
 * promising it", and a delivery IS the promise.
 *
 * ── NO QC HERE, ON PURPOSE ────────────────────────────────────────────────
 * `requires_qc` stays false on outgoing types for the same reason it stays
 * false on internal ones: inv_test_result has no operation_id, so an inspection
 * is unit-scoped and running QC from a delivery would overwrite the RECEIPT's
 * verdict for that unit. CLAUDE.md. The Quality segment is not adopted.
 *
 * ── NO RESERVATIONS ───────────────────────────────────────────────────────
 * `reserved_for_customer_id` is not written here. This adapter ships units that
 * are already picked; it does not claim them in advance.
 */
import { transferStockItem, completeOperation } from './deliveryWrites';
import type {
  CommitUnitInput, ScanAdapter, ScanDocument, ScannedUnitRef, InvStockStatus,
} from './scan';

/**
 * Why each condition is worth stopping for, in the operator's words.
 *
 * Every member of `inv_stock_status` except `ok` is listed. Written as a total
 * map rather than a default-plus-exceptions so that adding a status to the enum
 * is a TYPE ERROR here — the alternative is a new status silently inheriting
 * "no warning", which on this document means shipping it to a customer without
 * anyone being asked.
 */
const CONDITION_REASON: Record<Exclude<InvStockStatus, 'ok'>, string> = {
  attention:   'an advisory check failed on it — it is sellable-adjacent, but CLAUDE.md is explicit that it should be reviewed before it is promised to anyone, and a delivery is the promise',
  damaged:     'it is recorded as damaged',
  destroyed:   'it is recorded as destroyed — this unit should not be leaving on a delivery at all',
  lost:        'it is recorded as lost, so the system does not believe this unit is physically available',
  quarantined: 'its inspection is incomplete, so it has not been cleared to sell',
  rejected:    'a required check FAILED on it — it is on hand but not sellable',
};

export const DELIVERY_SCAN_ADAPTER: ScanAdapter = {
  kind: 'outgoing',
  documentNoun: 'delivery',
  unitCommittedVerb: 'delivered',
  /**
   * inv_transfer_stock_item has no cost parameter, same as on a transfer. The
   * unit was costed when it was received and shipping it does not re-cost it,
   * so the screen must not ask for a figure it would silently discard.
   */
  capturesUnitCost: false,

  /**
   * The question the seam was missing. Null for an `ok` unit; otherwise a
   * sentence naming the condition and what it means.
   *
   * `serial` is passed rather than read off the ref because the ref carries an
   * id, and an operator identifies a unit by the number printed on it.
   */
  warnBeforeCommit(unit: ScannedUnitRef, serial: string): string | null {
    if (unit.status === 'ok') return null;
    const reason = CONDITION_REASON[unit.status];
    return (
      `${serial} is ${unit.status.toUpperCase()} — ${reason}. ` +
      `Delivering it sends it to the customer and the movement cannot be reversed. Confirm?`
    );
  },

  /**
   * `input.existing` is REQUIRED, as on a transfer: a delivery ships a unit
   * that already exists and cannot invent one. Saying so plainly beats letting
   * the RPC fail on a null it cannot explain.
   */
  commitUnit(input: CommitUnitInput): Promise<string> {
    if (!input.existing) {
      throw new Error(
        `${input.serial} is not a unit in stock, so there is nothing to deliver. ` +
        `A delivery ships units that already exist — only a receipt brings new ones in.`,
      );
    }
    if (!input.toLocationId) {
      throw new Error(
        `This delivery has no destination location, so ${input.serial} has nowhere to go. ` +
        `Set a destination on the document before scanning units into it.`,
      );
    }

    return transferStockItem({
      stockItemId: input.existing.stockItemId,
      moveId: input.moveId,
      // The unit's own location. See the rule at the top of scan.ts.
      expectedFromLocationId: input.existing.currentLocationId,
      toLocationId: input.toLocationId,
      operationId: input.operationId,
      entryType: 'outgoing',
    });
  },

  completeDocument(operationId: string): Promise<unknown> {
    return completeOperation(operationId);
  },

  refuseScanReason(doc: ScanDocument): string | null {
    if (doc.state === 'done') {
      return `This delivery is already done. ${doc.number} was validated and cannot take further units.`;
    }
    if (doc.state === 'cancelled') {
      return `This delivery is cancelled. ${doc.number} cannot take further units.`;
    }
    if (!doc.source_location_id || !doc.dest_location_id) {
      return `${doc.number} needs both a source and a destination location before units can be delivered.`;
    }
    if (doc.lines.length === 0) {
      return `${doc.number} has no lines yet. Add a product line before scanning units into it.`;
    }
    return null;
  },
};
