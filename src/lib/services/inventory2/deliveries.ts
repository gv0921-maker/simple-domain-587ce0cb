/**
 * Inventory 2 — outgoing DELIVERY read layer. Sibling to `transfers.ts`.
 *
 * READ-ONLY. Every write goes through `deliveryWrites.ts`, which calls only
 * sanctioned RPCs. inv_stock_item, inv_move_line and inv_stock_tracking are
 * never written from anywhere in this module.
 *
 * ── WHAT A DELIVERY IS ────────────────────────────────────────────────────
 * Units leaving the building: DELIVERY ORDER → CUSTOMERS. It is the third
 * document type on inv_operation and the first whose destination is outside
 * our own stock, which is what makes the two notes below matter.
 *
 * ── ONE CUSTOMERS NODE. PLACE AND PARTY ARE DIFFERENT QUESTIONS ───────────
 * There is a SINGLE `CUSTOMERS` location (type `customer`, code CTMR107) and
 * every delivery ends there. It is deliberately not one node per customer.
 *
 *   the ledger records PLACE   inv_stock_tracking.to_location_id says the unit
 *                              left our stock. That is a fact about geography.
 *   the document records PARTY  inv_operation.partner_customer_id says WHO
 *                              received it. That is a fact about the sale.
 *
 * So "which customer has this unit" is answered by joining the unit's move line
 * to its operation and reading the partner — not by reading the location. A
 * location-per-customer would encode the party into the place, and then every
 * on-hand query would have to know which locations are "really" customers. The
 * on-hand readers already filter to `internal` and the CUSTOMERS node is
 * excluded by that alone; see CLAUDE.md.
 *
 * ── NO RESERVATIONS ON THIS PASS ──────────────────────────────────────────
 * `inv_stock_item.reserved_for_customer_id` stays UNWRITTEN. A delivery here
 * moves units that are already picked; it does not claim them in advance.
 * Reading the column is fine, writing it is a later pass, and half-writing it
 * would give the Sales module a reservation surface that only sometimes exists.
 *
 * ── WHY THIS IS NOT `transfers.ts` WITH A DIFFERENT FILTER ────────────────
 * A delivery carries two things a transfer has no column for:
 *
 *   the customer      partner_customer_id, joined to `customers` DIRECTLY.
 *                     Not through CustomerSelector — that component wraps CRM's
 *                     ContactSearchCombobox and sits on the SHARED BOUNDARY.
 *   the sales order   sales_order_id, added by the payment-gate migration. The
 *                     delivery RECORDS which order it is for even though
 *                     nothing verifies payment yet.
 *
 * And, as with a transfer: no QC. `requires_qc` stays false on outgoing for
 * exactly the reason it stays false on internal — inv_test_result has no
 * operation_id, so running QC from here would overwrite the receipt's verdict
 * for that unit. CLAUDE.md. The Quality segment is not adopted.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Tables = Database['public']['Tables'];
type MoveRow = Tables['inv_move']['Row'];
type MoveLineRow = Tables['inv_move_line']['Row'];
type StockItemRow = Tables['inv_stock_item']['Row'];
type TrackingRow = Tables['inv_stock_tracking']['Row'];
type ProductRef = { id: string; name: string; sku: string | null };

export type InvOperationState = Database['public']['Enums']['inv_operation_state'];
export type InvStockStatus = Database['public']['Enums']['inv_stock_status'];

/* ------------------------------------------------------------------ types */

export interface DeliveryRow {
  id: string;
  number: string;
  state: InvOperationState;
  operation_type_name: string | null;
  source_location_name: string | null;
  dest_location_name: string | null;
  /** WHO received it — from partner_customer_id, never from the location. */
  customer_name: string | null;
  /** The order this delivery is against, when there is one. */
  sales_order_reference: string | null;
  scheduled_at: string | null;
  done_at: string | null;
  created_at: string;
  source_document: string | null;
  unit_count: number;
  demand_qty: number;
}

export interface DeliveryLine {
  move_id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  demand_qty: number;
  move_state: string;
  /** Units shipped onto this line. */
  shipped_qty: number;
}

export interface DeliveryUnit {
  stock_item_id: string;
  move_id: string;
  product_id: string | null;
  serial: string;
  status: InvStockStatus;
  /** Where the unit is NOW — after a completed delivery, CUSTOMERS. */
  location_name: string | null;
  /** Where this unit actually started, from inv_move_line, not the document. */
  from_location_name: string | null;
  to_location_name: string | null;
  done_at: string | null;
}

export interface DeliveryLedgerRow {
  id: string;
  stock_item_id: string;
  serial: string;
  product_name: string | null;
  entry_type: string;
  from_location_name: string | null;
  to_location_name: string | null;
  created_at: string;
}

export interface DeliveryUnitBucket {
  location_name: string;
  status: InvStockStatus;
  qty: number;
}

/** The order this delivery cites, read for display only. */
export interface DeliverySalesOrder {
  id: string;
  reference: string | null;
  customer_name: string | null;
  status: string | null;
  /**
   * Read and shown, NOT acted on. The payment gate
   * (`inv_assert_delivery_paid`) is inert until Sales is rebuilt, so these
   * figures are not maintained and must never be presented as a payment
   * verdict. The delivery page says so in words.
   */
  total: number;
  paid_amount: number;
}

export interface DeliveryDetail {
  delivery: {
    id: string;
    number: string;
    state: InvOperationState;
    operation_type_id: string;
    operation_type_name: string | null;
    operation_type_locks_source: boolean;
    operation_type_locks_destination: boolean;
    source_location_name: string | null;
    dest_location_name: string | null;
    customer_id: string | null;
    customer_name: string | null;
    sales_order_id: string | null;
    source_document: string | null;
    scheduled_at: string | null;
    done_at: string | null;
    created_at: string;
    created_by: string | null;
    notes: string | null;
  };
  salesOrder: DeliverySalesOrder | null;
  lines: DeliveryLine[];
  units: DeliveryUnit[];
  ledger: DeliveryLedgerRow[];
  unitBuckets: DeliveryUnitBucket[];
}

/* --------------------------------------------------------------- helpers */

/** Ids of every operation type whose kind is `outgoing`. */
async function outgoingTypeIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('inv_operation_type')
    .select('id')
    .eq('kind', 'outgoing');
  if (error) throw error;
  return (data ?? []).map((r) => r.id);
}

async function locationIndex(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('inv_location').select('id, name');
  if (error) throw error;
  return new Map((data ?? []).map((l) => [l.id, l.name]));
}

/* ----------------------------------------------------------------- list */

export async function listDeliveries(): Promise<DeliveryRow[]> {
  const typeIds = await outgoingTypeIds();
  if (typeIds.length === 0) return [];

  const [opsRes, typesRes, locsRes] = await Promise.all([
    supabase.from('inv_operation')
      .select('id, number, state, operation_type_id, source_location_id, dest_location_id, partner_customer_id, sales_order_id, scheduled_at, done_at, created_at, source_document')
      .in('operation_type_id', typeIds)
      .order('created_at', { ascending: false }),
    supabase.from('inv_operation_type').select('id, name'),
    supabase.from('inv_location').select('id, name'),
  ]);
  if (opsRes.error) throw opsRes.error;
  if (typesRes.error) throw typesRes.error;
  if (locsRes.error) throw locsRes.error;

  const ops = opsRes.data ?? [];
  if (ops.length === 0) return [];

  const typeName = new Map((typesRes.data ?? []).map((t) => [t.id, t.name]));
  const locName = new Map((locsRes.data ?? []).map((l) => [l.id, l.name]));

  // The party, joined directly off `customers`. Only the ids this page needs.
  const customerIds = [...new Set(ops.map((o) => o.partner_customer_id).filter(Boolean))] as string[];
  const salesOrderIds = [...new Set(ops.map((o) => o.sales_order_id).filter(Boolean))] as string[];

  const [custRes, soRes, movesRes] = await Promise.all([
    customerIds.length
      ? supabase.from('customers').select('id, name').in('id', customerIds)
      : null,
    salesOrderIds.length
      ? supabase.from('sales_orders').select('id, reference').in('id', salesOrderIds)
      : null,
    supabase.from('inv_move').select('id, operation_id, demand_qty')
      .in('operation_id', ops.map((o) => o.id)),
  ]);
  if (custRes?.error) throw custRes.error;
  if (soRes?.error) throw soRes.error;
  if (movesRes.error) throw movesRes.error;

  const custName = new Map((custRes?.data ?? []).map((c) => [c.id, c.name]));
  const soRef = new Map((soRes?.data ?? []).map((s) => [s.id, s.reference]));
  const moves = movesRes.data ?? [];

  const moveToOp = new Map(moves.map((m) => [m.id, m.operation_id]));
  const demandByOp = new Map<string, number>();
  for (const m of moves) {
    demandByOp.set(m.operation_id, (demandByOp.get(m.operation_id) ?? 0) + Number(m.demand_qty ?? 0));
  }

  const countByOp = new Map<string, number>();
  if (moves.length > 0) {
    const { data: mls, error: mlErr } = await supabase
      .from('inv_move_line').select('move_id')
      .in('move_id', moves.map((m) => m.id));
    if (mlErr) throw mlErr;
    for (const ml of mls ?? []) {
      const opId = moveToOp.get(ml.move_id);
      if (opId) countByOp.set(opId, (countByOp.get(opId) ?? 0) + 1);
    }
  }

  return ops.map((o) => ({
    id: o.id,
    number: o.number,
    state: o.state,
    operation_type_name: typeName.get(o.operation_type_id) ?? null,
    source_location_name: o.source_location_id ? locName.get(o.source_location_id) ?? null : null,
    dest_location_name: o.dest_location_id ? locName.get(o.dest_location_id) ?? null : null,
    customer_name: o.partner_customer_id ? custName.get(o.partner_customer_id) ?? null : null,
    sales_order_reference: o.sales_order_id ? soRef.get(o.sales_order_id) ?? null : null,
    scheduled_at: o.scheduled_at,
    done_at: o.done_at,
    created_at: o.created_at,
    source_document: o.source_document,
    unit_count: countByOp.get(o.id) ?? 0,
    demand_qty: demandByOp.get(o.id) ?? 0,
  }));
}

/* --------------------------------------------------------------- detail */

export async function getDeliveryDetail(id: string): Promise<DeliveryDetail | null> {
  const { data: op, error: opErr } = await supabase
    .from('inv_operation').select('*').eq('id', id).maybeSingle();
  if (opErr) throw opErr;
  if (!op) return null;

  const [typeRes, locIdx, movesRes, custRes, soRes] = await Promise.all([
    supabase.from('inv_operation_type').select('*').eq('id', op.operation_type_id).maybeSingle(),
    locationIndex(),
    supabase.from('inv_move').select('*').eq('operation_id', id),
    op.partner_customer_id
      ? supabase.from('customers').select('id, name').eq('id', op.partner_customer_id).maybeSingle()
      : null,
    op.sales_order_id
      ? supabase.from('sales_orders')
          .select('id, reference, customer_name, status, total, grand_total, paid_amount')
          .eq('id', op.sales_order_id).maybeSingle()
      : null,
  ]);
  if (typeRes.error) throw typeRes.error;
  if (movesRes.error) throw movesRes.error;
  if (custRes?.error) throw custRes.error;
  if (soRes?.error) throw soRes.error;

  const type = typeRes.data;
  const moves: MoveRow[] = movesRes.data ?? [];
  const moveIds = moves.map((m) => m.id);
  const productIds = [...new Set(moves.map((m) => m.product_id))];

  const [mlRes, prodRes] = await Promise.all([
    moveIds.length ? supabase.from('inv_move_line').select('*').in('move_id', moveIds) : null,
    productIds.length
      ? supabase.from('products').select('id, name, sku').in('id', productIds)
      : null,
  ]);
  if (mlRes?.error) throw mlRes.error;
  if (prodRes?.error) throw prodRes.error;

  const moveLines: MoveLineRow[] = mlRes?.data ?? [];
  const stockItemIds = [...new Set(moveLines.map((l) => l.stock_item_id))];

  const [itemRes, trackRes] = await Promise.all([
    stockItemIds.length
      ? supabase.from('inv_stock_item').select('*').in('id', stockItemIds)
      : null,
    // Scoped to THIS document, same reason as the transfer page: a unit's full
    // history spans every document it touched, and showing all of it here would
    // credit this delivery with movements it did not perform.
    supabase.from('inv_stock_tracking').select('*')
      .eq('document_type', 'inv_operation')
      .eq('document_id', id)
      .order('created_at'),
  ]);
  if (itemRes?.error) throw itemRes.error;
  if (trackRes.error) throw trackRes.error;

  const trackingRows: TrackingRow[] = trackRes.data ?? [];
  const prodName = new Map<string, ProductRef>((prodRes?.data ?? []).map((p) => [p.id, p]));
  const itemById = new Map<string, StockItemRow>((itemRes?.data ?? []).map((s) => [s.id, s]));

  const shippedByMove = new Map<string, number>();
  for (const l of moveLines) {
    shippedByMove.set(l.move_id, (shippedByMove.get(l.move_id) ?? 0) + 1);
  }

  const lines: DeliveryLine[] = moves.map((m) => ({
    move_id: m.id,
    product_id: m.product_id,
    product_name: prodName.get(m.product_id)?.name ?? null,
    product_sku: prodName.get(m.product_id)?.sku ?? null,
    demand_qty: Number(m.demand_qty ?? 0),
    move_state: m.state,
    shipped_qty: shippedByMove.get(m.id) ?? 0,
  })).sort((a, b) => (a.product_name ?? '').localeCompare(b.product_name ?? ''));

  const units: DeliveryUnit[] = moveLines.map((l) => {
    const it = itemById.get(l.stock_item_id);
    return {
      stock_item_id: l.stock_item_id,
      move_id: l.move_id,
      product_id: it?.product_id ?? null,
      serial: it?.serial ?? '—',
      status: it?.status ?? 'quarantined',
      location_name: it?.location_id ? locIdx.get(it.location_id) ?? null : null,
      // From the move LINE — where this unit actually was, not the document's
      // source. See the rule at the top of scan.ts.
      from_location_name: l.from_location_id ? locIdx.get(l.from_location_id) ?? null : null,
      to_location_name: l.to_location_id ? locIdx.get(l.to_location_id) ?? null : null,
      done_at: l.done_at,
    };
  }).sort((a, b) => a.serial.localeCompare(b.serial));

  const ledger: DeliveryLedgerRow[] = trackingRows.map((t) => {
    const it = itemById.get(t.stock_item_id);
    return {
      id: t.id,
      stock_item_id: t.stock_item_id,
      serial: it?.serial ?? '—',
      product_name: it ? prodName.get(it.product_id)?.name ?? null : null,
      entry_type: t.entry_type,
      from_location_name: t.from_location_id ? locIdx.get(t.from_location_id) ?? null : null,
      to_location_name: t.to_location_id ? locIdx.get(t.to_location_id) ?? null : null,
      created_at: t.created_at,
    };
  });

  const buckets = new Map<string, DeliveryUnitBucket>();
  for (const u of units) {
    const location = u.location_name ?? '—';
    const key = `${location} ${u.status}`;
    const existing = buckets.get(key);
    if (existing) existing.qty += 1;
    else buckets.set(key, { location_name: location, status: u.status, qty: 1 });
  }

  const so = soRes?.data ?? null;

  return {
    delivery: {
      id: op.id,
      number: op.number,
      state: op.state,
      operation_type_id: op.operation_type_id,
      operation_type_name: type?.name ?? null,
      operation_type_locks_source: !!type?.locks_source,
      operation_type_locks_destination: !!type?.locks_destination,
      source_location_name: op.source_location_id ? locIdx.get(op.source_location_id) ?? null : null,
      dest_location_name: op.dest_location_id ? locIdx.get(op.dest_location_id) ?? null : null,
      customer_id: op.partner_customer_id,
      customer_name: custRes?.data?.name ?? null,
      sales_order_id: op.sales_order_id,
      source_document: op.source_document,
      scheduled_at: op.scheduled_at,
      done_at: op.done_at,
      created_at: op.created_at,
      created_by: op.created_by,
      notes: op.notes,
    },
    salesOrder: so
      ? {
          id: so.id,
          reference: so.reference,
          customer_name: so.customer_name,
          status: so.status,
          // COALESCE(grand_total, total) — the same expression the inert gate
          // will use, so the screen and the gate cannot show different figures.
          total: Number(so.grand_total ?? so.total ?? 0),
          paid_amount: Number(so.paid_amount ?? 0),
        }
      : null,
    lines,
    units,
    ledger,
    unitBuckets: [...buckets.values()].sort((a, b) =>
      a.location_name.localeCompare(b.location_name) || a.status.localeCompare(b.status)),
  };
}
