/**
 * Inventory 2 — internal transfer hooks.
 *
 * Error policy (CLAUDE.md Rule 5): nothing here catches. Every mutation lets
 * the RPC's error propagate so the global MutationCache handler in App.tsx
 * surfaces the Postgres message verbatim, and each page additionally pins the
 * same words on screen until dismissed.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as transfers from '@/lib/services/inventory2/transfers';
import {
  createTransfer, addOperationLine, removeOperationLine, completeOperation,
  listTransferTypes,
  type CreateTransferInput,
} from '@/lib/services/inventory2/transferWrites';
import { listLocations, listProducts } from '@/lib/services/inventory2/receiptWrites';
import { inv2ScanKeys } from './scan';

export const inv2TransferKeys = {
  all: ['inv2', 'transfers'] as const,
  list: () => [...inv2TransferKeys.all, 'list'] as const,
  detail: (id: string | undefined) => [...inv2TransferKeys.all, 'detail', id ?? 'none'] as const,
  types: () => [...inv2TransferKeys.all, 'types'] as const,
};

export const useInv2Transfers = () =>
  useQuery({
    queryKey: inv2TransferKeys.list(),
    queryFn: transfers.listTransfers,
  });

export const useInv2Transfer = (id: string | undefined) =>
  useQuery({
    queryKey: inv2TransferKeys.detail(id),
    queryFn: () => transfers.getTransferDetail(id!),
    enabled: !!id,
  });

export const useInv2TransferTypes = () =>
  useQuery({ queryKey: inv2TransferKeys.types(), queryFn: listTransferTypes });

/*
 * Locations and products are read through the RECEIPT write module rather than
 * duplicated here. They are plain pickers over `inv_location` and `products`
 * with nothing receipt-specific about them, and a second copy would be a second
 * thing to keep in step. Only the operation-type list is transfer-specific,
 * because it filters on kind.
 */
export const useInv2TransferLocations = () =>
  useQuery({ queryKey: ['inv2', 'locations'], queryFn: listLocations });

export const useInv2TransferProducts = () =>
  useQuery({ queryKey: ['inv2', 'products', 'options'], queryFn: listProducts });

/**
 * Everything a transfer write must refresh.
 *
 * The scan keys are in here deliberately. The scan screen and the detail page
 * read the SAME document through two different query keys, and a line added on
 * the detail page must appear at the bay without a manual reload — otherwise an
 * operator scans against a document the screen believes has no lines. This is
 * the same two-key-spaces trap recorded in CLAUDE.md for the attribute service;
 * the difference is that it is handled here, in one place, from the start.
 */
function useTransferInvalidation(id: string | undefined) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: inv2TransferKeys.list() });
    void qc.invalidateQueries({ queryKey: inv2TransferKeys.detail(id) });
    void qc.invalidateQueries({ queryKey: inv2ScanKeys.doc(id) });
    void qc.invalidateQueries({ queryKey: inv2ScanKeys.open('internal') });
  };
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTransferInput) => createTransfer(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inv2TransferKeys.list() });
      void qc.invalidateQueries({ queryKey: inv2ScanKeys.open('internal') });
    },
  });
}

export function useAddTransferLine(id: string | undefined) {
  const invalidate = useTransferInvalidation(id);
  return useMutation({
    mutationFn: (v: { productId: string; demandQty: number }) =>
      addOperationLine(id!, v.productId, v.demandQty),
    onSuccess: invalidate,
  });
}

export function useRemoveTransferLine(id: string | undefined) {
  const invalidate = useTransferInvalidation(id);
  return useMutation({
    mutationFn: (moveId: string) => removeOperationLine(moveId),
    onSuccess: invalidate,
  });
}

export function useCompleteTransfer(id: string | undefined) {
  const invalidate = useTransferInvalidation(id);
  return useMutation({
    mutationFn: () => completeOperation(id!),
    onSuccess: invalidate,
  });
}
