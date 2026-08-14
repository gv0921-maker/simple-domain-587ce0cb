/**
 * Inventory 2 — category value-scoping hooks. Pass B.
 *
 * Error policy (Rule 5): nothing catches; the caller renders the message inline.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as categoryValues from '@/lib/services/inventory2/categoryValues';
import * as valueResolution from '@/lib/services/inventory2/valueResolution';
import { inv2ValueScopeKeys } from './valueScope';

export const inv2CategoryValueKeys = {
  all: ['inv2', 'categoryValues'] as const,
  links: () => [...inv2CategoryValueKeys.all, 'links'] as const,
  resolved: (categoryId: string) =>
    [...inv2CategoryValueKeys.all, 'resolved', categoryId] as const,
  ancestors: (categoryId: string) =>
    [...inv2CategoryValueKeys.all, 'ancestors', categoryId] as const,
};

export const useCategoryValueLinks = () =>
  useQuery({
    queryKey: inv2CategoryValueKeys.links(),
    queryFn: categoryValues.listCategoryValueLinks,
  });

/**
 * What a category offers, resolved by the view.
 *
 * The config screen calls this for the PENDING parent, not for the category
 * being edited — that is what makes an unsaved reparent previewable: everything
 * the chosen parent offers is exactly what this category would inherit.
 */
export const useResolvedCategoryValues = (categoryId: string | null | undefined) =>
  useQuery({
    queryKey: categoryId
      ? inv2CategoryValueKeys.resolved(categoryId)
      : [...inv2CategoryValueKeys.all, 'resolved', 'none'],
    queryFn: () => valueResolution.listResolvedValues(categoryId!),
    enabled: !!categoryId,
  });

/** The chain for a category, itself at distance 0 then each ancestor. */
export const useCategoryAncestors = (categoryId: string | null | undefined) =>
  useQuery({
    queryKey: categoryId
      ? inv2CategoryValueKeys.ancestors(categoryId)
      : [...inv2CategoryValueKeys.all, 'ancestors', 'none'],
    queryFn: () => valueResolution.listAncestors(categoryId!),
    enabled: !!categoryId,
  });

function useLinkInvalidation() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: inv2CategoryValueKeys.all });
    // Declaring a value changes what products in the category may offer, and
    // that answer is cached elsewhere. Missing this is how the variant editor
    // went stale across key spaces once already (see CLAUDE.md).
    void qc.invalidateQueries({ queryKey: inv2ValueScopeKeys.all });
    void qc.invalidateQueries({ queryKey: ['inv2', 'variants'] });
    // The legacy key space, feeding CustomizationPicker via
    // useProductAssignedAttributes -> listAttributesForProduct. Verified
    // against src/hooks/inventory/config.ts:73, not guessed.
    void qc.invalidateQueries({ queryKey: ['product-attributes-for'] });
  };
}

export function useSetCategoryValueLink() {
  const invalidate = useLinkInvalidation();
  return useMutation({
    mutationFn: (link: categoryValues.CategoryValueLink) =>
      categoryValues.setCategoryValueLink(link),
    onSuccess: invalidate,
  });
}

export function useRemoveCategoryValueLink() {
  const invalidate = useLinkInvalidation();
  return useMutation({
    mutationFn: (v: { categoryId: string; valueId: string }) =>
      categoryValues.removeCategoryValueLink(v.categoryId, v.valueId),
    onSuccess: invalidate,
  });
}
