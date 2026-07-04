// Live counts of operations grouped by operation_type_id.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface OperationTypeCounts {
  operationTypeId: string | null;
  draft: number;
  waiting: number;
  completed: number;
  late: number;
  total: number;
}

type Row = { operation_type_id: string | null; status: string | null };

async function fetchTable(table: 'goods_receipts' | 'delivery_notes' | 'internal_movements'): Promise<Row[]> {
  const { data, error } = await supabase.from(table as any).select('operation_type_id,status').limit(5000);
  if (error) throw error;
  return (data ?? []) as any;
}

function tally(rows: Row[]): Map<string, OperationTypeCounts> {
  const m = new Map<string, OperationTypeCounts>();
  for (const r of rows) {
    const key = r.operation_type_id ?? '__none__';
    if (!m.has(key)) {
      m.set(key, {
        operationTypeId: r.operation_type_id, draft: 0, waiting: 0, completed: 0, late: 0, total: 0,
      });
    }
    const c = m.get(key)!;
    c.total += 1;
    const s = (r.status ?? '').toLowerCase();
    if (s === 'draft') c.draft += 1;
    else if (s === 'waiting' || s === 'pending' || s === 'in_progress') c.waiting += 1;
    else if (s === 'completed' || s === 'done' || s === 'received' || s === 'delivered') c.completed += 1;
    else if (s === 'late' || s === 'overdue') c.late += 1;
    else c.draft += 1;
  }
  return m;
}

export function useOperationTypeCounts() {
  return useQuery({
    queryKey: ['operation-type-counts'],
    queryFn: async () => {
      const [gr, dn, im] = await Promise.all([
        fetchTable('goods_receipts'),
        fetchTable('delivery_notes'),
        fetchTable('internal_movements'),
      ]);
      return {
        receipt: tally(gr),
        delivery: tally(dn),
        internal_transfer: tally(im),
        manufacturing: new Map<string, OperationTypeCounts>(),
      };
    },
    staleTime: 30_000,
  });
}
