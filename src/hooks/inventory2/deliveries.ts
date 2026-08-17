/**
 * Inventory 2 — outgoing delivery hooks. Sibling to `transfers.ts`.
 *
 * Error policy (CLAUDE.md Rule 5): nothing here catches. Every mutation lets
 * the RPC's error propagate so the global MutationCache handler in App.tsx
 * surfaces the Postgres message verbatim, and each page additionally pins the
 * same words on screen until dismissed.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as deliveries from '@/lib/services/inventory2/deliveries';
import {
  createDelivery, addOperationLine, removeOperationLine, completeOperation,
  listDeliveryTypes, listDeliveryCustomers, listOpenSalesOrders,
  type CreateDeliveryInput,
} from '@/lib/services/inventory2/deliveryWrites';
import { listLocations, listProducts } from '@/lib/services/inventory2/receiptWrites';
import { inv2ScanKeys } from './scan';

export const inv2DeliveryKeys = {
  all: ['inv2', 'deliveries'] as const,
  list: () => [...inv2DeliveryKeys.all, 'list'] as const,
  detail: (id: string | undefined) => [...inv2DeliveryKeys.all, 'detail', id ?? 'none'] as const,
  types: () => [...inv2DeliveryKeys.all, 'types'] as const,
  customers: () => [...inv2DeliveryKeys.all, 'customers'] as const,
  salesOrders: () => [...inv2DeliveryKeys.all, 'salesOrders'] as const,
};

export const useInv2Deliveries = () =>
  useQuery({
    queryKey: inv2DeliveryKeys.list(),
    queryFn: deliveries.listDeliveries,
  });

export const useInv2Delivery = (id: string | undefined) =>
  useQuery({
    queryKey: inv2DeliveryKeys.detail(id),
    queryFn: () => deliveries.getDeliveryDetail(id!),
    enabled: !!id,
  });

export const useInv2DeliveryTypes = () =>
  useQuery({ queryKey: inv2DeliveryKeys.types(), queryFn: listDeliveryTypes });

/**
 * Customers, read DIRECTLY off `customers`.
 *
 * Deliberately not `useContacts` and not CustomerSelector: both reach into CRM,
 * which is protected, and CustomerSelector additionally wraps CRM's
 * ContactSearchCombobox. `customers` is auto-populated from crm_contacts by
 * trg_sync_customer_from_contact and is read-mostly — reading it is exactly
 * what it is there for. Nothing here writes it.
 */
export const useInv2DeliveryCustomers = () =>
  useQuery({ queryKey: inv2DeliveryKeys.customers(), queryFn: listDeliveryCustomers });

export const useInv2DeliverySalesOrders = () =>
  useQuery({ queryKey: inv2DeliveryKeys.salesOrders(), queryFn: listOpenSalesOrders });

/*
 * Locations and products come through the RECEIPT write module, same as the
 * transfer hooks do. They are plain pickers over `inv_location` and `products`
 * with nothing kind-specific about them, and a third copy would be a third
 * thing to keep in step.
 */
export const useInv2DeliveryLocations = () =>
  useQuery({ queryKey: ['inv2', 'locations'], queryFn: listLocations });

export const useInv2DeliveryProducts = () =>
  useQuery({ queryKey: ['inv2', 'products', 'options'], queryFn: listProducts });

/**
 * Everything a delivery write must refresh.
 *
 * The scan keys are in here for the same reason they are in the transfer
 * hooks: the scan screen and the detail page read the SAME document through two
 * different query keys, so a line added on the detail page must appear at the
 * bay without a manual reload. Otherwise an operator scans against a document
 * the screen believes has no lines.
 */
function useDeliveryInvalidation(id: string | undefined) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: inv2DeliveryKeys.list() });
    void qc.invalidateQueries({ queryKey: inv2DeliveryKeys.detail(id) });
    void qc.invalidateQueries({ queryKey: inv2ScanKeys.doc(id) });
    void qc.invalidateQueries({ queryKey: inv2ScanKeys.open('outgoing') });
  };
}

export function useCreateDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDeliveryInput) => createDelivery(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inv2DeliveryKeys.list() });
      void qc.invalidateQueries({ queryKey: inv2ScanKeys.open('outgoing') });
    },
  });
}

export function useAddDeliveryLine(id: string | undefined) {
  const invalidate = useDeliveryInvalidation(id);
  return useMutation({
    mutationFn: (v: { productId: string; demandQty: number }) =>
      addOperationLine(id!, v.productId, v.demandQty),
    onSuccess: invalidate,
  });
}

export function useRemoveDeliveryLine(id: string | undefined) {
  const invalidate = useDeliveryInvalidation(id);
  return useMutation({
    mutationFn: (moveId: string) => removeOperationLine(moveId),
    onSuccess: invalidate,
  });
}

export function useCompleteDelivery(id: string | undefined) {
  const invalidate = useDeliveryInvalidation(id);
  return useMutation({
    mutationFn: () => completeOperation(id!),
    onSuccess: invalidate,
  });
}
