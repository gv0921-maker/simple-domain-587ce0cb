/** Inventory 2 — receipt query hooks. Read-only; no mutations exist yet. */
import { useQuery } from '@tanstack/react-query';
import * as receipts from '@/lib/services/inventory2/receipts';

export const inv2Keys = {
  all: ['inv2'] as const,
  receipts: () => [...inv2Keys.all, 'receipts'] as const,
  receipt: (id: string) => [...inv2Keys.all, 'receipt', id] as const,
};

export const useInv2Receipts = () =>
  useQuery({
    queryKey: inv2Keys.receipts(),
    queryFn: receipts.listReceipts,
  });

export const useInv2Receipt = (id: string | undefined) =>
  useQuery({
    queryKey: id ? inv2Keys.receipt(id) : ['inv2', 'receipt', 'none'],
    queryFn: () => receipts.getReceiptDetail(id!),
    enabled: !!id,
  });
