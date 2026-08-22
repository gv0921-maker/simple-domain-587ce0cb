/**
 * Inventory 2 — generated serial hooks.
 *
 * Error policy (CLAUDE.md Rule 5): nothing here catches. The RPCs raise
 * sentences meant to be read — "Refusing to generate 501 serials at once; the
 * cap is 500. Numbers are consumed on allocation and never recycled, so a
 * mistyped count cannot be taken back." — so every mutation lets the error
 * propagate to the global MutationCache handler, and callers render the same
 * text inline where the operator is looking.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as serials from '@/lib/services/inventory2/serials';
import { inv2Keys } from './receipts';

export const inv2SerialKeys = {
  pending: (operationId: string) => ['inv2', 'pendingSerials', operationId] as const,
  preview: (moveId: string) => ['inv2', 'serialPreview', moveId] as const,
};

export const usePendingSerials = (operationId: string | undefined) =>
  useQuery({
    queryKey: operationId
      ? inv2SerialKeys.pending(operationId)
      : ['inv2', 'pendingSerials', 'none'],
    queryFn: () => serials.listPendingSerials(operationId!),
    enabled: !!operationId,
  });

/**
 * The next serial, for the read-only preview.
 *
 * `staleTime: 0` deliberately: the counter moves whenever anyone generates, so
 * a cached preview would show a number that has already been handed out. It is
 * labelled as an estimate on screen for the same reason — see
 * `previewNextSerial`, which cannot see the RPC's collision skip.
 */
export const useNextSerialPreview = (moveId: string | undefined) =>
  useQuery({
    queryKey: moveId ? inv2SerialKeys.preview(moveId) : ['inv2', 'serialPreview', 'none'],
    queryFn: () => serials.previewNextSerial(moveId!),
    enabled: !!moveId,
    staleTime: 0,
  });

/**
 * Every mutation below invalidates BOTH the pending list and the receipt.
 *
 * The receipt matters as much as the list: generating changes nothing about
 * the goods, but voiding and receiving both move figures the reconciliation
 * line reads off `ReceiptDetail`. Invalidating only the list would leave the
 * two accounts disagreeing on screen, which is exactly the confusion keeping
 * them separate is meant to prevent.
 */
function useSerialMutation<TVars, TData>(
  operationId: string | undefined,
  fn: (v: TVars) => Promise<TData>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (!operationId) return;
      void qc.invalidateQueries({ queryKey: inv2SerialKeys.pending(operationId) });
      void qc.invalidateQueries({ queryKey: inv2Keys.receipt(operationId) });
      void qc.invalidateQueries({ queryKey: ['inv2', 'serialPreview'] });
    },
  });
}

export const useGenerateSerials = (operationId: string | undefined) =>
  useSerialMutation(operationId, (v: { moveId: string; count: number }) =>
    serials.generateSerials(v.moveId, v.count));

export const useVoidPendingSerials = (operationId: string | undefined) =>
  useSerialMutation(operationId, (v: { pendingIds: string[]; reason: string }) =>
    serials.voidPendingSerials(v.pendingIds, v.reason));

export const useRecordSerialPrint = (operationId: string | undefined) =>
  useSerialMutation(operationId, (v: { pendingIds: string[] }) =>
    serials.recordSerialPrint(v.pendingIds));
