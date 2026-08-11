/**
 * Inventory 2 — receipt write hooks.
 *
 * Error policy (CLAUDE.md Rule 5): nothing here catches. Every mutation lets
 * the RPC's error propagate, so the global MutationCache handler in App.tsx
 * toasts the Postgres message verbatim. Callers additionally render the same
 * message inline — the refusal messages from inv_cancel_receipt and
 * inv_remove_receipt_line are long and instructive ("raise a stock adjustment
 * to move the units out"), and a toast is the wrong place to read a sentence
 * that tells you what to do instead.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as writes from '@/lib/services/inventory2/receiptWrites';
import { inv2Keys } from './receipts';

/* ------------------------------------------------------------ form options */

export const inv2FormKeys = {
  types: ['inv2', 'form', 'receiptTypes'] as const,
  locations: ['inv2', 'form', 'locations'] as const,
  vendors: ['inv2', 'form', 'vendors'] as const,
  products: ['inv2', 'form', 'products'] as const,
};

export const useInv2ReceiptTypes = () =>
  useQuery({ queryKey: inv2FormKeys.types, queryFn: writes.listReceiptTypes });

export const useInv2Locations = () =>
  useQuery({ queryKey: inv2FormKeys.locations, queryFn: writes.listLocations });

export const useInv2Vendors = () =>
  useQuery({ queryKey: inv2FormKeys.vendors, queryFn: writes.listVendors });

export const useInv2Products = () =>
  useQuery({ queryKey: inv2FormKeys.products, queryFn: writes.listProducts });

/* ----------------------------------------------------------------- writes */

export function useCreateReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: writes.CreateReceiptInput) => writes.createReceipt(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inv2Keys.receipts() });
    },
  });
}

export function useAddReceiptLine(operationId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { productId: string; demandQty: number }) =>
      writes.addReceiptLine(operationId!, v.productId, v.demandQty),
    onSuccess: () => {
      if (operationId) void qc.invalidateQueries({ queryKey: inv2Keys.receipt(operationId) });
      void qc.invalidateQueries({ queryKey: inv2Keys.receipts() });
    },
  });
}

export function useRemoveReceiptLine(operationId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (moveId: string) => writes.removeReceiptLine(moveId),
    onSuccess: () => {
      if (operationId) void qc.invalidateQueries({ queryKey: inv2Keys.receipt(operationId) });
      void qc.invalidateQueries({ queryKey: inv2Keys.receipts() });
    },
  });
}

export function useReceiveSerial(operationId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { moveId: string; serial: string; cost: number }) =>
      writes.receiveSerial(v.moveId, v.serial, v.cost),
    onSuccess: () => {
      if (operationId) void qc.invalidateQueries({ queryKey: inv2Keys.receipt(operationId) });
      void qc.invalidateQueries({ queryKey: inv2Keys.receipts() });
    },
  });
}

export function useCompleteReceipt(operationId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => writes.completeReceipt(operationId!),
    onSuccess: () => {
      if (operationId) void qc.invalidateQueries({ queryKey: inv2Keys.receipt(operationId) });
      void qc.invalidateQueries({ queryKey: inv2Keys.receipts() });
    },
  });
}

export function useCancelReceipt(operationId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => writes.cancelReceipt(operationId!),
    onSuccess: () => {
      if (operationId) void qc.invalidateQueries({ queryKey: inv2Keys.receipt(operationId) });
      void qc.invalidateQueries({ queryKey: inv2Keys.receipts() });
    },
  });
}
