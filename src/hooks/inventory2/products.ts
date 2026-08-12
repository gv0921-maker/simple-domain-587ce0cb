/**
 * Inventory 2 — product query and mutation hooks. Pass 9.
 *
 * Error policy (CLAUDE.md Rule 5): nothing here catches. An RLS refusal
 * (products INSERT/UPDATE require is_admin()) or a duplicate-SKU violation
 * propagates so the global MutationCache handler in App.tsx surfaces the
 * Postgres message verbatim; the form additionally renders it inline, because
 * "duplicate key value violates unique constraint products_sku_key" tells the
 * user what to change and a toast that fades does not.
 *
 * Invalidation reaches beyond this module on purpose: `products` is shared, so
 * a save also drops the legacy inventory cache (`['inventory','products']`,
 * used by useProducts() across sales, invoicing and manufacturing pickers).
 * Without that, a product created here would be invisible to a Sales order
 * line until a page reload.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as products from '@/lib/services/inventory2/products';
import { inventoryKeys } from '@/hooks/inventory/keys';

export const inv2ProductKeys = {
  all: ['inv2', 'products'] as const,
  list: () => [...inv2ProductKeys.all, 'list'] as const,
  detail: (id: string) => [...inv2ProductKeys.all, 'detail', id] as const,
  onHand: (id: string) => [...inv2ProductKeys.all, 'onHand', id] as const,
  categories: () => [...inv2ProductKeys.all, 'categories'] as const,
  uoms: () => [...inv2ProductKeys.all, 'uoms'] as const,
};

/* ------------------------------------------------------------------ reads */

export const useInv2ProductList = () =>
  useQuery({ queryKey: inv2ProductKeys.list(), queryFn: products.listProducts });

export const useInv2Product = (id: string | undefined) =>
  useQuery({
    queryKey: id ? inv2ProductKeys.detail(id) : ['inv2', 'products', 'detail', 'none'],
    queryFn: () => products.getProduct(id!),
    enabled: !!id,
  });

export const useInv2ProductOnHand = (id: string | undefined) =>
  useQuery({
    queryKey: id ? inv2ProductKeys.onHand(id) : ['inv2', 'products', 'onHand', 'none'],
    queryFn: () => products.getProductOnHand(id!),
    enabled: !!id,
  });

export const useInv2Categories = () =>
  useQuery({ queryKey: inv2ProductKeys.categories(), queryFn: products.listCategories });

export const useInv2Uoms = () =>
  useQuery({ queryKey: inv2ProductKeys.uoms(), queryFn: products.listUoms });

/* ----------------------------------------------------------------- writes */

function useProductInvalidation() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: inv2ProductKeys.all });
    if (id) void qc.invalidateQueries({ queryKey: inv2ProductKeys.detail(id) });
    // Shared table — legacy and Sales consumers read through this key.
    void qc.invalidateQueries({ queryKey: inventoryKeys.products() });
  };
}

export function useCreateInv2Product() {
  const invalidate = useProductInvalidation();
  return useMutation({
    mutationFn: (input: products.ProductInput) => products.createProduct(input),
    onSuccess: (row) => invalidate(row.id),
  });
}

export function useUpdateInv2Product(id: string | undefined) {
  const invalidate = useProductInvalidation();
  return useMutation({
    mutationFn: (input: products.ProductInput) => products.updateProduct(id!, input),
    onSuccess: (row) => invalidate(row.id),
  });
}
