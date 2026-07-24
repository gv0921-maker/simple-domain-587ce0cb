import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface InventoryOverviewMetrics {
  totalProducts: number;
  activeWarehouses: number;
  pendingTransfers: number;
  stockValue: number;
  goodsReceipts: { draft: number; pending: number; completed: number; total: number };
  correctionOrders: { open: number };
  deliveryNotes: { waiting: number; delivered: number; total: number };
  stockCounts: { pending: number };
  writeOffs: { pending: number };
  internalMovements: { pending: number; total: number };
}

async function fetchOverview(): Promise<InventoryOverviewMetrics> {
  const count = (q: any) => q.select('*', { count: 'exact', head: true });

  const [
    productsRes,
    warehousesRes,
    itoRes,
    grDraft,
    grPending,
    grCompleted,
    correctionOpen,
    dnWaiting,
    dnDelivered,
    scPending,
    woPending,
    imPending,
    imTotal,
    productsValueRes,
  ] = await Promise.all([
    // Every status list below is constrained by a CHECK on its table. Invented
    // values silently match nothing, so a card reads zero forever rather than
    // failing — which is how most of these were wrong. If you change one,
    // check the constraint in the migration named beside it.
    count(supabase.from('products')).eq('is_active', true),
    count(supabase.from('warehouses')).eq('is_active', true),
    // internal_transfer_orders: draft|confirmed|partial|completed|cancelled (20260613051453)
    count(supabase.from('internal_transfer_orders')).in('status', ['draft', 'confirmed', 'partial']),
    // goods_receipts: draft|quantity_pending|labels_pending|qc_pending|completed|cancelled (20260613053609)
    count(supabase.from('goods_receipts')).eq('status', 'draft'),
    count(supabase.from('goods_receipts')).in('status', ['quantity_pending', 'labels_pending', 'qc_pending']),
    count(supabase.from('goods_receipts')).eq('status', 'completed'),
    // correction_orders: draft|sent|in_progress|completed|closed|cancelled (20260613054744)
    count(supabase.from('correction_orders')).in('status', ['draft', 'sent', 'in_progress']),
    // delivery_notes: draft|confirmed|delivered (20260609115823)
    count(supabase.from('delivery_notes')).in('status', ['draft', 'confirmed']),
    count(supabase.from('delivery_notes')).eq('status', 'delivered'),
    // stock_counts: no CHECK; service uses draft|in_progress|completed|skipped
    count(supabase.from('stock_counts')).in('status', ['draft', 'in_progress']),
    // write_off_records: draft|approved|cancelled (20260613063355) — no pending state
    count(supabase.from('write_off_records')).eq('status', 'draft'),
    // internal_movements: draft|in_progress|completed|cancelled (20260613061141)
    count(supabase.from('internal_movements')).in('status', ['draft', 'in_progress']),
    count(supabase.from('internal_movements')),
    supabase.from('products').select('stock_on_hand, cost_price').eq('is_active', true),
  ]);

  const stockValue = (productsValueRes.data ?? []).reduce(
    (sum: number, p: any) => sum + Number(p.stock_on_hand ?? 0) * Number(p.cost_price ?? 0),
    0,
  );

  const grDraftN = grDraft.count ?? 0;
  const grPendingN = grPending.count ?? 0;
  const grCompletedN = grCompleted.count ?? 0;
  const dnWaitingN = dnWaiting.count ?? 0;
  const dnDeliveredN = dnDelivered.count ?? 0;

  return {
    totalProducts: productsRes.count ?? 0,
    activeWarehouses: warehousesRes.count ?? 0,
    pendingTransfers: itoRes.count ?? 0,
    stockValue,
    goodsReceipts: {
      draft: grDraftN,
      pending: grPendingN,
      completed: grCompletedN,
      total: grDraftN + grPendingN + grCompletedN,
    },
    correctionOrders: { open: correctionOpen.count ?? 0 },
    deliveryNotes: {
      waiting: dnWaitingN,
      delivered: dnDeliveredN,
      total: dnWaitingN + dnDeliveredN,
    },
    stockCounts: { pending: scPending.count ?? 0 },
    writeOffs: { pending: woPending.count ?? 0 },
    internalMovements: {
      pending: imPending.count ?? 0,
      total: imTotal.count ?? 0,
    },
  };
}

export function useInventoryOverview() {
  return useQuery({
    queryKey: ['inventory', 'overview-metrics'],
    queryFn: fetchOverview,
    staleTime: 30_000,
  });
}