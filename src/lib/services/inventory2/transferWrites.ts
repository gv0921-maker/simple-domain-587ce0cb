/**
 * Inventory 2 — transfer WRITE layer, sibling to `receiptWrites.ts`.
 *
 * Thin calls onto sanctioned RPCs, no business logic, no direct table write.
 * inv_stock_item, inv_move_line and inv_stock_tracking are never written from
 * here — inv_transfer_stock_item writes all three in one transaction, which is
 * the only way the unit, the document line and the append-only ledger can be
 * guaranteed to agree.
 *
 * ⚠ HAZARD, repeated from receiptWrites because it is the same trap: the three
 * legacy namesakes inv_save_stock_move, inv_validate_stock_move and
 * inv_delete_stock_move carry the inv_ prefix but belong to the OLD module and
 * write public.stock_moves / products.stock_on_hand. Nothing here calls them.
 */
import { supabase } from '@/integrations/supabase/client';

/**
 * Move one existing unit onto a document.
 *
 * `expectedFromLocationId` MUST be the unit's own current location, taken from
 * inv_stock_item.location_id. It is NOT the operation's source_location_id —
 * on a transfer those differ, and passing the document's source is the exact
 * mistake `CommitUnitInput` is shaped to prevent. The database asserts it too:
 *
 *   'Stock item % (serial %) is not where it was expected: it is in location %,
 *    but the caller expected %. Refusing to move it.'
 *
 * `documentType` is the literal string 'inv_operation' — the TABLE the ledger
 * points at, matching what inv_receive_serial already writes for receipts.
 * `entryType` is the operation KIND, again matching the receipt convention
 * (all 25 existing ledger rows read entry_type='receipt',
 * document_type='inv_operation').
 */
export async function transferStockItem(args: {
  stockItemId: string;
  moveId: string;
  expectedFromLocationId: string;
  toLocationId: string;
  operationId: string;
  entryType: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('inv_transfer_stock_item', {
    p_stock_item_id: args.stockItemId,
    p_move_id: args.moveId,
    p_expected_from_location_id: args.expectedFromLocationId,
    p_to_location_id: args.toLocationId,
    p_document_type: 'inv_operation',
    p_document_id: args.operationId,
    p_entry_type: args.entryType,
  });
  if (error) throw error;
  return data as string;
}

/**
 * Complete an operation of any kind.
 *
 * The generic completion added in the transfer pass. `inv_complete_receipt` is
 * now a thin wrapper over this same function that adds a receipt-only kind
 * guard, so the two paths cannot drift.
 */
export async function completeOperation(operationId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc('inv_complete_operation', {
    p_operation_id: operationId,
  });
  if (error) throw error;
  return data;
}
