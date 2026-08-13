/**
 * Shared helpers for the thin config pages (Categories, Attributes, UoM).
 *
 * The tree helpers mirror the ones in `locationPath.ts` but for
 * `product_categories.parent_category_id`, which is the same nullable self-FK
 * shape (`ON DELETE SET NULL`). Kept separate rather than generalised because
 * locations root their path at the warehouse and categories have no such root.
 *
 * Every option list below mirrors a live CHECK constraint:
 *   product_attributes.display_type  CHECK (radio | select | color | pills)
 *   units_of_measure.uom_type        CHECK (unit | reference | bigger | smaller)
 */
import type { AttributeDisplayType } from '@/lib/services/inventory/attributes';
import type { UomType } from '@/lib/services/inventory/unitsOfMeasure';

export const PATH_SEPARATOR = ' / ';

interface TreeNode {
  id: string;
  name: string;
  parentCategoryId?: string | null;
}

export function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]));
}

/**
 * Full path through the parent chain, e.g. "Furniture / Seating / Sofas".
 * Cycle-guarded: nothing in the database prevents a loop in
 * parent_category_id, so a bad row degrades to a partial path rather than
 * hanging the render.
 */
export function categoryPath<T extends TreeNode>(node: T, byId: Map<string, T>): string {
  const chain: string[] = [node.name];
  const seen = new Set<string>([node.id]);
  let cursor = node.parentCategoryId ? byId.get(node.parentCategoryId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    chain.unshift(cursor.name);
    seen.add(cursor.id);
    cursor = cursor.parentCategoryId ? byId.get(cursor.parentCategoryId) : undefined;
  }
  return chain.join(PATH_SEPARATOR);
}

/**
 * `rootId` plus every descendant. The parent dropdown excludes these, so a
 * category cannot be reparented under itself or one of its own children —
 * which would orphan the subtree and the database would accept it.
 */
export function descendantIdsOf<T extends TreeNode>(rootId: string, nodes: T[]): Set<string> {
  const childrenByParent = new Map<string, T[]>();
  for (const n of nodes) {
    if (!n.parentCategoryId) continue;
    const bucket = childrenByParent.get(n.parentCategoryId);
    if (bucket) bucket.push(n);
    else childrenByParent.set(n.parentCategoryId, [n]);
  }
  const blocked = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const child of childrenByParent.get(cur) ?? []) {
      if (blocked.has(child.id)) continue;
      blocked.add(child.id);
      queue.push(child.id);
    }
  }
  return blocked;
}

/* ------------------------------------------------------------- attributes */

export const DISPLAY_TYPE_OPTIONS: AttributeDisplayType[] = ['radio', 'select', 'color', 'pills'];

export const DISPLAY_TYPE_LABELS: Record<AttributeDisplayType, string> = {
  radio: 'Radio buttons',
  select: 'Dropdown',
  color: 'Colour swatches',
  pills: 'Pills',
};

export function displayTypeLabel(t: string): string {
  return DISPLAY_TYPE_LABELS[t as AttributeDisplayType] ?? t;
}

/* -------------------------------------------------------------------- uom */

export const UOM_TYPE_OPTIONS: UomType[] = ['reference', 'bigger', 'smaller', 'unit'];

export const UOM_TYPE_LABELS: Record<UomType, string> = {
  reference: 'Reference for this category',
  bigger: 'Bigger than the reference',
  smaller: 'Smaller than the reference',
  unit: 'Standalone unit',
};

export function uomTypeLabel(t: string): string {
  return UOM_TYPE_LABELS[t as UomType] ?? t;
}
