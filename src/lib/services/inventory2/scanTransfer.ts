/**
 * Inventory 2 — the INTERNAL TRANSFER adapter for the scan engine.
 *
 * The sibling to `scanReceipt.ts` that Pass 7 said this would be. Written to
 * test that claim as much as to move stock; the verdict is recorded at the top
 * of `scan.ts`, and the short version is that the seam held and the payload
 * did not.
 *
 * ── HOW A TRANSFER DIFFERS FROM A RECEIPT ─────────────────────────────────
 * A receipt CREATES the unit — it did not exist before the lorry arrived — so
 * inv_receive_serial inserts the inv_stock_item and hands it to
 * inv_transfer_stock_item internally, deriving both ends from the operation.
 *
 * A transfer MOVES a unit that already exists. So this adapter calls
 * inv_transfer_stock_item directly and has to supply both ends itself:
 *
 *   from   input.existing.currentLocationId — the unit's OWN location, read
 *          from inv_stock_item.location_id when the scan resolved. NEVER the
 *          operation's source_location_id. On a receipt those coincide and the
 *          mistake is invisible; here they differ and the database refuses it.
 *   to     input.toLocationId — the destination the SCREEN holds, which is not
 *          always the operation's dest_location_id, because
 *          mandatory_scan_dest_location exists so an operator can confirm one.
 *
 * ── WHAT THIS ADAPTER REFUSES, AND WHAT IT DELIBERATELY DOES NOT ──────────
 * `refuseScanReason` blocks a document that cannot take units at all. It does
 * NOT filter units by status. Moving a rejected or quarantined unit is not an
 * error and must not be treated as one: quarantined stock sitting in the wrong
 * place is exactly the thing a transfer exists to relocate.
 *
 * Sending rejected stock OUT to a vendor is a different document type
 * (return-to-vendor, recorded in CLAUDE.md under PLANNED DOCUMENT TYPES), not
 * a permission check on this one. Movement is controlled by WHICH DOCUMENT is
 * used, not by who is clicking — the same principle as locks_source.
 *
 * ── NO QC HERE, ON PURPOSE ────────────────────────────────────────────────
 * requires_qc stays false for internal types and the Quality segment is not
 * adopted on transfer pages. inv_test_result has no operation_id, so an
 * inspection is unit-scoped: running QC from a transfer would overwrite the
 * receipt's verdict for that unit. See CLAUDE.md.
 */
import { transferStockItem, completeOperation } from './transferWrites';
import type { CommitUnitInput, ScanAdapter, ScanDocument } from './scan';

export const TRANSFER_SCAN_ADAPTER: ScanAdapter = {
  kind: 'internal',
  documentNoun: 'transfer',
  unitCommittedVerb: 'moved',
  /**
   * inv_transfer_stock_item has no cost parameter. The unit was costed when it
   * was received and relocating it does not re-cost it, so `CommitUnitInput.cost`
   * is ignored here and the screen must not ask for it.
   */
  capturesUnitCost: false,

  /**
   * Unlike the receipt adapter, `input.existing` is REQUIRED here — a transfer
   * cannot invent a unit. If it is missing, the scan resolved to something that
   * is not a unit in stock, and saying so plainly beats letting the RPC fail on
   * a null it cannot explain.
   */
  /**
   * NO CONDITION WARNING ON A TRANSFER, and this is a stated policy rather than
   * an omission — `warnBeforeCommit` is required on the seam precisely so this
   * has to be said out loud.
   *
   * Relocating a quarantined or rejected unit is not a mistake, it is the job.
   * Quarantined stock sitting in the wrong place is exactly what a transfer
   * exists to move, and warning about it every time would train operators to
   * dismiss the warning that DOES matter on a delivery.
   */
  warnBeforeCommit(): string | null {
    return null;
  },

  commitUnit(input: CommitUnitInput): Promise<string> {
    if (!input.existing) {
      throw new Error(
        `${input.serial} is not a unit in stock, so there is nothing to move. ` +
        `A transfer relocates units that already exist — only a receipt brings new ones in.`,
      );
    }
    if (!input.toLocationId) {
      throw new Error(
        `This transfer has no destination location, so ${input.serial} has nowhere to go. ` +
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
      entryType: 'internal',
    });
  },

  completeDocument(operationId: string): Promise<unknown> {
    return completeOperation(operationId);
  },

  refuseScanReason(doc: ScanDocument): string | null {
    if (doc.state === 'done') {
      return `This transfer is already done. ${doc.number} was validated and cannot take further units.`;
    }
    if (doc.state === 'cancelled') {
      return `This transfer is cancelled. ${doc.number} cannot take further units.`;
    }
    if (!doc.source_location_id || !doc.dest_location_id) {
      return `${doc.number} needs both a source and a destination location before units can be moved.`;
    }
    if (doc.lines.length === 0) {
      return `${doc.number} has no lines yet. Add a product line before scanning units into it.`;
    }
    return null;
  },
};
