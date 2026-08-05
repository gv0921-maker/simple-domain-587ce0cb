import { supabase } from '@/integrations/supabase/client';
import { db } from '@/integrations/supabase/db';
import { logStatusChange, logRecordCreated, logFieldChange } from '@/lib/services/activityLog';

const sb = db;

export type GRSourceType = 'vendor_order' | 'work_order' | 'manual' | 'return';
export type GRStatus = 'draft' | 'quantity_pending' | 'labels_pending' | 'qc_pending' | 'completed' | 'cancelled';
export type GRDiscrepancyStatus = 'matched' | 'quantity_mismatch' | 'product_mismatch' | 'both_mismatch';
export type GRSerialStockStatus = 'pending' | 'available' | 'under_correction' | 'rejected' | 'reserved' | 'sold';
export type GRSerialQCStatus = 'pending' | 'passed' | 'failed';

export interface GoodsReceipt {
  id: string;
  gr_number: string;
  source_type: GRSourceType;
  source_document_id: string | null;
  source_document_reference: string | null;
  status: GRStatus;
  discrepancy_status: GRDiscrepancyStatus;
  discrepancy_approved_by: string | null;
  discrepancy_approved_at: string | null;
  discrepancy_reason: string | null;
  labels_generated: boolean;
  labels_generated_at: string | null;
  warehouse_id: string | null;
  /** Which operation type this receipt belongs to; drives numbering and routing. */
  operation_type_id: string | null;
  /**
   * Derived from the operation type's defaults at creation by
   * trg_gr_fill_default_locations, then fixed. Editing the operation type later
   * does not move an existing receipt.
   */
  source_location_id: string | null;
  dest_location_id: string | null;
  received_by: string | null;
  received_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoodsReceiptLine {
  id: string;
  goods_receipt_id: string;
  product_id: string;
  product_name_cached: string | null;
  product_sku_cached: string | null;
  expected_quantity: number;
  received_quantity: number;
  accepted_quantity: number;
  under_correction_quantity: number;
  rejected_quantity: number;
  source_line_id: string | null;
  notes: string | null;
}

export interface GoodsReceiptSerial {
  id: string;
  goods_receipt_id: string;
  goods_receipt_line_id: string;
  product_id: string;
  serial_number: string;
  barcode_value: string;
  qc_status: GRSerialQCStatus;
  qc_notes: string | null;
  qc_images: string[];
  qc_checked_by: string | null;
  qc_checked_at: string | null;
  stock_status: GRSerialStockStatus;
  current_warehouse_id: string | null;
  current_location: string | null;
}

export interface CreateGRLineInput {
  product_id: string;
  product_name?: string;
  product_sku?: string;
  expected_quantity: number;
  received_quantity?: number;
  source_line_id?: string | null;
  notes?: string | null;
}

async function uid(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function listGoodsReceipts(): Promise<GoodsReceipt[]> {
  const { data, error } = await sb.from('goods_receipts').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as GoodsReceipt[];
}

export async function getGoodsReceipt(id: string): Promise<GoodsReceipt | null> {
  const { data, error } = await sb.from('goods_receipts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as GoodsReceipt | null;
}

export async function getGoodsReceiptLines(grId: string): Promise<GoodsReceiptLine[]> {
  const { data, error } = await sb.from('goods_receipt_lines').select('*').eq('goods_receipt_id', grId).order('created_at');
  if (error) throw error;
  return (data ?? []) as GoodsReceiptLine[];
}

export async function getGoodsReceiptSerials(grId: string): Promise<GoodsReceiptSerial[]> {
  const { data, error } = await sb.from('goods_receipt_serials').select('*').eq('goods_receipt_id', grId).order('serial_number');
  if (error) throw error;
  return (data ?? []) as GoodsReceiptSerial[];
}

/**
 * One ledger row per serial that this receipt moved into stock.
 *
 * Written by the QC RPCs (`record_gr_item_qc` / `complete_gr_line_qc`), which
 * tag every move with `reference_document_type = 'goods_receipt'` and the GR id
 * — so this is the receipt's own slice of `stock_moves`, not a guess by
 * reference-string matching.
 *
 * Feeds both the Moves and the Traceability views on the detail page; they are
 * two presentations of the same rows, so they share one fetch.
 */
export interface GoodsReceiptMoveLine {
  move_id: string;
  reference: string | null;
  state: string | null;
  scheduled_date: string | null;
  effective_date: string | null;
  source_location_name: string | null;
  destination_location_name: string | null;
  line_id: string;
  product_id: string | null;
  product_name: string | null;
  product_sku: string | null;
  serial_numbers: string[];
  done_qty: number;
  unit_of_measure: string | null;
}

/** Shape of the nested select below — the generated client does not infer it. */
interface StockMoveLineRow {
  id: string;
  product_id: string | null;
  product_name: string | null;
  product_sku: string | null;
  serial_numbers: string[] | null;
  done_qty: number | string | null;
  unit_of_measure: string | null;
}

interface StockMoveRow {
  id: string;
  reference: string | null;
  state: string | null;
  scheduled_date: string | null;
  effective_date: string | null;
  source_location_name: string | null;
  destination_location_name: string | null;
  created_at: string | null;
  stock_move_lines: StockMoveLineRow[] | null;
}

export async function getGoodsReceiptMoves(grId: string): Promise<GoodsReceiptMoveLine[]> {
  const { data, error } = await sb
    .from('stock_moves')
    .select('id, reference, state, scheduled_date, effective_date, source_location_name, destination_location_name, created_at, stock_move_lines(*)')
    .eq('reference_document_type', 'goods_receipt')
    .eq('reference_document_id', grId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const out: GoodsReceiptMoveLine[] = [];
  for (const m of (data ?? []) as unknown as StockMoveRow[]) {
    for (const l of m.stock_move_lines ?? []) {
      out.push({
        move_id: m.id,
        reference: m.reference ?? null,
        state: m.state ?? null,
        // `effective_date` is null on GR-QC moves; created_at is the real stamp.
        scheduled_date: m.scheduled_date ?? m.created_at ?? null,
        effective_date: m.effective_date ?? null,
        source_location_name: m.source_location_name ?? null,
        destination_location_name: m.destination_location_name ?? null,
        line_id: l.id,
        product_id: l.product_id ?? null,
        product_name: l.product_name ?? null,
        product_sku: l.product_sku ?? null,
        serial_numbers: Array.isArray(l.serial_numbers) ? l.serial_numbers : [],
        done_qty: Number(l.done_qty ?? 0),
        unit_of_measure: l.unit_of_measure ?? null,
      });
    }
  }
  return out;
}

export async function getGoodsReceiptWithSerials(grId: string) {
  const [gr, lines, serials] = await Promise.all([
    getGoodsReceipt(grId),
    getGoodsReceiptLines(grId),
    getGoodsReceiptSerials(grId),
  ]);
  return { gr, lines, serials };
}

export interface CreateGoodsReceiptInput {
  source_type: GRSourceType;
  source_document_id?: string | null;
  source_document_reference?: string | null;
  warehouse_id?: string | null;
  notes?: string | null;
  /**
   * Which operation type this receipt belongs to.
   *
   * Must be supplied by the caller — a trigger cannot invent it, and
   * `trg_gr_set_number` needs it on NEW to number the receipt. Once present it
   * drives two things in the database:
   *   * numbering, if that operation type has owns_sequence = true
   *   * source/dest locations, via trg_gr_fill_default_locations
   *
   * Left NULL, the receipt numbers from the global sequence and gets no
   * locations, which is exactly how every receipt behaved before this.
   */
  operation_type_id?: string | null;
  lines: CreateGRLineInput[];
}

export async function createGoodsReceipt(input: CreateGoodsReceiptInput): Promise<GoodsReceipt> {
  const me = await uid();
  // source_location_id / dest_location_id are deliberately NOT sent: the
  // BEFORE INSERT trigger derives them from the operation type. Sending an
  // explicit value would override that, which is the intended mechanism for the
  // future super-admin override but is not something this path should do.
  const { data: gr, error } = await sb.from('goods_receipts').insert({
    source_type: input.source_type,
    source_document_id: input.source_document_id ?? null,
    source_document_reference: input.source_document_reference ?? null,
    warehouse_id: input.warehouse_id ?? null,
    operation_type_id: input.operation_type_id ?? null,
    notes: input.notes ?? null,
    status: 'quantity_pending',
    created_by: me,
  }).select('*').single();
  if (error) throw error;

  if (input.lines.length) {
    const rows = input.lines.map(l => ({
      goods_receipt_id: gr.id,
      product_id: l.product_id,
      product_name_cached: l.product_name ?? null,
      product_sku_cached: l.product_sku ?? null,
      expected_quantity: Math.max(0, Math.floor(l.expected_quantity)),
      received_quantity: Math.max(0, Math.floor(l.received_quantity ?? l.expected_quantity)),
      source_line_id: l.source_line_id ?? null,
      notes: l.notes ?? null,
    }));
    const { error: lerr } = await sb.from('goods_receipt_lines').insert(rows);
    if (lerr) throw lerr;
  }

  try {
    await logRecordCreated('goods_receipt', gr.id);
  } catch { /* noop */ }
  return gr as GoodsReceipt;
}

export async function updateReceivedQuantities(
  grId: string,
  lineUpdates: Array<{ id: string; received_quantity: number }>,
): Promise<{ discrepancy: GRDiscrepancyStatus }> {
  for (const u of lineUpdates) {
    const { error } = await sb.from('goods_receipt_lines')
      .update({ received_quantity: Math.max(0, Math.floor(u.received_quantity)) })
      .eq('id', u.id);
    if (error) throw error;
  }
  const lines = await getGoodsReceiptLines(grId);
  let qtyMismatch = false;
  for (const l of lines) {
    if (l.received_quantity !== l.expected_quantity) qtyMismatch = true;
  }
  const discrepancy: GRDiscrepancyStatus = qtyMismatch ? 'quantity_mismatch' : 'matched';
  await sb.from('goods_receipts').update({ discrepancy_status: discrepancy }).eq('id', grId);
  return { discrepancy };
}

export async function approveDiscrepancy(grId: string, reason: string): Promise<void> {
  const me = await uid();
  const { error } = await sb.from('goods_receipts').update({
    discrepancy_approved_by: me,
    discrepancy_approved_at: new Date().toISOString(),
    discrepancy_reason: reason,
    status: 'labels_pending',
  }).eq('id', grId);
  if (error) throw error;
  try { await logFieldChange('goods_receipt', grId, 'discrepancy_approved', null, reason); } catch { /* noop */ }
}

export async function advanceToLabelsStep(grId: string): Promise<void> {
  const { error } = await sb.from('goods_receipts').update({ status: 'labels_pending' }).eq('id', grId);
  if (error) throw error;
  try { await logStatusChange('goods_receipt', grId, 'quantity_pending', 'labels_pending'); } catch { /* noop */ }
}

/**
 * Cancel a receipt — a plain status write, no RPC and no schema change.
 *
 * `cancelled` is already a member of GRStatus and the UPDATE passes the
 * `gr_update_warehouse` RLS policy (`can_write_inventory()`); the
 * `enforce_gr_discrepancy_approval` trigger only guards
 * `discrepancy_approved_by`, so a status-only write is unaffected.
 *
 * Deliberately refuses once the receipt is `completed`: completion has already
 * written stock-ledger rows, and flipping the status afterwards would leave
 * those moves orphaned against a cancelled document. Reversing a completed
 * receipt is a Return, which has no backend support yet — see the header
 * actions in GoodsReceiptDetail.tsx.
 */
export async function cancelGoodsReceipt(grId: string): Promise<void> {
  const current = await getGoodsReceipt(grId);
  if (!current) throw new Error(`Goods receipt ${grId} not found`);
  if (current.status === 'completed') {
    throw new Error(
      'This goods receipt is already completed and cannot be cancelled — its stock moves have been posted. Use a Return to reverse it.',
    );
  }
  if (current.status === 'cancelled') return;

  const { error } = await sb
    .from('goods_receipts')
    .update({ status: 'cancelled' })
    .eq('id', grId);
  if (error) throw error;
  try { await logStatusChange('goods_receipt', grId, current.status, 'cancelled'); } catch { /* noop */ }
}

export async function generateSerialsForLine(grLineId: string): Promise<string[]> {
  const { data, error } = await sb.rpc('generate_serials_for_gr_line', { p_gr_line_id: grLineId });
  if (error) throw error;
  return (data ?? []) as string[];
}

export async function markLabelsGenerated(grId: string): Promise<void> {
  const { error } = await sb.from('goods_receipts').update({
    labels_generated: true,
    labels_generated_at: new Date().toISOString(),
    status: 'qc_pending',
  }).eq('id', grId);
  if (error) throw error;
  try { await logStatusChange('goods_receipt', grId, 'labels_pending', 'qc_pending'); } catch { /* noop */ }
}

export async function recordItemQC(
  serialId: string,
  passed: boolean,
  notes?: string,
  images?: string[],
): Promise<void> {
  // Atomic: updates goods_receipt_serials AND writes a stock_moves row
  // (VENDORS → receipt location, reference_document_type 'goods_receipt')
  // in a single Postgres transaction.
  const { error } = await sb.rpc('record_gr_item_qc', {
    _serial_id: serialId,
    _passed: passed,
    _notes: notes ?? null,
    _images: images ?? [],
  });
  if (error) throw new Error(error.message);
  void uid; // keep import used elsewhere
}

export async function completeGRLineQC(
  grLineId: string,
  passedSerialIds: string[],
  failedSerialIds: string[],
  failedNotes?: string,
): Promise<void> {
  const { error } = await sb.rpc('complete_gr_line_qc', {
    p_gr_line_id: grLineId,
    p_passed_serial_ids: passedSerialIds,
    p_failed_serial_ids: failedSerialIds,
    p_failed_notes: failedNotes ?? null,
  });
  if (error) throw error;
}

export async function uploadQCImage(grId: string, serialId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `qc/${grId}/${serialId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('qc-images').upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  const { data } = supabase.storage.from('qc-images').getPublicUrl(path);
  return data.publicUrl;
}