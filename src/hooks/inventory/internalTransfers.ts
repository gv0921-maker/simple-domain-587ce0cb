import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/services/inventory/internalTransfers';

export const itoKeys = {
  all: ['ito'] as const,
  bySO: (soId: string) => ['ito', 'so', soId] as const,
  byId: (id: string) => ['ito', 'detail', id] as const,
  readyToInvoice: (soId: string) => ['ito', 'ready-to-invoice', soId] as const,
  queueId: (itoId: string) => ['ito', 'queue', itoId] as const,
};

export function useITOsForSO(soId: string | undefined) {
  return useQuery({
    queryKey: itoKeys.bySO(soId ?? ''),
    queryFn: () => api.getITOsForSO(soId!),
    enabled: !!soId,
  });
}

export function useITODetail(id: string | undefined) {
  return useQuery({
    queryKey: itoKeys.byId(id ?? ''),
    queryFn: () => api.getITOById(id!),
    enabled: !!id,
  });
}

export function useSuggestITO() {
  return useMutation({ mutationFn: (soId: string) => api.suggestITO(soId) });
}

export function useCreateITO() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (soId: string) => api.createITO(soId),
    onSuccess: (_d, soId) => {
      qc.invalidateQueries({ queryKey: itoKeys.bySO(soId) });
      qc.invalidateQueries({ queryKey: ['ito'] });
      qc.invalidateQueries({ queryKey: ['barcode', 'queue'] });
    },
  });
}

export function useCancelITO() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { itoId: string; reason: string }) => api.cancelITO(args.itoId, args.reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ito'] }),
  });
}

export function useSOReadyToInvoice(soId: string | undefined) {
  return useQuery({
    queryKey: itoKeys.readyToInvoice(soId ?? ''),
    queryFn: () => api.checkSOReadyToInvoice(soId!),
    enabled: !!soId,
  });
}

export function useITOQueueId(itoId: string | undefined) {
  return useQuery({
    queryKey: itoKeys.queueId(itoId ?? ''),
    queryFn: () => api.getITOQueueId(itoId!),
    enabled: !!itoId,
  });
}