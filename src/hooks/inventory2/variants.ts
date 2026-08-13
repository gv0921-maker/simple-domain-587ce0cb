/**
 * Inventory 2 — variant query and mutation hooks. Pass 10C.
 *
 * Error policy (CLAUDE.md Rule 5): nothing catches. The database refusals this
 * layer sits in front of are written to be read by staff — "cannot be archived:
 * 3 physical unit(s) of it are in stock. Move or write off the units first" —
 * and every one of them reaches the surface verbatim, both through the global
 * MutationCache toast and inline where the caller renders it.
 *
 * Invalidation covers the product list too: a variant's stock and status show
 * on the product form, so a create or archive must not leave that view stale.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as variants from '@/lib/services/inventory2/variants';
import { inv2ProductKeys } from './products';

export const inv2VariantKeys = {
  all: ['inv2', 'variants'] as const,
  list: (productId?: string) => [...inv2VariantKeys.all, 'list', productId ?? 'all'] as const,
  detail: (id: string) => [...inv2VariantKeys.all, 'detail', id] as const,
  assigned: (productId: string) => [...inv2VariantKeys.all, 'assigned', productId] as const,
  productOptions: () => [...inv2VariantKeys.all, 'productOptions'] as const,
};

/* ------------------------------------------------------------------ reads */

/** Pass a productId to scope to one product; omit it for the config surface. */
export const useInv2Variants = (productId?: string) =>
  useQuery({
    queryKey: inv2VariantKeys.list(productId),
    queryFn: () => variants.listVariants(productId),
  });

export const useInv2Variant = (id: string | undefined) =>
  useQuery({
    queryKey: id ? inv2VariantKeys.detail(id) : ['inv2', 'variants', 'detail', 'none'],
    queryFn: () => variants.getVariant(id!),
    enabled: !!id,
  });

export const useInv2AssignedAttributes = (productId: string | undefined) =>
  useQuery({
    queryKey: productId ? inv2VariantKeys.assigned(productId) : ['inv2', 'variants', 'assigned', 'none'],
    queryFn: () => variants.listAssignedAttributes(productId!),
    enabled: !!productId,
  });

export const useInv2ProductOptions = () =>
  useQuery({ queryKey: inv2VariantKeys.productOptions(), queryFn: variants.listProductOptions });

/* ----------------------------------------------------------------- writes */

function useVariantInvalidation() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: inv2VariantKeys.all });
    // A variant's existence and stock are visible on the product form.
    void qc.invalidateQueries({ queryKey: inv2ProductKeys.all });
  };
}

export function useCreateVariant() {
  const invalidate = useVariantInvalidation();
  return useMutation({
    mutationFn: (input: variants.VariantInput) => variants.createVariant(input),
    onSuccess: invalidate,
  });
}

export function useUpdateVariant() {
  const invalidate = useVariantInvalidation();
  return useMutation({
    mutationFn: (v: { id: string; patch: variants.VariantPatch }) =>
      variants.updateVariant(v.id, v.patch),
    onSuccess: invalidate,
  });
}

export function useSetVariantStatus() {
  const invalidate = useVariantInvalidation();
  return useMutation({
    mutationFn: (v: { id: string; status: variants.VariantStatus }) =>
      variants.setVariantStatus(v.id, v.status),
    onSuccess: invalidate,
  });
}
