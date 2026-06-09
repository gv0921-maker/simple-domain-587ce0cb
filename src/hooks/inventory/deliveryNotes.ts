import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as svc from '@/lib/services/inventory/deliveryNotes';
import { inventoryKeys } from './keys';

export const deliveryNoteKeys = {
  all: [...inventoryKeys.all, 'delivery-notes'] as const,
  list: () => [...deliveryNoteKeys.all, 'list'] as const,
  detail: (id: string) => [...deliveryNoteKeys.all, 'detail', id] as const,
};

export const useDeliveryNotes = () =>
  useQuery({ queryKey: deliveryNoteKeys.list(), queryFn: svc.listDeliveryNotesAsync });

export const useDeliveryNote = (id: string | undefined) =>
  useQuery({
    queryKey: id ? deliveryNoteKeys.detail(id) : ['noop'],
    queryFn: () => svc.getDeliveryNoteAsync(id!),
    enabled: !!id,
  });

export function useGenerateDeliveryNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) => svc.generateDeliveryNoteFromInvoiceAsync(invoiceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: deliveryNoteKeys.all }),
  });
}

export function useMarkDeliveryNoteDelivered() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => svc.markDeliveryNoteAsDeliveredAsync(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deliveryNoteKeys.all });
      qc.invalidateQueries({ queryKey: inventoryKeys.products() });
    },
  });
}

export type { DeliveryNote, DeliveryNoteStatus, DeliveryNoteProduct } from '@/lib/services/inventory/deliveryNotes';