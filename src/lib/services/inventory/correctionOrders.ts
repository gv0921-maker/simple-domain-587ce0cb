import { supabase } from '@/integrations/supabase/client';
import { addToScanQueue } from '@/lib/services/barcode/api';
import { logStatusChange, logRecordCreated, logFieldChange } from '@/lib/services/activityLog';

const sb = supabase as any;

export type COStatus = 'draft' | 'sent' | 'in_progress' | 'completed' | 'closed' | 'cancelled';
export type COSourceType = 'goods_receipt' | 'return' | 'manual';
export type COCorrectionType = 'replace' | 'exchange' | 'repair' | 'refund';
export type COAddressedToType = 'vendor' | 'factory';
export type COItemStatus =
  | 'awaiting_correction'
  | 'returned_to_vendor'
  | 'received_back'
  | 'qc_passed'
  | 'qc_failed_again'
  | 'refunded_by_vendor'
  | 'closed';

export interface CorrectionOrder {
  id: string;
  co_number: string;
  source_type: COSourceType;
  source_document_id: string | null;
  source_document_reference: string | null;
  addressed_to_type: COAddressedToType;
  addressed_to_id: string | null;
  addressed_to_name: string | null;
  correction_type: COCorrectionType;
  status: COStatus;
  notes: string | null;
  sent_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CorrectionOrderItem {
  id: string;
  correction_order_id: string;
  goods_receipt_serial_id: string;
  product_id: string;
  serial_number: string;
  original_qc_notes: string | null;
  original_qc_images: string[];
  latest_qc_status: 'pending' | 'passed' | 'failed';
  latest_qc_cycle: number;
  current_status: COItemStatus;
  notes: string | null;
}

export interface CorrectionQCCycle {
  id: string;
  correction_order_item_id: string;
  cycle_number: number;
  qc_status: 'passed' | 'failed';
  qc_notes: string | null;
  qc_images: string[];
  qc_checked_by: string;
  qc_checked_at: string;
}

export interface COFilters {
  status?: COStatus;
  sourceType?: COSourceType;
  addressedTo?: string;
  dateFrom?: string;
  dateTo?: string;
}

async function uid(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function getCorrectionOrders(filters: COFilters = {}): Promise<CorrectionOrder[]> {
  let q = sb.from('correction_orders').select('*').order('created_at', { ascending: false });
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.sourceType) q = q.eq('source_type', filters.sourceType);
  if (filters.dateFrom) q = q.gte('created_at', filters.dateFrom);
  if (filters.dateTo) q = q.lte('created_at', filters.dateTo);
  const { data, error } = await q;
  if (error) throw error;
  let rows = (data ?? []) as CorrectionOrder[];
  if (filters.addressedTo) {
    const t = filters.addressedTo.toLowerCase();
    rows = rows.filter(r => (r.addressed_to_name ?? '').toLowerCase().includes(t));
  }
  return rows;
}

export async function getCorrectionOrderById(id: string) {
  const [co, items] = await Promise.all([
    sb.from('correction_orders').select('*').eq('id', id).maybeSingle(),
    sb.from('correction_order_items').select('*, product:products(id,sku,name)').eq('correction_order_id', id).order('created_at'),
  ]);
  if (co.error) throw co.error;
  if (items.error) throw items.error;
  const itemIds = (items.data ?? []).map((i: any) => i.id);
  let cycles: CorrectionQCCycle[] = [];
  let refunds: any[] = [];
  if (itemIds.length) {
    const [{ data: cy, error: ce }, { data: rf, error: re }] = await Promise.all([
      sb.from('correction_qc_cycles').select('*').in('correction_order_item_id', itemIds).order('cycle_number'),
      sb.from('correction_order_refunds').select('*').eq('correction_order_id', id).order('created_at', { ascending: false }),
    ]);
    if (ce) throw ce;
    if (re) throw re;
    cycles = (cy ?? []) as CorrectionQCCycle[];
    refunds = rf ?? [];
  }
  return {
    co: (co.data ?? null) as CorrectionOrder | null,
    items: (items.data ?? []) as (CorrectionOrderItem & { product?: any })[],
    cycles,
    refunds,
  };
}

export async function findCorrectionOrderForGR(grId: string): Promise<CorrectionOrder | null> {
  const { data, error } = await sb.from('correction_orders')
    .select('*')
    .eq('source_type', 'goods_receipt')
    .eq('source_document_id', grId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as CorrectionOrder | null;
}

export async function updateCorrectionOrderHeader(
  coId: string,
  patch: { addressedToName?: string; addressedToType?: COAddressedToType; correctionType?: COCorrectionType; notes?: string | null },
) {
  const update: Record<string, any> = {};
  if (patch.addressedToName !== undefined) update.addressed_to_name = patch.addressedToName;
  if (patch.addressedToType !== undefined) update.addressed_to_type = patch.addressedToType;
  if (patch.correctionType !== undefined) update.correction_type = patch.correctionType;
  if (patch.notes !== undefined) update.notes = patch.notes;
  const { error } = await sb.from('correction_orders').update(update).eq('id', coId);
  if (error) throw error;
  try { await logFieldChange('correction_order' as any, coId, 'header', null, JSON.stringify(update)); } catch { /* noop */ }
}

export async function sendCorrectionOrder(coId: string) {
  const { error } = await sb.from('correction_orders')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', coId);
  if (error) throw error;
  try { await logStatusChange('correction_order' as any, coId, 'draft', 'sent'); } catch { /* noop */ }
}

export async function recordItemReturnedToVendor(coItemId: string, notes?: string) {
  const { error } = await sb.from('correction_order_items')
    .update({ current_status: 'returned_to_vendor', notes: notes ?? null })
    .eq('id', coItemId);
  if (error) throw error;
  try { await logStatusChange('correction_order_item' as any, coItemId, 'awaiting_correction', 'returned_to_vendor'); } catch { /* noop */ }
}

export async function recordItemReceivedBack(coItemId: string) {
  const { data: item, error: ie } = await sb.from('correction_order_items')
    .select('*, correction_order:correction_orders(id,co_number)')
    .eq('id', coItemId).maybeSingle();
  if (ie) throw ie;
  if (!item) throw new Error('Item not found');

  const { error } = await sb.from('correction_order_items')
    .update({ current_status: 'received_back' })
    .eq('id', coItemId);
  if (error) throw error;

  // Add to scan queue for re-QC
  try {
    await addToScanQueue(
      'correction_order',
      item.correction_order.id,
      item.correction_order.co_number,
      1,
      'normal',
    );
  } catch { /* noop */ }
  try { await logStatusChange('correction_order_item' as any, coItemId, 'returned_to_vendor', 'received_back'); } catch { /* noop */ }
}

export async function completeQCCycle(
  coItemId: string, passed: boolean, notes?: string, images?: string[],
) {
  const { error } = await sb.rpc('complete_correction_qc_cycle', {
    p_co_item_id: coItemId,
    p_passed: passed,
    p_notes: notes ?? null,
    p_images: images ?? [],
  });
  if (error) throw error;
  try {
    await logFieldChange('correction_order_item' as any, coItemId, 'qc_cycle', null, passed ? 'passed' : 'failed');
  } catch { /* noop */ }
}

export async function recordVendorRefund(input: {
  coItemId: string;
  amount: number;
  method: 'cash' | 'bank_transfer' | 'cheque' | 'adjustment';
  reference?: string;
  accountId?: string | null;
  notes?: string;
  receivedDate?: string;
}) {
  const me = await uid();
  // get parent CO id
  const { data: item, error: ie } = await sb.from('correction_order_items')
    .select('id, correction_order_id').eq('id', input.coItemId).maybeSingle();
  if (ie) throw ie;
  if (!item) throw new Error('Item not found');

  const { error } = await sb.from('correction_order_refunds').insert({
    correction_order_id: item.correction_order_id,
    correction_order_item_id: input.coItemId,
    refund_amount: input.amount,
    refund_received_date: input.receivedDate ?? new Date().toISOString().slice(0, 10),
    refund_method: input.method,
    refund_reference: input.reference ?? null,
    refund_account_id: input.accountId ?? null,
    notes: input.notes ?? null,
    recorded_by: me,
  });
  if (error) throw error;

  const { error: ue } = await sb.from('correction_order_items')
    .update({ current_status: 'refunded_by_vendor' })
    .eq('id', input.coItemId);
  if (ue) throw ue;
  try {
    await logRecordCreated('correction_order_refund' as any, item.correction_order_id);
  } catch { /* noop */ }
}

export async function closeCorrectionOrder(coId: string): Promise<{ success: boolean; reason?: string }> {
  const { data, error } = await sb.rpc('close_correction_order', { p_co_id: coId });
  if (error) throw error;
  const result = (data ?? {}) as { success: boolean; reason?: string };
  if (result.success) {
    try { await logStatusChange('correction_order' as any, coId, 'sent', 'closed'); } catch { /* noop */ }
  }
  return result;
}

export async function cancelCorrectionOrder(coId: string, reason: string) {
  const { error } = await sb.from('correction_orders')
    .update({ status: 'cancelled', notes: reason })
    .eq('id', coId);
  if (error) throw error;
  try { await logStatusChange('correction_order' as any, coId, 'sent', 'cancelled'); } catch { /* noop */ }
}

export async function getUnderCorrectionCountByProduct(productId: string): Promise<number> {
  const { count, error } = await sb.from('goods_receipt_serials')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId)
    .eq('stock_status', 'under_correction');
  if (error) return 0;
  return count ?? 0;
}