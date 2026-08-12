/**
 * Inventory 2 — scan engine hooks.
 *
 * Error policy (CLAUDE.md Rule 5): nothing here catches. Every mutation lets
 * the RPC's error propagate so the global MutationCache handler in App.tsx
 * toasts the Postgres message verbatim, and the screen additionally pins the
 * same words to the failed scan row — a scan that failed at the bay must stay
 * readable after the toast has gone.
 *
 * Generic over the document kind, like the service layer beneath it: the
 * adapter is passed in, never imported here.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as scan from '@/lib/services/inventory2/scan';
import { inv2Keys } from './receipts';

export const inv2ScanKeys = {
  open: (kind: scan.ScanDocKind) => ['inv2', 'scan', 'open', kind] as const,
  doc: (id: string | undefined) => ['inv2', 'scan', 'doc', id ?? 'none'] as const,
};

export function useOpenScanDocuments(kind: scan.ScanDocKind) {
  return useQuery({
    queryKey: inv2ScanKeys.open(kind),
    queryFn: () => scan.listOpenScanDocuments(kind),
  });
}

export function useScanDocument(operationId: string | undefined) {
  return useQuery({
    queryKey: inv2ScanKeys.doc(operationId),
    queryFn: () => scan.getScanDocument(operationId!),
    enabled: !!operationId,
  });
}

/**
 * Commit one scanned unit through the adapter.
 *
 * The mutation input carries the resolved unit rather than any location taken
 * from the document — see the rule at the top of `scan.ts`.
 */
export function useCommitUnit(adapter: scan.ScanAdapter, operationId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: scan.CommitUnitInput) => adapter.commitUnit(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inv2ScanKeys.doc(operationId) });
      void qc.invalidateQueries({ queryKey: inv2ScanKeys.open(adapter.kind) });
      if (operationId) void qc.invalidateQueries({ queryKey: inv2Keys.receipt(operationId) });
      void qc.invalidateQueries({ queryKey: inv2Keys.receipts() });
    },
  });
}

export function useCompleteScanDocument(adapter: scan.ScanAdapter, operationId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adapter.completeDocument(operationId!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inv2ScanKeys.doc(operationId) });
      void qc.invalidateQueries({ queryKey: inv2ScanKeys.open(adapter.kind) });
      if (operationId) void qc.invalidateQueries({ queryKey: inv2Keys.receipt(operationId) });
      void qc.invalidateQueries({ queryKey: inv2Keys.receipts() });
    },
  });
}
