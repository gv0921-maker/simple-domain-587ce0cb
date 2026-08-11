/**
 * Inventory 2 — receipt WRITE layer.
 *
 * Every function here is a thin call onto a sanctioned database RPC. There is
 * deliberately no business logic in this file and no direct table write: the
 * rules (numbering, locked destinations, what may be edited in which state,
 * whether a cancel is allowed) live in the database, where they cannot be
 * bypassed by a second client.
 *
 * NEVER write inv_stock_item, inv_move_line or inv_stock_tracking directly.
 * Units enter stock only through inv_receive_serial, which also writes the
 * append-only ledger row and applies the quarantine default.
 *
 * ⚠ HAZARD — the three legacy namesakes inv_save_stock_move,
 * inv_validate_stock_move and inv_delete_stock_move carry the inv_ prefix but
 * belong to the OLD module: they write public.stock_moves and
 * products.stock_on_hand. Nothing in this file may call them, and nothing
 * does.
 *
 * `products` and `vendors` are READ here to populate pickers, exactly as the
 * read layer already does. They are never written.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Enums = Database['public']['Enums'];
export type InvStockStatus = Enums['inv_stock_status'];

/* ------------------------------------------------------------------ types */

/** Shape of the jsonb `inv_create_receipt` returns. */
export interface CreateReceiptResult {
  id: string;
  number: string;
  state: string;
  source_location_id: string | null;
  dest_location_id: string | null;
  destination_locked: boolean;
  /**
   * True when the type locked its destination AND the value we sent differed.
   * The RPC ignores the client value rather than rejecting it; surfacing this
   * lets the form say so instead of silently showing a different location.
   */
  client_destination_ignored: boolean;
}

export interface CancelReceiptResult {
  operation: string;
  operation_state: string;
  moves_cancelled: number;
  purchase_order_state: string | null;
  already_cancelled?: boolean;
}

export interface RemoveLineResult {
  operation: string;
  removed_move_id: string;
  operation_state: string;
}

export interface ReceiptTypeOption {
  id: string;
  name: string;
  locks_destination: boolean;
  default_dest_location_id: string | null;
  default_source_location_id: string | null;
}

export interface LocationOption {
  id: string;
  name: string;
  code: string | null;
}

export interface VendorOption {
  id: string;
  name: string;
}

export interface ProductOption {
  id: string;
  name: string;
  sku: string | null;
}

export interface CreateReceiptInput {
  operationTypeId: string;
  vendorId?: string | null;
  sourceDocument?: string | null;
  scheduledAt?: string | null;
  notes?: string | null;
  /**
   * What the user picked. Sent even when the type locks its destination — the
   * RPC decides whether to honour or ignore it, and reports which it did. The
   * form must not pre-empt that decision.
   */
  destLocationId?: string | null;
}

/* ------------------------------------------------------- form option reads */

/** Active operation types of kind `receipt` — the only ones create accepts. */
export async function listReceiptTypes(): Promise<ReceiptTypeOption[]> {
  const { data, error } = await supabase
    .from('inv_operation_type')
    .select('id, name, locks_destination, default_dest_location_id, default_source_location_id')
    .eq('kind', 'receipt')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listLocations(): Promise<LocationOption[]> {
  const { data, error } = await supabase
    .from('inv_location')
    .select('id, name, code')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listVendors(): Promise<VendorOption[]> {
  const { data, error } = await supabase
    .from('vendors')
    .select('id, name')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listProducts(): Promise<ProductOption[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sku')
    .order('name')
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

/* ------------------------------------------------------------------ writes */

export async function createReceipt(input: CreateReceiptInput): Promise<CreateReceiptResult> {
  const { data, error } = await supabase.rpc('inv_create_receipt', {
    p_operation_type_id: input.operationTypeId,
    p_vendor_id: input.vendorId ?? undefined,
    p_source_document: input.sourceDocument ?? undefined,
    p_scheduled_at: input.scheduledAt ?? undefined,
    p_notes: input.notes ?? undefined,
    p_dest_location_id: input.destLocationId ?? undefined,
  });
  if (error) throw error;
  return data as unknown as CreateReceiptResult;
}

/** Upserts by product: calling again for the same product changes its demand. */
export async function addReceiptLine(
  operationId: string,
  productId: string,
  demandQty: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('inv_add_receipt_line', {
    p_operation_id: operationId,
    p_product_id: productId,
    p_demand_qty: demandQty,
  });
  if (error) throw error;
  return data as string;
}

export async function removeReceiptLine(moveId: string): Promise<RemoveLineResult> {
  const { data, error } = await supabase.rpc('inv_remove_receipt_line', {
    p_move_id: moveId,
  });
  if (error) throw error;
  return data as unknown as RemoveLineResult;
}

/**
 * Receive one unit against a line.
 *
 * `p_status` is left to the database default, which is `quarantined`. That is
 * the whole point of the QC gate: a unit that has just arrived is on hand but
 * not sellable until it has been inspected. The UI must not be able to talk
 * its way past that by passing `ok` here.
 */
export async function receiveSerial(
  moveId: string,
  serial: string,
  cost: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('inv_receive_serial', {
    p_move_id: moveId,
    p_serial: serial,
    p_cost: cost,
  });
  if (error) throw error;
  return data as string;
}

export async function completeReceipt(operationId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc('inv_complete_receipt', {
    p_operation_id: operationId,
  });
  if (error) throw error;
  return data;
}

export async function cancelReceipt(operationId: string): Promise<CancelReceiptResult> {
  const { data, error } = await supabase.rpc('inv_cancel_receipt', {
    p_operation_id: operationId,
  });
  if (error) throw error;
  return data as unknown as CancelReceiptResult;
}
