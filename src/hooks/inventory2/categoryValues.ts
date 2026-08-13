/**
 * Inventory 2 — category value-scoping hooks. Pass B.
 *
 * Error policy (Rule 5): nothing catches; the caller renders the message inline.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as categoryValues from '@/lib/services/inventory2/categoryValues';

export const inv2CategoryValueKeys = {
  all: ['inv2', 'categoryValues'] as const,
  links: () => [...inv2CategoryValueKeys.all, 'links'] as const,
};

export const useCategoryValueLinks = () =>
  useQuery({
    queryKey: inv2CategoryValueKeys.links(),
    queryFn: categoryValues.listCategoryValueLinks,
  });

function useLinkInvalidation() {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: inv2CategoryValueKeys.all }); };
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
