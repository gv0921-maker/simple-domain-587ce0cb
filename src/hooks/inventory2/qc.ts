/**
 * Inventory 2 — QC hooks.
 *
 * Nothing catches. Failures propagate so the global MutationCache surfaces the
 * database's message verbatim; the QC form also renders it inline, because
 * inv_record_qc_results names the exact test that blocked the submission and
 * that sentence is the useful part.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as qc from '@/lib/services/inventory2/qc';
import { inv2Keys } from './receipts';

export const inv2QcKeys = {
  all: ['inv2', 'qc'] as const,
  queue: () => [...inv2QcKeys.all, 'queue'] as const,
  templates: (productId: string) => [...inv2QcKeys.all, 'templates', productId] as const,
  results: (stockItemId: string) => [...inv2QcKeys.all, 'results', stockItemId] as const,
};

export const useQcQueue = () =>
  useQuery({ queryKey: inv2QcKeys.queue(), queryFn: qc.listQcUnits });

export const useQcTemplates = (productId: string | undefined) =>
  useQuery({
    queryKey: productId ? inv2QcKeys.templates(productId) : ['inv2', 'qc', 'templates', 'none'],
    queryFn: () => qc.listTemplatesForProduct(productId!),
    enabled: !!productId,
  });

export const useQcResults = (stockItemId: string | undefined) =>
  useQuery({
    queryKey: stockItemId ? inv2QcKeys.results(stockItemId) : ['inv2', 'qc', 'results', 'none'],
    queryFn: () => qc.listResultsForUnit(stockItemId!),
    enabled: !!stockItemId,
  });

/**
 * Records a checklist. Invalidates the receipt too: a status change moves the
 * unit between on-hand and available-to-sell, and that number moving is the
 * visible proof the gate works.
 */
export function useRecordQc(stockItemId: string | undefined, operationId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (results: qc.QcSubmission[]) => qc.recordQcResults(stockItemId!, results),
    onSuccess: () => {
      if (stockItemId) void client.invalidateQueries({ queryKey: inv2QcKeys.results(stockItemId) });
      void client.invalidateQueries({ queryKey: inv2QcKeys.queue() });
      void client.invalidateQueries({ queryKey: inv2Keys.receipts() });
      if (operationId) void client.invalidateQueries({ queryKey: inv2Keys.receipt(operationId) });
    },
  });
}

export function useUploadQcAttachment(stockItemId: string | undefined) {
  return useMutation({
    mutationFn: (file: File) => qc.uploadQcAttachment(stockItemId!, file),
  });
}
