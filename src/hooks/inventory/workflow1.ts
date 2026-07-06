import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as wf from '@/lib/services/inventory/workflow1';

export function useCanCreateDeliveryForSO(salesOrderId: string | undefined) {
  return useQuery({
    queryKey: salesOrderId ? ['workflow1', 'payment-gate', salesOrderId] : ['noop'],
    queryFn: () => wf.canCreateDeliveryForSO(salesOrderId!),
    enabled: !!salesOrderId,
  });
}

export function useCompleteItoWithQc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itoId: string) => wf.completeItoWithQc(itoId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ito'] });
      qc.invalidateQueries({ queryKey: ['workflow1'] });
      qc.invalidateQueries({ queryKey: ['qc-engine'] });
    },
  });
}

export function useCompleteDeliveryWithQc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { dnId: string; signatureReceived?: boolean }) =>
      wf.completeDeliveryWithQc(args.dnId, { signatureReceived: args.signatureReceived }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery-note'] });
      qc.invalidateQueries({ queryKey: ['workflow1'] });
      qc.invalidateQueries({ queryKey: ['qc-engine'] });
      qc.invalidateQueries({ queryKey: ['deliveryNotes'] });
    },
  });
}

export function useItoExpectedLines(
  itoLines: Array<{ id: string; product_id: string; quantity_expected: number }> | undefined,
  salesOrderId: string | undefined,
) {
  return useQuery({
    queryKey: ['workflow1', 'ito-expected', salesOrderId, itoLines?.map(l => l.id).join(',') ?? ''],
    queryFn: () => wf.buildItoExpectedLines(itoLines ?? [], salesOrderId!),
    enabled: !!itoLines && !!salesOrderId,
  });
}