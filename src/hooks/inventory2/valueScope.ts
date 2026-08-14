/**
 * Inventory 2 — "which category is this product in, and does it declare
 * anything?" Pass C.
 *
 * Exists for the screens that render values WITHOUT going through
 * listAssignedAttributes — CustomizationPicker being the one that matters. It
 * gets its attributes from the legacy hook, so it has no other way to tell an
 * empty dropdown caused by "no category" from one caused by "nothing declared".
 * Both are now possible and they need different sentences.
 *
 * Rule 5: nothing catches; the caller renders the message.
 */
import { useQuery } from '@tanstack/react-query';
import {
  getProductCategoryId, listResolvedValues,
} from '@/lib/services/inventory2/valueResolution';

export const inv2ValueScopeKeys = {
  all: ['inv2', 'valueScope'] as const,
  forProduct: (productId: string) => [...inv2ValueScopeKeys.all, productId] as const,
};

export interface ProductValueScope {
  categoryId: string | null;
  categoryName: string | null;
  /** How many values the category offers in total, across all attributes. */
  declaredCount: number;
}

export const useInv2ProductValueScope = (productId: string | undefined) =>
  useQuery<ProductValueScope>({
    queryKey: productId
      ? inv2ValueScopeKeys.forProduct(productId)
      : [...inv2ValueScopeKeys.all, 'none'],
    enabled: !!productId,
    queryFn: async () => {
      const { categoryId, categoryName } = await getProductCategoryId(productId!);
      if (!categoryId) return { categoryId: null, categoryName: null, declaredCount: 0 };
      const resolved = await listResolvedValues(categoryId);
      return { categoryId, categoryName, declaredCount: resolved.length };
    },
  });
