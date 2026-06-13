import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as co from '@/lib/services/inventory/correctionOrders';

export const correctionOrderKeys = {
  all: ['correctionOrders'] as const,
  list: (filters?: co.COFilters) => [...correctionOrderKeys.all, 'list', filters ?? {}] as const,
  detail: (id: string) => [...correctionOrderKeys.all, 'detail', id] as const,
  byGr: (grId: string) => [...correctionOrderKeys.all, 'byGr', grId] as const,
  underCorrection: (productId: string) => [...correctionOrderKeys.all, 'underCorrection', productId] as const,
};

export const useCorrectionOrders = (filters: co.COFilters = {}) =>
  useQuery({ queryKey: correctionOrderKeys.list(filters), queryFn: () => co.getCorrectionOrders(filters) });

export const useCorrectionOrder = (id: string | undefined) =>
  useQuery({
    queryKey: id ? correctionOrderKeys.detail(id) : ['noop'],
    queryFn: () => co.getCorrectionOrderById(id!),
    enabled: !!id,
  });

export const useCorrectionOrderForGR = (grId: string | undefined) =>
  useQuery({
    queryKey: grId ? correctionOrderKeys.byGr(grId) : ['noop'],
    queryFn: () => co.findCorrectionOrderForGR(grId!),
    enabled: !!grId,
  });

export const useUnderCorrectionCount = (productId: string | undefined) =>
  useQuery({
    queryKey: productId ? correctionOrderKeys.underCorrection(productId) : ['noop'],
    queryFn: () => co.getUnderCorrectionCountByProduct(productId!),
    enabled: !!productId,
  });

function makeMutation<T>(id: string, fn: (input: T) => Promise<any>) {
  return [id, fn] as const;
}

export function useUpdateCorrectionOrderHeader(coId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof co.updateCorrectionOrderHeader>[1]) =>
      co.updateCorrectionOrderHeader(coId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: correctionOrderKeys.detail(coId) }),
  });
}

export function useSendCorrectionOrder(coId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => co.sendCorrectionOrder(coId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: correctionOrderKeys.detail(coId) });
      qc.invalidateQueries({ queryKey: correctionOrderKeys.all });
    },
  });
}

export function useRecordItemReturnedToVendor(coId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { coItemId: string; notes?: string }) =>
      co.recordItemReturnedToVendor(input.coItemId, input.notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: correctionOrderKeys.detail(coId) }),
  });
}

export function useRecordItemReceivedBack(coId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (coItemId: string) => co.recordItemReceivedBack(coItemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: correctionOrderKeys.detail(coId) }),
  });
}

export function useCompleteCorrectionQCCycle(coId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { coItemId: string; passed: boolean; notes?: string; images?: string[] }) =>
      co.completeQCCycle(input.coItemId, input.passed, input.notes, input.images),
    onSuccess: () => qc.invalidateQueries({ queryKey: correctionOrderKeys.detail(coId) }),
  });
}

export function useRecordVendorRefund(coId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof co.recordVendorRefund>[0]) => co.recordVendorRefund(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: correctionOrderKeys.detail(coId) }),
  });
}

export function useCloseCorrectionOrder(coId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => co.closeCorrectionOrder(coId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: correctionOrderKeys.detail(coId) });
      qc.invalidateQueries({ queryKey: correctionOrderKeys.all });
    },
  });
}

export function useCancelCorrectionOrder(coId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => co.cancelCorrectionOrder(coId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: correctionOrderKeys.detail(coId) });
      qc.invalidateQueries({ queryKey: correctionOrderKeys.all });
    },
  });
}