/**
 * Inventory 2 — category → attribute-value scoping. Pass B (config only).
 *
 * Reads and writes `product_category_attribute_values`, the link added in Pass A.
 * A category declares which attribute VALUES products in it may draw on; the
 * values themselves stay shared, so "012" is one row used by many categories,
 * each with its own price.
 *
 * IT IS ENFORCED AS OF PASS C (2026-08-14). The variant editor and the
 * made-to-order picker now offer only what the product's category allows, and
 * price it from the link rather than from the value. Configuring the scoping
 * before it was enforced was deliberate — the order V asked for — so nothing
 * changed underneath anyone when the resolvers were repointed.
 *
 * THIS MODULE HOLDS NO INHERITANCE RULE. The Pass B parent-chain walk is gone;
 * see the note above `buildScopedValues`. The rule lives in
 * `product_category_values_resolved` and is read through ./valueResolution.
 *
 * Rule 5: nothing here catches.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ResolvedValue } from './valueResolution';

export interface CategoryValueLink {
  category_id: string;
  value_id: string;
  attribute_id: string;
  /** Per-category adjustment. NOT NULL — 0 means "adds nothing", never "unset". */
  extra_price: number;
}

/** A value as it appears for one category, with where it came from. */
export interface ScopedValue {
  value_id: string;
  attribute_id: string;
  value: string;
  color_hex: string | null;
  /** Declared on the category being edited. */
  declaredHere: boolean;
  extra_price: number | null;
  /** Inherited from an ancestor: that ancestor's id and name, nearest first. */
  inheritedFrom: { category_id: string; name: string; extra_price: number } | null;
}

/* -------------------------------------------------------------------- read */

/**
 * Every link in the system. Deliberately unfiltered: the config screen needs
 * this category's links AND every ancestor's, and the table is catalogue-scale
 * configuration, not transaction data.
 */
export async function listCategoryValueLinks(): Promise<CategoryValueLink[]> {
  const { data, error } = await supabase
    .from('product_category_attribute_values')
    .select('category_id, value_id, attribute_id, extra_price');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    category_id: r.category_id,
    value_id: r.value_id,
    attribute_id: r.attribute_id,
    extra_price: Number(r.extra_price ?? 0),
  }));
}

/* ------------------------------------------------------------------- write */

/**
 * Declare a value on a category, or change its price.
 *
 * Upsert on the primary key, so ticking a value that is already ticked updates
 * its price rather than failing — the screen treats "declared" and "priced" as
 * one action.
 */
export async function setCategoryValueLink(
  link: CategoryValueLink,
): Promise<void> {
  const { error } = await supabase
    .from('product_category_attribute_values')
    .upsert(
      {
        category_id: link.category_id,
        value_id: link.value_id,
        attribute_id: link.attribute_id,
        extra_price: link.extra_price,
      },
      { onConflict: 'category_id,value_id' },
    );
  if (error) throw error;
}

/**
 * Un-declare a value from a category.
 *
 * A hard delete, and that is correct here: a link is pure configuration —
 * "this category may use this value" — with no history attached. Nothing
 * references it, so removing one erases no record of anything that happened.
 * The same reasoning already applies to product_attribute_assignments.
 */
export async function removeCategoryValueLink(
  categoryId: string,
  valueId: string,
): Promise<void> {
  const { error } = await supabase
    .from('product_category_attribute_values')
    .delete()
    .eq('category_id', categoryId)
    .eq('value_id', valueId);
  if (error) throw error;
}

/* -------------------------------------------------------------- inheritance */

/**
 * THE WALK IS GONE — Pass C, 2026-08-14.
 *
 * `ancestorsOf` and `resolveScopedValues` used to live here and re-derived
 * inheritance in TypeScript. They are archived at
 * `src/_archive/inventory2/categoryValues.walk.legacy.ts` (Rule 4) and replaced
 * by reads of the views, in `./valueResolution`:
 *
 *   listAncestors(categoryId)       product_category_ancestors
 *   listResolvedValues(categoryId)  product_category_values_resolved
 *
 * Two implementations of nearest-wins is one more than the rule can survive.
 * Anything needing inheritance reads the view; this module is now only the
 * link table's CRUD.
 *
 * `buildScopedValues` below is the ONE piece of client logic that remains, and
 * it deliberately holds no inheritance rule: it merges this category's own
 * links with an ALREADY-RESOLVED inherited set that the caller fetched from the
 * view. It exists because the config screen must preview an UNSAVED reparent,
 * which the view cannot do — the view resolves from the saved
 * parent_category_id. The caller resolves for the PENDING parent instead and
 * hands the result in, so the rule still comes from SQL either way.
 */
export function buildScopedValues(
  categoryId: string,
  attributeValues: { id: string; attribute_id: string; value: string; color_hex: string | null }[],
  links: CategoryValueLink[],
  /** What the PENDING parent offers — already resolved by the view. */
  inheritedFromParent: ResolvedValue[],
  /** Names by category id, for labelling where an inherited value came from. */
  categoryNames: Map<string, string>,
): ScopedValue[] {
  const own = new Map(
    links.filter((l) => l.category_id === categoryId).map((l) => [l.value_id, l]),
  );
  const inherited = new Map(inheritedFromParent.map((r) => [r.valueId, r]));

  return attributeValues.map((v) => {
    const mine = own.get(v.id);
    const up = inherited.get(v.id);
    return {
      value_id: v.id,
      attribute_id: v.attribute_id,
      value: v.value,
      color_hex: v.color_hex,
      declaredHere: !!mine,
      extra_price: mine ? mine.extra_price : null,
      inheritedFrom: up
        ? {
            category_id: up.sourceCategoryId,
            // The view already names the winning declaration; the map is only a
            // fallback for a category the caller happens to have loaded.
            name: up.sourceCategoryName || categoryNames.get(up.sourceCategoryId) || '—',
            extra_price: up.extraPrice,
          }
        : null,
    };
  });
}
