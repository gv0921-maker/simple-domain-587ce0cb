import { supabase } from '@/integrations/supabase/client';
import { addToScanQueue } from '@/lib/services/barcode/api';

export type StockCountStatus = 'draft' | 'in_progress' | 'completed' | 'reconciled' | 'skipped';
export type StockCountItemStatus = 'expected' | 'found' | 'missing' | 'unexpected_found' | 'reconciled';
export type ReconcileAction = 'mark_lost' | 'write_off' | 'found_late' | 'ignore';

export interface StockCount {
  id: string;
  count_number: string;
  count_period_month: number;
  count_period_year: number;
  status: StockCountStatus;
  count_type: 'full' | 'partial';
  warehouse_id: string | null;
  started_by: string | null;
  started_at: string | null;
  completed_by: string | null;
  completed_at: string | null;
  reconciled_by: string | null;
  reconciled_at: string | null;
  skip_reason: string | null;
  skip_approved_by: string | null;
  skip_approved_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockCountItem {
  id: string;
  stock_count_id: string;
  goods_receipt_serial_id: string;
  product_id: string;
  serial_number: string;
  expected_location_type: string | null;
  expected_warehouse_id: string | null;
  scanned_at: string | null;
  scanned_by: string | null;
  found_location_type: string | null;
  found_warehouse_id: string | null;
  count_status: StockCountItemStatus;
  discrepancy_notes: string | null;
  created_at: string;
  updated_at: string;
  product?: { name: string | null } | null;
}

export interface StockCountFilters {
  year?: number;
  status?: StockCountStatus | 'all';
}

export async function getStockCounts(filters: StockCountFilters = {}): Promise<StockCount[]> {
  let q = (supabase as any).from('stock_counts').select('*');
  if (filters.year) q = q.eq('count_period_year', filters.year);
  if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status);
  q = q.order('count_period_year', { ascending: false }).order('count_period_month', { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as StockCount[];
}

export async function getStockCountById(id: string): Promise<{ count: StockCount; items: StockCountItem[] } | null> {
  const { data: c, error } = await (supabase as any).from('stock_counts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!c) return null;
  const { data: items, error: ie } = await (supabase as any)
    .from('stock_count_items')
    .select('*, product:products(name)')
    .eq('stock_count_id', id)
    .order('created_at', { ascending: true });
  if (ie) throw ie;
  return { count: c as StockCount, items: (items ?? []) as StockCountItem[] };
}

export async function createStockCount(month: number, year: number, warehouseId?: string | null): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id ?? null;
  const { data, error } = await (supabase as any)
    .from('stock_counts')
    .insert({
      count_period_month: month,
      count_period_year: year,
      warehouse_id: warehouseId ?? null,
      status: 'draft',
      started_by: uid,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as any).id as string;
}

export async function startCount(countId: string): Promise<number> {
  const { data, error } = await (supabase as any).rpc('initialize_stock_count', { p_count_id: countId });
  if (error) throw error;
  // best-effort scan queue
  try {
    const { data: c } = await (supabase as any).from('stock_counts').select('count_number').eq('id', countId).maybeSingle();
    await addToScanQueue('stock_count' as any, countId, (c as any)?.count_number ?? countId, Number(data ?? 0), 'normal');
  } catch { /* noop */ }
  return Number(data ?? 0);
}

export async function completeCount(countId: string): Promise<{ total_expected: number; found: number; missing: number; unexpected_found: number }> {
  const { data, error } = await (supabase as any).rpc('complete_stock_count', { p_count_id: countId });
  if (error) throw error;
  return data as any;
}

export async function reconcileCount(countId: string, reconciliations: { item_id: string; action: ReconcileAction }[]): Promise<void> {
  const { error } = await (supabase as any).rpc('reconcile_stock_count', {
    p_count_id: countId,
    p_item_reconciliations: reconciliations,
  });
  if (error) throw error;
}

export async function markItemsMissing(itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  const { error } = await (supabase as any)
    .from('stock_count_items')
    .update({ count_status: 'missing' })
    .in('id', itemIds);
  if (error) throw error;
}

export async function recordItemFound(args: {
  countId: string;
  serialId: string;
  foundLocationType?: string | null;
  foundWarehouseId?: string | null;
  notes?: string;
}): Promise<void> {
  const { data: existing } = await (supabase as any)
    .from('stock_count_items')
    .select('id')
    .eq('stock_count_id', args.countId)
    .eq('goods_receipt_serial_id', args.serialId)
    .maybeSingle();
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id ?? null;
  if (existing) {
    const { error } = await (supabase as any)
      .from('stock_count_items')
      .update({
        count_status: 'found',
        scanned_at: new Date().toISOString(),
        scanned_by: uid,
        found_location_type: args.foundLocationType ?? null,
        found_warehouse_id: args.foundWarehouseId ?? null,
        discrepancy_notes: args.notes ?? null,
      })
      .eq('id', (existing as any).id);
    if (error) throw error;
  } else {
    await markItemUnexpectedFound(args.countId, args.serialId, args.notes);
  }
}

export async function markItemUnexpectedFound(countId: string, serialId: string, notes?: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id ?? null;
  const { data: s, error: se } = await (supabase as any)
    .from('goods_receipt_serials')
    .select('product_id, serial_number, stock_status')
    .eq('id', serialId)
    .maybeSingle();
  if (se) throw se;
  if (!s) return;
  const { error } = await (supabase as any).from('stock_count_items').insert({
    stock_count_id: countId,
    goods_receipt_serial_id: serialId,
    product_id: (s as any).product_id,
    serial_number: (s as any).serial_number,
    count_status: 'unexpected_found',
    scanned_at: new Date().toISOString(),
    scanned_by: uid,
    found_location_type: (s as any).stock_status,
    discrepancy_notes: notes ?? null,
  });
  if (error) throw error;
}

export async function requestCountSkip(year: number, month: number, reason: string): Promise<{ approved: boolean; countId?: string }> {
  // Check role
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (uid) {
    const { data: roles } = await (supabase as any).from('user_roles').select('role').eq('user_id', uid);
    const isSuper = ((roles ?? []) as any[]).some((r) => r.role === 'super_admin');
    if (isSuper) {
      const id = await approveCountSkip(year, month, reason);
      return { approved: true, countId: id };
    }
  }
  // Pending approval — log activity
  await (supabase as any).from('activity_log').insert({
    entity_type: 'stock_count',
    entity_id: null,
    action: 'skip_requested',
    details: { year, month, reason },
    user_id: uid,
  });
  return { approved: false };
}

export async function approveCountSkip(year: number, month: number, reason: string): Promise<string> {
  const { data, error } = await (supabase as any).rpc('approve_count_skip', {
    p_year: year, p_month: month, p_reason: reason,
  });
  if (error) throw error;
  return data as string;
}

export async function isCountRequiredThisMonth(): Promise<boolean> {
  const now = new Date();
  const { data, error } = await (supabase as any).rpc('is_count_required_this_month', {
    p_year: now.getFullYear(), p_month: now.getMonth() + 1,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function getCountQueueId(countId: string): Promise<string | null> {
  const { data, error } = await (supabase as any)
    .from('scan_queue').select('id')
    .eq('document_type', 'stock_count')
    .eq('document_id', countId)
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw error;
  return (data as any)?.id ?? null;
}

export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const STATUS_LABELS: Record<StockCountStatus, string> = {
  draft: 'Draft',
  in_progress: 'In Progress',
  completed: 'Completed',
  reconciled: 'Reconciled',
  skipped: 'Skipped',
};