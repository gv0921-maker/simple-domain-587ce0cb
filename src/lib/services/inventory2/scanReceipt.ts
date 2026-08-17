/**
 * Inventory 2 — the RECEIPT adapter for the scan engine.
 *
 * This is the whole receipt-specific surface of /inventory2/barcode. The engine
 * in `scan.ts` knows nothing about receipts; it asks this object to commit a
 * unit, to close the document, and whether scanning is allowed. Adding internal
 * transfers, deliveries or adjustments later means writing a sibling file to
 * this one — `scan.ts` should not need an edit.
 *
 * WHY THE VERB DIFFERS PER KIND
 * A receipt CREATES the unit: it did not exist before the lorry arrived, so
 * inv_receive_serial inserts the inv_stock_item and then hands it to
 * inv_transfer_stock_item internally. Every other kind MOVES a unit that
 * already exists, so its adapter calls inv_transfer_stock_item directly and
 * must pass `input.existing.currentLocationId` as p_expected_from_location_id
 * — the unit's real location, never the operation's source. See the rule at
 * the top of `scan.ts`.
 *
 * That asymmetry is exactly why `commitUnit` is the seam and not something the
 * engine tries to do itself.
 *
 * inv_receive_serial is deliberately idempotent: re-running it for a serial
 * already on this move returns the existing id and raises nothing. The screen
 * therefore cannot learn "already scanned" from an error, and tracks its own
 * session state instead — see BarcodeScan.tsx.
 */
import { receiveSerial, completeReceipt } from './receiptWrites';
import type { CommitUnitInput, ScanAdapter, ScanDocument } from './scan';

export const RECEIPT_SCAN_ADAPTER: ScanAdapter = {
  kind: 'receipt',
  documentNoun: 'receipt',
  unitCommittedVerb: 'received',
  /** inv_receive_serial takes p_cost: a receipt is where a unit is costed. */
  capturesUnitCost: true,

  conditionBlurb:
    'Units land quarantined and are not sellable until they pass QC.',

  /**
   * NOTHING TO WARN ABOUT ON A RECEIPT, structurally: the unit does not exist
   * until inv_receive_serial creates it, so there is no prior condition to
   * report. `CommitUnitInput.existing` is null on every receipt scan.
   *
   * A unit's condition on a receipt is decided AFTER it arrives, by QC —
   * inv_record_qc_results is what moves it off `quarantined`. Stated here
   * rather than omitted because the seam requires every adapter to declare its
   * policy.
   */
  warnBeforeCommit(): string | null {
    return null;
  },

  /**
   * `input.existing` is ignored here, and that is correct: on a receipt the
   * unit does not exist yet, so there is no current location to assert. The
   * field is part of the shared shape because the other three kinds need it.
   */
  commitUnit(input: CommitUnitInput): Promise<string> {
    return receiveSerial(input.moveId, input.serial, input.cost);
  },

  completeDocument(operationId: string): Promise<unknown> {
    return completeReceipt(operationId);
  },

  refuseScanReason(doc: ScanDocument): string | null {
    if (doc.state === 'done') {
      return `This receipt is already done. ${doc.number} was validated and cannot take further units.`;
    }
    if (doc.state === 'cancelled') {
      return `This receipt is cancelled. ${doc.number} cannot take further units.`;
    }
    if (!doc.source_location_id || !doc.dest_location_id) {
      return `${doc.number} needs both a source and a destination location before units can be received.`;
    }
    if (doc.lines.length === 0) {
      return `${doc.number} has no lines yet. Add a product line before scanning units into it.`;
    }
    return null;
  },
};
