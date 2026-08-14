/**
 * Inventory 2 — reading the category-scoped value resolution. Pass C.
 *
 * THIS MODULE HOLDS NO RULE. The rule — nearest declaration wins — lives in
 * `product_category_values_resolved`, applied 2026-08-14. Everything here is a
 * read of that view plus the mapping into camelCase. If you find yourself
 * walking parent_category_id in TypeScript, stop: that walk is what Pass C
 * removed, and a second implementation is how the two copies drift apart.
 *
 * Both resolvers go through here:
 *   listAssignedAttributes   (services/inventory2/variants.ts) — variant editor
 *   listAttributesForProduct (services/inventory/attributes.ts) — the
 *                            made-to-order CustomizationPicker
 *
 * The second one lives in the legacy service that CLAUDE.md records as
 * unmovable. Importing this module FROM there is deliberate and is the only
 * direction that is safe: the new module never imports the legacy one, so the
 * legacy service can still be retired later without unpicking this.
 *
 * THE UNCATEGORISED CASE IS NOT AN ERROR AND NOT A FALLBACK. A product with no
 * category offers no values, because there is no category to have declared any.
 * Falling back to "all values" would silently restore the behaviour the whole
 * feature exists to remove. Callers get an explicit null categoryId and say so
 * on screen.
 *
 * Rule 5: nothing here catches.
 */
import { supabase } from '@/integrations/supabase/client';

/** One value a category may offer, with the declaration that won. */
export interface ResolvedValue {
  valueId: string;
  attributeId: string;
  /** The effective adjustment. NOT NULL upstream — 0 means "adds nothing". */
  extraPrice: number;
  /** Which category's declaration supplied the price. */
  sourceCategoryId: string;
  sourceCategoryName: string;
  /** 0 = declared on this category itself; 1+ = inherited from that far up. */
  distance: number;
  /** Declared here AND available from an ancestor — this one won. */
  overridesAncestor: boolean;
}

export interface CategoryAncestor {
  categoryId: string;
  name: string;
  /** 0 is the category itself. */
  distance: number;
}

/**
 * Everything `categoryId` offers, one row per value, nearest declaration
 * winning. A category that declares and inherits nothing returns [].
 */
export async function listResolvedValues(categoryId: string): Promise<ResolvedValue[]> {
  const { data, error } = await supabase
    .from('product_category_values_resolved')
    .select(
      'value_id, attribute_id, extra_price, source_category_id, source_category_name, distance, overrides_ancestor',
    )
    .eq('category_id', categoryId);
  if (error) throw error;

  // The view's columns are all NOT NULL at source; Postgres simply cannot say
  // so through a view, which is why the generated types are nullable. Rows are
  // narrowed rather than asserted so a genuinely malformed row is dropped
  // instead of becoming a NaN price further downstream.
  return (data ?? [])
    .filter((r) => r.value_id !== null && r.attribute_id !== null)
    .map((r) => ({
      valueId: r.value_id as string,
      attributeId: r.attribute_id as string,
      extraPrice: Number(r.extra_price ?? 0),
      sourceCategoryId: r.source_category_id as string,
      sourceCategoryName: r.source_category_name ?? '—',
      distance: Number(r.distance ?? 0),
      overridesAncestor: r.overrides_ancestor === true,
    }));
}

/**
 * The chain for `categoryId`, itself at distance 0 then each ancestor.
 *
 * Read from `product_category_ancestors` rather than walked here — same view,
 * same cycle guard, so a config screen and a resolver can never disagree about
 * what an ancestor is.
 */
export async function listAncestors(categoryId: string): Promise<CategoryAncestor[]> {
  const { data, error } = await supabase
    .from('product_category_ancestors')
    .select('ancestor_id, ancestor_name, distance')
    .eq('category_id', categoryId)
    .order('distance');
  if (error) throw error;

  return (data ?? [])
    .filter((r) => r.ancestor_id !== null)
    .map((r) => ({
      categoryId: r.ancestor_id as string,
      name: r.ancestor_name ?? '—',
      distance: Number(r.distance ?? 0),
    }));
}

/**
 * A product's category, or null.
 *
 * Its own function because "which category" is the question every resolver has
 * to ask first, and null is a meaningful answer rather than a missing row.
 */
export async function getProductCategoryId(
  productId: string,
): Promise<{ categoryId: string | null; categoryName: string | null }> {
  const { data, error } = await supabase
    .from('products')
    .select('category_id')
    .eq('id', productId)
    .maybeSingle();
  if (error) throw error;

  const categoryId = data?.category_id ?? null;
  if (!categoryId) return { categoryId: null, categoryName: null };

  // A second read rather than an embed: `products` reaches product_categories
  // by more than one path historically (the legacy `category` text column), and
  // a resolver is the wrong place to depend on PostgREST picking the right one.
  const { data: cat, error: catErr } = await supabase
    .from('product_categories')
    .select('name')
    .eq('id', categoryId)
    .maybeSingle();
  if (catErr) throw catErr;

  return { categoryId, categoryName: cat?.name ?? null };
}

/**
 * The resolved set for a product, keyed by value id for O(1) filtering.
 *
 * `categoryId === null` is the uncategorised case: an EMPTY map, never a
 * fallback to every value.
 */
export async function resolvedValuesForProduct(productId: string): Promise<{
  categoryId: string | null;
  categoryName: string | null;
  byValueId: Map<string, ResolvedValue>;
}> {
  const { categoryId, categoryName } = await getProductCategoryId(productId);
  if (!categoryId) return { categoryId: null, categoryName: null, byValueId: new Map() };

  const resolved = await listResolvedValues(categoryId);
  return {
    categoryId,
    categoryName,
    byValueId: new Map(resolved.map((r) => [r.valueId, r])),
  };
}
