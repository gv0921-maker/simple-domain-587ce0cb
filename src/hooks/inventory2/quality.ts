/**
 * Inventory 2 — Quality segment hooks.
 *
 * Keyed on the operation id, like the service beneath. Nothing here is
 * receipt-aware, so a future transfer or delivery page uses the same hook.
 *
 * Read-only: QC is written by useRecordQc in ./qc, which invalidates this key
 * so the segment's counts move the moment a unit's status is re-derived.
 */
import { useQuery } from '@tanstack/react-query';
import * as quality from '@/lib/services/inventory2/quality';

export const inv2QualityKeys = {
  all: ['inv2', 'quality'] as const,
  document: (operationId: string | undefined) =>
    [...inv2QualityKeys.all, 'document', operationId ?? 'none'] as const,
};

export function useDocumentQuality(operationId: string | undefined) {
  return useQuery({
    queryKey: inv2QualityKeys.document(operationId),
    queryFn: () => quality.getDocumentQuality(operationId!),
    enabled: !!operationId,
  });
}
