/**
 * Inventory 2 — outgoing delivery WRITE layer, sibling to `transferWrites.ts`.
 *
 * Thin calls onto sanctioned RPCs, no business logic, no direct table write —
 * with ONE deliberate exception, documented at `createDelivery` below.
 *
 * ⚠ HAZARD, repeated a third time because it is the same trap: the three legacy
 * namesakes inv_save_stock_move, inv_validate_stock_move and
 * inv_delete_stock_move carry the inv_ prefix but belong to the OLD module and
 * write public.stock_moves / products.stock_on_hand. Nothing here calls them.
 *
 * ── WHAT THIS FILE DOES NOT RE-IMPLEMENT ──────────────────────────────────
 * `addOperationLine`, `removeOperationLine`, `completeOperation` and
 * `transferStockItem` are already generic over kind — that is what the transfer
 * pass generalised them for. They are RE-EXPORTED here UNCHANGED rather than
 * copied, so a fix to one is a fix to all three document types. A delivery that
 * quietly grew its own copy of the completion call is exactly how two paths
 * start giving different answers.
 */
import { supabase } from '@/integrations/supabase/client';

export {
  transferStockItem,
  completeOperation,
  addOperationLine,
  removeOperationLine,
  type CreateOperationResult,
  type RemoveOperationLineResult,
} from './transferWrites';

import { type CreateOperationResult } from './transferWrites';

/* ------------------------------------------------------------------ create */

export interface CreateDeliveryInput {
  operationTypeId: string;
  sourceLocationId?: string | null;
  destLocationId?: string | null;
  /** WHO receives it. Written to inv_operation.partner_customer_id. */
  customerId?: string | null;
  /**
   * WHICH ORDER it is against. Recorded even though nothing verifies payment
   * yet — see the note on the second step below.
   */
  salesOrderId?: string | null;
  sourceDocument?: string | null;
  scheduledAt?: string | null;
  notes?: string | null;
}

/**
 * Raise a delivery. TWO STATEMENTS, and the reason is worth reading.
 *
 * `inv_create_operation` takes `p_partner_customer_id` — the party — so that
 * goes in on the create call and is subject to every guard the RPC applies
 * (including `inv_operation_single_partner`, which refuses a vendor and a
 * customer on the same document).
 *
 * It does NOT take a sales order. The column was added by the payment-gate
 * migration AFTER that RPC was written, and widening a 10-parameter RPC used by
 * three document types is a database change — CLAUDE.md rule 2 — that this pass
 * has no approval for. So the reference is set by a follow-up UPDATE on the row
 * we just created.
 *
 * THE HONEST COST OF THAT, stated rather than hidden: the two statements are
 * not one transaction. If the UPDATE fails, a delivery exists with no sales
 * order recorded. That is a visible, correctable state — the detail page shows
 * "no sales order recorded" and the reference can be set later — and it is
 * strictly better than the alternatives of silently dropping the reference or
 * editing an RPC without approval. It is NOT swallowed: the error propagates,
 * carrying the number of the document that was created, so the operator knows
 * both that the delivery exists and that its order link is missing.
 *
 * When `inv_create_operation` is next opened for an approved reason, folding
 * `p_sales_order_id` into it removes this seam entirely.
 *
 * Both location ends are SENT even when the type locks them. The RPC decides
 * and reports which values it ignored, so the form can say "we overrode you"
 * instead of silently showing something the operator did not choose — the same
 * contract the receipt and transfer forms already honour.
 */
export async function createDelivery(input: CreateDeliveryInput): Promise<CreateOperationResult> {
  const { data, error } = await supabase.rpc('inv_create_operation', {
    p_operation_type_id:    input.operationTypeId,
    p_source_location_id:   input.sourceLocationId ?? undefined,
    p_dest_location_id:     input.destLocationId ?? undefined,
    p_partner_customer_id:  input.customerId ?? undefined,
    p_source_document:      input.sourceDocument ?? undefined,
    p_scheduled_at:         input.scheduledAt ?? undefined,
    p_notes:                input.notes ?? undefined,
  });
  if (error) throw error;
  const created = data as unknown as CreateOperationResult;

  if (input.salesOrderId) {
    const { error: linkErr } = await supabase
      .from('inv_operation')
      .update({ sales_order_id: input.salesOrderId })
      .eq('id', created.id);
    if (linkErr) {
      // Rule 5, and name what DID happen so the state is recoverable rather
      // than mysterious. The delivery is real; only its order link is missing.
      throw new Error(
        `Delivery ${created.number} was created, but recording its sales order failed: ` +
        `${linkErr.message}. The delivery exists and can be opened — set the sales order on it before completing.`,
      );
    }
  }

  return created;
}

/* -------------------------------------------------------- form option reads */

export interface DeliveryTypeOption {
  id: string;
  name: string;
  locks_source: boolean;
  locks_destination: boolean;
  default_source_location_id: string | null;
  default_dest_location_id: string | null;
}

/**
 * Active operation types of kind `outgoing`.
 *
 * Like a transfer type, each one IS a route — DELIVERY ORDER → CUSTOMERS. The
 * create form leads with this choice and derives both ends from it.
 */
export async function listDeliveryTypes(): Promise<DeliveryTypeOption[]> {
  const { data, error } = await supabase
    .from('inv_operation_type')
    .select('id, name, locks_source, locks_destination, default_source_location_id, default_dest_location_id')
    .eq('kind', 'outgoing')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export interface DeliveryCustomerOption {
  id: string;
  name: string;
  company: string | null;
}

/**
 * Customers for the picker, read DIRECTLY off `public.customers`.
 *
 * NOT through CustomerSelector and NOT through CRM's useContacts. Both are on
 * the SHARED BOUNDARY: CustomerSelector wraps CRM's ContactSearchCombobox, and
 * importing either would make this pass a CRM change. `customers` is
 * auto-populated from crm_contacts by trg_sync_customer_from_contact and is
 * read-mostly — reading it is precisely what it exists for, and nothing here
 * writes it or touches crm_contact_id.
 */
export async function listDeliveryCustomers(): Promise<DeliveryCustomerOption[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, company')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export interface SalesOrderOption {
  id: string;
  reference: string | null;
  customer_name: string | null;
  customer_id: string | null;
  status: string | null;
}

/**
 * Sales orders a delivery can be raised against.
 *
 * READ ONLY, and it deliberately does not filter on payment. The payment gate
 * is inert (`inv_assert_delivery_paid` raises `feature_not_supported`), so
 * hiding unpaid orders here would be a payment rule enforced by a dropdown —
 * the "gate that silently passes" failure in a different costume. Cancelled and
 * closed orders are excluded because they are not things to deliver against,
 * which is an order-lifecycle question, not a payment one.
 */
export async function listOpenSalesOrders(): Promise<SalesOrderOption[]> {
  const { data, error } = await supabase
    .from('sales_orders')
    .select('id, reference, customer_name, customer_id, status')
    .not('status', 'in', '(cancelled,closed)')
    .order('reference', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
