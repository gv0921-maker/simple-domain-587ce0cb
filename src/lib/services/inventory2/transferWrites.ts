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

/* ------------------------------------------------------- create and lines */

/** Shape of the jsonb `inv_create_operation` returns. */
export interface CreateOperationResult {
  id: string;
  number: string;
  kind: string;
  state: string;
  source_location_id: string | null;
  dest_location_id: string | null;
  /**
   * The two `locks_*` flags as the DATABASE resolved them, plus whether it
   * ignored what we sent. `locks_source` is honoured for the first time on this
   * path — it had sat on inv_operation_type since Step 2 read by nothing — and
   * it behaves exactly as locks_destination already did: a locked end ignores
   * the caller's value rather than rejecting it, and says that it did.
   */
  source_locked: boolean;
  destination_locked: boolean;
  client_source_ignored: boolean;
  client_destination_ignored: boolean;
}

export interface CreateTransferInput {
  operationTypeId: string;
  sourceLocationId?: string | null;
  destLocationId?: string | null;
  sourceDocument?: string | null;
  scheduledAt?: string | null;
  notes?: string | null;
}

/**
 * Raise a transfer.
 *
 * Both ends are SENT even when the type locks them. The RPC decides and reports
 * back which values it ignored, so the form can say "we overrode you" instead of
 * silently displaying something the user did not choose. Same contract the
 * receipt create form already honours for the destination.
 *
 * No vendor, no customer, no purchase order: `inv_create_operation` refuses a
 * purchase order on any non-receipt kind, and a transfer has no partner — both
 * of its ends are locations.
 */
export async function createTransfer(input: CreateTransferInput): Promise<CreateOperationResult> {
  const { data, error } = await supabase.rpc('inv_create_operation', {
    p_operation_type_id:  input.operationTypeId,
    p_source_location_id: input.sourceLocationId ?? undefined,
    p_dest_location_id:   input.destLocationId ?? undefined,
    p_source_document:    input.sourceDocument ?? undefined,
    p_scheduled_at:       input.scheduledAt ?? undefined,
    p_notes:              input.notes ?? undefined,
  });
  if (error) throw error;
  return data as unknown as CreateOperationResult;
}

/**
 * Add or update a product line on an operation of any kind.
 *
 * Upserts by product, like its receipt namesake: calling again for the same
 * product changes that line's demand rather than creating a duplicate.
 */
export async function addOperationLine(
  operationId: string,
  productId: string,
  demandQty: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('inv_add_operation_line', {
    p_operation_id: operationId,
    p_product_id: productId,
    p_demand_qty: demandQty,
  });
  if (error) throw error;
  return data as string;
}

export interface RemoveOperationLineResult {
  operation: string;
  kind: string;
  removed_move_id: string;
  operation_state: string;
}

/**
 * Remove an unprocessed line.
 *
 * Refused once units have been moved onto it — 'This line has N unit(s) already
 * moved and cannot be removed.' That refusal is the answer, not an error to
 * swallow: units leave a document only by reversal, which does not exist.
 */
export async function removeOperationLine(moveId: string): Promise<RemoveOperationLineResult> {
  const { data, error } = await supabase.rpc('inv_remove_operation_line', {
    p_move_id: moveId,
  });
  if (error) throw error;
  return data as unknown as RemoveOperationLineResult;
}

/* -------------------------------------------------------- form option reads */

export interface TransferTypeOption {
  id: string;
  name: string;
  locks_source: boolean;
  locks_destination: boolean;
  default_source_location_id: string | null;
  default_dest_location_id: string | null;
}

/**
 * Active operation types of kind `internal`.
 *
 * Each one IS a route: "Godown → Showroom" and "Showroom → Packing" are
 * separate types, not one type with variable ends. That is why the create form
 * leads with this choice and derives both locations from it.
 */
export async function listTransferTypes(): Promise<TransferTypeOption[]> {
  const { data, error } = await supabase
    .from('inv_operation_type')
    .select('id, name, locks_source, locks_destination, default_source_location_id, default_dest_location_id')
    .eq('kind', 'internal')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}
