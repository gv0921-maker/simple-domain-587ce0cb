/**
 * ARCHIVED 2026-08-14 (Pass C). Not imported by anything. Kept under Rule 4.
 *
 * These two functions were the DISPLAY-ONLY inheritance walk added in Pass B,
 * when nothing resolved category-scoped values and the config screen needed to
 * name an ancestor by itself. Pass C replaced them with a read of
 * `product_category_values_resolved` / `product_category_ancestors`, which is
 * the single definition of nearest-wins.
 *
 * They are archived rather than kept because a second implementation of the
 * same rule is exactly how the two copies drift. If you need an ancestor chain,
 * read the view — see src/lib/services/inventory2/valueResolution.ts.
 *
 * The one thing worth remembering from this code: `resolveScopedValues` treated
 * "declared here AND inherited" as an override and showed both, deliberately,
 * because Pass B had not yet decided which price wins. Pass C decided: nearest.
 */
export interface ArchivedCategoryValueLink {
  category_id: string;
  value_id: string;
  attribute_id: string;
  extra_price: number;
}

export interface ArchivedScopedValue {
  value_id: string;
  attribute_id: string;
  value: string;
  color_hex: string | null;
  declaredHere: boolean;
  extra_price: number | null;
  inheritedFrom: { category_id: string; name: string; extra_price: number } | null;
}

interface CategoryNode {
  id: string;
  name: string;
  parentCategoryId?: string | null;
}

/** The ancestor chain of a category, nearest parent first. Cycle-guarded. */
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

/** Own declarations plus everything inherited, each marked with its origin. */
export function resolveScopedValues(
  categoryId: string,
  attributeValues: { id: string; attribute_id: string; value: string; color_hex: string | null }[],
  links: ArchivedCategoryValueLink[],
  ancestors: CategoryNode[],
): ArchivedScopedValue[] {
  const own = new Map(
    links.filter((l) => l.category_id === categoryId).map((l) => [l.value_id, l]),
  );

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
