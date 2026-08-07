/**
 * Inventory 2 — receipt read layer.
 *
 * READ-ONLY. This module never writes: Step 4 Part 2 is a viewer. Every write
 * path in the new module goes through the sanctioned database functions
 * (inv_receive_serial / inv_transfer_stock_item / inv_record_qc_results /
 * inv_complete_receipt), and none of them is called here.
 *
 * TYPING NOTE: `src/integrations/supabase/types.ts` was regenerated from the
 * live schema once the inv_ layer was applied, so the generated client types
 * these tables directly. The row aliases below are taken from that generated
 * Database type rather than hand-written — the database is the spec, and this
 * file must not be able to drift from it.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';

type Tables = Database['public']['Tables'];
type Views = Database['public']['Views'];

type MoveRow = Tables['inv_move']['Row'];
type MoveLineRow = Tables['inv_move_line']['Row'];
type StockItemRow = Tables['inv_stock_item']['Row'];
type TrackingRow = Tables['inv_stock_tracking']['Row'];
type TestTemplateRow = Tables['inv_test_template']['Row'];
type TestResultRow = Tables['inv_test_result']['Row'];
type PurchaseOrderLineRow = Tables['inv_purchase_order_line']['Row'];
type OnHandRow = Views['inv_on_hand']['Row'];
type ProductRef = { id: string; name: string; sku: string | null };

/* ------------------------------------------------------------------ types */

export type InvOperationState = Database['public']['Enums']['inv_operation_state'];

export type InvStockStatus = Database['public']['Enums']['inv_stock_status'];

export type InvOrderState = Database['public']['Enums']['inv_order_state'];

export interface ReceiptRow {
  id: string;
  number: string;
  state: InvOperationState;
  operation_type_name: string | null;
  vendor_name: string | null;
  dest_location_name: string | null;
  source_location_name: string | null;
  scheduled_at: string | null;
  done_at: string | null;
  created_at: string;
  source_document: string | null;
  unit_count: number;
}

export interface ReceiptLine {
  move_id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  demand_qty: number;
  move_state: string;
  /** Units actually received on this move. */
  received_qty: number;
}

export interface ReceiptSerial {
  stock_item_id: string;
  move_id: string;
  /** Needed to pick the QC checklist that applies to this unit. */
  product_id: string | null;
  serial: string;
  status: InvStockStatus;
  location_name: string | null;
  cost: number;
  received_at: string | null;
}

export interface QcTemplate {
  id: string;
  product_id: string | null;
  name: string;
  description: string | null;
  is_required: boolean;
  requires_value: boolean;
  requires_attachment: boolean;
  sort_order: number;
}

export interface QcResult {
  id: string;
  seq: number;
  stock_item_id: string;
  template_id: string;
  result: boolean;
  value: string | null;
  notes: string | null;
  attachments: { name?: string; url?: string }[];
  tested_at: string;
  tested_by: string | null;
}

export interface LedgerRow {
  id: string;
  stock_item_id: string;
  serial: string;
  product_name: string | null;
  entry_type: string;
  from_location_name: string | null;
  to_location_name: string | null;
  document_type: string | null;
  document_id: string | null;
  created_at: string;
}

export interface OnHandBucket {
  location_name: string;
  status: InvStockStatus;
  qty: number;
}

export interface ReceiptDetail {
  receipt: {
    id: string;
    number: string;
    state: InvOperationState;
    operation_type_name: string | null;
    operation_type_locks_destination: boolean;
    source_location_name: string | null;
    dest_location_name: string | null;
    vendor_name: string | null;
    source_document: string | null;
    scheduled_at: string | null;
    done_at: string | null;
    created_at: string;
    created_by: string | null;
    notes: string | null;
    purchase_order_number: string | null;
    purchase_order_state: InvOrderState | null;
    ordered_qty: number | null;
    received_qty: number | null;
  };
  lines: ReceiptLine[];
  serials: ReceiptSerial[];
  templates: QcTemplate[];
  results: QcResult[];
  ledger: LedgerRow[];
  onHand: OnHandBucket[];
  /** Units in condition `ok` — the only ones counted as sellable. */
  availableQty: number;
}

/* --------------------------------------------------------------- helpers */

/** `inv_test_result.attachments` is `jsonb`; narrow it to the shape the UI reads. */
function toAttachments(value: Json): { name?: string; url?: string }[] {
  return Array.isArray(value) ? (value as { name?: string; url?: string }[]) : [];
}

/** Ids of every operation type whose kind is `receipt`. */
async function receiptTypeIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('inv_operation_type')
    .select('id')
    .eq('kind', 'receipt');
  if (error) throw error;
  return (data ?? []).map((r) => r.id);
}

async function locationIndex(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('inv_location').select('id, name, code');
  if (error) throw error;
  const m = new Map<string, string>();
  for (const l of data ?? []) m.set(l.id, l.name);
  return m;
}

/* ----------------------------------------------------------------- list */

export async function listReceipts(): Promise<ReceiptRow[]> {
  const typeIds = await receiptTypeIds();
  if (typeIds.length === 0) return [];

  const [opsRes, typesRes, locsRes, vendorsRes] = await Promise.all([
    supabase.from('inv_operation')
      .select('id, number, state, operation_type_id, source_location_id, dest_location_id, partner_vendor_id, scheduled_at, done_at, created_at, source_document')
      .in('operation_type_id', typeIds)
      .order('created_at', { ascending: false }),
    supabase.from('inv_operation_type').select('id, name'),
    supabase.from('inv_location').select('id, name'),
    supabase.from('vendors').select('id, name'),
  ]);
  if (opsRes.error) throw opsRes.error;
  if (typesRes.error) throw typesRes.error;
  if (locsRes.error) throw locsRes.error;
  if (vendorsRes.error) throw vendorsRes.error;

  const typeName = new Map<string, string>((typesRes.data ?? []).map((t) => [t.id, t.name]));
  const locName = new Map<string, string>((locsRes.data ?? []).map((l) => [l.id, l.name]));
  const vendName = new Map<string, string>((vendorsRes.data ?? []).map((v) => [v.id, v.name]));

  const ops = opsRes.data ?? [];
  if (ops.length === 0) return [];

  // Unit counts per operation, via its moves.
  const opIds = ops.map((o) => o.id);
  const { data: moves, error: mErr } = await supabase
    .from('inv_move').select('id, operation_id').in('operation_id', opIds);
  if (mErr) throw mErr;
  const moveToOp = new Map<string, string>((moves ?? []).map((m) => [m.id, m.operation_id]));

  const countByOp = new Map<string, number>();
  if ((moves ?? []).length > 0) {
    const { data: mls, error: mlErr } = await supabase
      .from('inv_move_line').select('move_id')
      .in('move_id', (moves ?? []).map((m) => m.id));
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
    vendor_name: o.partner_vendor_id ? vendName.get(o.partner_vendor_id) ?? null : null,
    dest_location_name: o.dest_location_id ? locName.get(o.dest_location_id) ?? null : null,
    source_location_name: o.source_location_id ? locName.get(o.source_location_id) ?? null : null,
    scheduled_at: o.scheduled_at,
    done_at: o.done_at,
    created_at: o.created_at,
    source_document: o.source_document,
    unit_count: countByOp.get(o.id) ?? 0,
  }));
}

/* --------------------------------------------------------------- detail */

export async function getReceiptDetail(id: string): Promise<ReceiptDetail | null> {
  const { data: op, error: opErr } = await supabase
    .from('inv_operation').select('*').eq('id', id).maybeSingle();
  if (opErr) throw opErr;
  if (!op) return null;

  const vendorId = op.partner_vendor_id;
  const poId = op.source_purchase_order_id;

  const [typeRes, locIdx, vendorRes, poRes, movesRes] = await Promise.all([
    supabase.from('inv_operation_type').select('*').eq('id', op.operation_type_id).maybeSingle(),
    locationIndex(),
    vendorId
      ? supabase.from('vendors').select('id, name').eq('id', vendorId).maybeSingle()
      : null,
    poId
      ? supabase.from('inv_purchase_order').select('*').eq('id', poId).maybeSingle()
      : null,
    supabase.from('inv_move').select('*').eq('operation_id', id),
  ]);
  if (typeRes.error) throw typeRes.error;
  if (vendorRes?.error) throw vendorRes.error;
  if (poRes?.error) throw poRes.error;
  if (movesRes.error) throw movesRes.error;

  const moves: MoveRow[] = movesRes.data ?? [];
  const moveIds = moves.map((m) => m.id);
  const productIds = [...new Set(moves.map((m) => m.product_id))];

  const [mlRes, prodRes, poLineRes] = await Promise.all([
    moveIds.length
      ? supabase.from('inv_move_line').select('*').in('move_id', moveIds)
      : null,
    productIds.length
      ? supabase.from('products').select('id, name, sku').in('id', productIds)
      : null,
    poId
      ? supabase.from('inv_purchase_order_line').select('*').eq('order_id', poId)
      : null,
  ]);
  if (mlRes?.error) throw mlRes.error;
  if (prodRes?.error) throw prodRes.error;
  if (poLineRes?.error) throw poLineRes.error;

  const moveLines: MoveLineRow[] = mlRes?.data ?? [];
  const stockItemIds = [...new Set(moveLines.map((l) => l.stock_item_id))];

  const [itemRes, tmplRes, resRes, trackRes] = await Promise.all([
    stockItemIds.length
      ? supabase.from('inv_stock_item').select('*').in('id', stockItemIds)
      : null,
    productIds.length
      ? supabase.from('inv_test_template').select('*').or(
          `product_id.in.(${productIds.join(',')}),product_id.is.null`)
      : null,
    stockItemIds.length
      ? supabase.from('inv_test_result').select('*').in('stock_item_id', stockItemIds).order('seq')
      : null,
    stockItemIds.length
      ? supabase.from('inv_stock_tracking').select('*').in('stock_item_id', stockItemIds).order('created_at')
      : null,
  ]);
  if (itemRes?.error) throw itemRes.error;
  if (tmplRes?.error) throw tmplRes.error;
  if (resRes?.error) throw resRes.error;
  if (trackRes?.error) throw trackRes.error;

  const templateRows: TestTemplateRow[] = tmplRes?.data ?? [];
  const resultRows: TestResultRow[] = resRes?.data ?? [];
  const trackingRows: TrackingRow[] = trackRes?.data ?? [];

  const prodName = new Map<string, ProductRef>(
    (prodRes?.data ?? []).map((p) => [p.id, p]));
  const itemById = new Map<string, StockItemRow>(
    (itemRes?.data ?? []).map((s) => [s.id, s]));

  const receivedByMove = new Map<string, number>();
  for (const l of moveLines) {
    receivedByMove.set(l.move_id, (receivedByMove.get(l.move_id) ?? 0) + 1);
  }

  const lines: ReceiptLine[] = moves.map((m) => ({
    move_id: m.id,
    product_id: m.product_id,
    product_name: prodName.get(m.product_id)?.name ?? null,
    product_sku: prodName.get(m.product_id)?.sku ?? null,
    demand_qty: Number(m.demand_qty ?? 0),
    move_state: m.state,
    received_qty: receivedByMove.get(m.id) ?? 0,
  }));

  const serials: ReceiptSerial[] = moveLines.map((l) => {
    const it = itemById.get(l.stock_item_id);
    return {
      stock_item_id: l.stock_item_id,
      move_id: l.move_id,
      product_id: it?.product_id ?? null,
      serial: it?.serial ?? '—',
      status: it?.status ?? 'quarantined',
      location_name: it?.location_id ? locIdx.get(it.location_id) ?? null : null,
      cost: Number(it?.cost ?? 0),
      received_at: it?.received_at ?? null,
    };
  }).sort((a, b) => a.serial.localeCompare(b.serial));

  const ledger: LedgerRow[] = trackingRows.map((t) => {
    const it = itemById.get(t.stock_item_id);
    return {
      id: t.id,
      stock_item_id: t.stock_item_id,
      serial: it?.serial ?? '—',
      product_name: it ? prodName.get(it.product_id)?.name ?? null : null,
      entry_type: t.entry_type,
      from_location_name: t.from_location_id ? locIdx.get(t.from_location_id) ?? null : null,
      to_location_name: t.to_location_id ? locIdx.get(t.to_location_id) ?? null : null,
      document_type: t.document_type,
      document_id: t.document_id,
      created_at: t.created_at,
    };
  });

  // On-hand for the products on this receipt, from the live view.
  const onHandRes = productIds.length
    ? await supabase.from('inv_on_hand').select('*').in('product_id', productIds)
    : null;
  if (onHandRes?.error) throw onHandRes.error;
  const onHandRows: OnHandRow[] = onHandRes?.data ?? [];

  const onHand: OnHandBucket[] = onHandRows.map((r) => ({
    location_name: (r.location_id ? locIdx.get(r.location_id) : null) ?? '—',
    status: r.status ?? 'quarantined',
    qty: Number(r.qty ?? 0),
  })).sort((a, b) =>
    a.location_name.localeCompare(b.location_name) || a.status.localeCompare(b.status));

  const availableQty = onHand
    .filter((b) => b.status === 'ok')
    .reduce((s, b) => s + b.qty, 0);

  const poLine: PurchaseOrderLineRow | null = (poLineRes?.data ?? [])[0] ?? null;
  const type = typeRes.data ?? null;

  return {
    receipt: {
      id: op.id,
      number: op.number,
      state: op.state,
      operation_type_name: type?.name ?? null,
      operation_type_locks_destination: !!type?.locks_destination,
      source_location_name: op.source_location_id ? locIdx.get(op.source_location_id) ?? null : null,
      dest_location_name: op.dest_location_id ? locIdx.get(op.dest_location_id) ?? null : null,
      vendor_name: vendorRes?.data?.name ?? null,
      source_document: op.source_document,
      scheduled_at: op.scheduled_at,
      done_at: op.done_at,
      created_at: op.created_at,
      created_by: op.created_by,
      notes: op.notes,
      purchase_order_number: poRes?.data?.number ?? null,
      purchase_order_state: (poRes?.data?.state ?? null) as InvOrderState | null,
      ordered_qty: poLine ? Number(poLine.ordered_qty) : null,
      received_qty: poLine ? Number(poLine.received_qty) : null,
    },
    lines,
    serials,
    templates: [...templateRows].sort((a, b) => a.sort_order - b.sort_order),
    results: resultRows.map((r) => ({
      ...r,
      attachments: toAttachments(r.attachments),
    })),
    ledger,
    onHand,
    availableQty,
  };
}
