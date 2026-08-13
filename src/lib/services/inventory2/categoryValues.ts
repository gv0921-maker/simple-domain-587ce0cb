/**
 * Inventory 2 — category → attribute-value scoping. Pass B (config only).
 *
 * Reads and writes `product_category_attribute_values`, the link added in Pass A.
 * A category declares which attribute VALUES products in it may draw on; the
 * values themselves stay shared, so "012" is one row used by many categories,
 * each with its own price.
 *
 * NOTHING RESOLVES THROUGH THIS YET. The variant editor and the made-to-order
 * picker still offer every value of an assigned attribute — that repoint is
 * Pass C. This module exists so the scoping can be configured before it is
 * enforced, which is the order V asked for.
 *
 * INHERITANCE IS DISPLAY-ONLY HERE. `resolveInherited` walks the parent chain to
 * show where an inherited value came from, because the configuration screen has
 * to name the ancestor. The AUTHORITATIVE resolver is the WITH RECURSIVE view
 * planned for Pass C — one definition, read by both consumers. When that lands,
 * this walk should be re-pointed at it rather than left as a second
 * implementation of the same rule.
 *
 * Rule 5: nothing here catches.
 */
import { supabase } from '@/integrations/supabase/client';

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

interface CategoryNode {
  id: string;
  name: string;
  parentCategoryId?: string | null;
}

/**
 * The ancestor chain of a category, nearest parent first.
 *
 * Cycle-guarded for the same reason `categoryPath` is: nothing in the database
 * prevents a loop in parent_category_id, and a config screen must degrade to a
 * partial chain rather than hang.
 */
export function ancestorsOf<T extends CategoryNode>(
  categoryId: string,
  byId: Map<string, T>,
): T[] {
  const chain: T[] = [];
  const seen = new Set<string>([categoryId]);
  let cursor = byId.get(categoryId)?.parentCategoryId
    ? byId.get(byId.get(categoryId)!.parentCategoryId!)
    : undefined;
  while (cursor && !seen.has(cursor.id)) {
    chain.push(cursor);
    seen.add(cursor.id);
    cursor = cursor.parentCategoryId ? byId.get(cursor.parentCategoryId) : undefined;
  }
  return chain;
}

/**
 * What one category offers for one attribute: its own declarations plus
 * everything inherited from ancestors, each marked with its origin.
 *
 * A value can be BOTH declared here and inherited. That is not an error — it is
 * how a category overrides an ancestor's price. Which price wins at resolution
 * time is a Pass C decision; this screen shows both so the choice is visible
 * rather than hidden.
 */
export function resolveScopedValues(
  categoryId: string,
  attributeValues: { id: string; attribute_id: string; value: string; color_hex: string | null }[],
  links: CategoryValueLink[],
  ancestors: CategoryNode[],
): ScopedValue[] {
  const own = new Map(
    links.filter((l) => l.category_id === categoryId).map((l) => [l.value_id, l]),
  );

  // Nearest ancestor wins for the "inherited from" label — walking in order and
  // keeping the first hit means a grandparent never masks a parent.
  const inherited = new Map<string, { category_id: string; name: string; extra_price: number }>();
  for (const a of ancestors) {
    for (const l of links) {
      if (l.category_id !== a.id) continue;
      if (inherited.has(l.value_id)) continue;
      inherited.set(l.value_id, { category_id: a.id, name: a.name, extra_price: l.extra_price });
    }
  }

  return attributeValues.map((v) => {
    const mine = own.get(v.id);
    return {
      value_id: v.id,
      attribute_id: v.attribute_id,
      value: v.value,
      color_hex: v.color_hex,
      declaredHere: !!mine,
      extra_price: mine ? mine.extra_price : null,
      inheritedFrom: inherited.get(v.id) ?? null,
    };
  });
}
