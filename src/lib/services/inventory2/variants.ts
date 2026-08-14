/**
 * Inventory 2 — product variant read/write layer. Pass 10C.
 *
 * A variant is a sellable VERSION of a product ("Dining Chair, Large, Walnut")
 * that exists in the catalogue before any physical unit does. That is why
 * variants were chosen over per-unit attributes: V orders from the factory by
 * version, and salespeople pick the version from a list. Neither is possible
 * with a model that can only describe units already held.
 *
 * ONE SERVICE, THREE SURFACES. The config pages, the product form tab and the
 * Sales line dialog all call this module. What differs between them is not the
 * code path but two arguments:
 *
 *   status   config and the product form create 'permanent'; Sales creates
 *            'provisional'. The caller passes it, so a surface cannot create
 *            the wrong kind by forgetting a default.
 *   scope    the config list is unfiltered; the product tab filters to one
 *            product; Sales never lists at all.
 *
 * WHAT THE DATABASE ENFORCES, so this file does not have to:
 *   - combination uniqueness per product (UNIQUE on product_id, combo_key,
 *     maintained by trigger from product_variant_values)
 *   - a value must belong to the attribute it is filed under (composite FK)
 *   - a variant must carry at least one value (deferred constraint trigger)
 *   - archiving is REFUSED while inv_stock_item rows exist
 *   - permanent never regresses to provisional
 *   - no delete: RLS `product_variants_no_delete` is USING(false)
 *
 * Rule 5: nothing here catches. Every one of those refusals is a sentence
 * written to be read by staff, and the callers render it verbatim.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { resolvedValuesForProduct } from './valueResolution';

type Tables = Database['public']['Tables'];
type VariantRow = Tables['product_variants']['Row'];

export type VariantStatus = Database['public']['Enums']['product_variant_status'];
export type ProductMode = Database['public']['Enums']['product_mode'];

/** One attribute → value choice that makes up a combination. */
export interface VariantValue {
  attribute_id: string;
  attribute_name: string;
  value_id: string;
  value: string;
  color_hex: string | null;
}

export interface VariantRecord {
  id: string;
  product_id: string;
  product_name: string | null;
  sku: string;
  name: string;
  barcode: string | null;
  sale_price: number;
  cost_price: number;
  status: VariantStatus;
  combo_key: string | null;
  created_at: string;
  promoted_at: string | null;
  archived_at: string | null;
  /** The combination, resolved for display. */
  values: VariantValue[];
  /** Derived from inv_stock_item — a variant with units cannot be archived. */
  on_hand: number;
}

export interface VariantInput {
  product_id: string;
  sku: string;
  name: string;
  barcode: string | null;
  sale_price: number;
  cost_price: number;
  /** Passed by the caller, never defaulted here. See the header. */
  status: VariantStatus;
  /** attribute_id → value_id. Must be non-empty; the database enforces it too. */
  values: Record<string, string>;
}

/** Editable fields on an existing variant. Status changes go through setStatus. */
export interface VariantPatch {
  sku?: string;
  name?: string;
  barcode?: string | null;
  sale_price?: number;
  cost_price?: number;
}

/* -------------------------------------------------------------------- read */

/**
 * Resolve variants with their combinations and derived stock.
 *
 * Four queries rather than one nested select: PostgREST cannot express
 * "variant → values → attribute AND value" plus a separate aggregate over
 * inv_stock_item in a single round trip without an ambiguous embed. Joining
 * client-side keeps the shape obvious and the row counts here are catalogue
 * scale, not transaction scale.
 */
export async function listVariants(productId?: string): Promise<VariantRecord[]> {
  let variantQuery = supabase
    .from('product_variants')
    .select('*')
    .order('created_at', { ascending: false });
  if (productId) variantQuery = variantQuery.eq('product_id', productId);

  const [variantsRes, valuesRes, attrsRes, attrValsRes, productsRes, stockRes] =
    await Promise.all([
      variantQuery,
      supabase.from('product_variant_values').select('variant_id, attribute_id, value_id'),
      supabase.from('product_attributes').select('id, name, sort_order'),
      supabase.from('product_attribute_values').select('id, value, color_hex'),
      supabase.from('products').select('id, name'),
      supabase.from('inv_stock_item').select('variant_id').not('variant_id', 'is', null),
    ]);

  if (variantsRes.error) throw variantsRes.error;
  if (valuesRes.error) throw valuesRes.error;
  if (attrsRes.error) throw attrsRes.error;
  if (attrValsRes.error) throw attrValsRes.error;
  if (productsRes.error) throw productsRes.error;
  if (stockRes.error) throw stockRes.error;

  const attrById = new Map((attrsRes.data ?? []).map((a) => [a.id, a]));
  const valById = new Map((attrValsRes.data ?? []).map((v) => [v.id, v]));
  const productById = new Map((productsRes.data ?? []).map((p) => [p.id, p.name]));

  const onHand = new Map<string, number>();
  for (const s of stockRes.data ?? []) {
    if (!s.variant_id) continue;
    onHand.set(s.variant_id, (onHand.get(s.variant_id) ?? 0) + 1);
  }

  const valuesByVariant = new Map<string, VariantValue[]>();
  for (const row of valuesRes.data ?? []) {
    const attr = attrById.get(row.attribute_id);
    const val = valById.get(row.value_id);
    const list = valuesByVariant.get(row.variant_id) ?? [];
    list.push({
      attribute_id: row.attribute_id,
      attribute_name: attr?.name ?? '—',
      value_id: row.value_id,
      value: val?.value ?? '—',
      color_hex: val?.color_hex ?? null,
    });
    valuesByVariant.set(row.variant_id, list);
  }
  // Stable display order: attribute sort_order, then name.
  for (const list of valuesByVariant.values()) {
    list.sort((a, b) => {
      const sa = attrById.get(a.attribute_id)?.sort_order ?? 0;
      const sb = attrById.get(b.attribute_id)?.sort_order ?? 0;
      return sa - sb || a.attribute_name.localeCompare(b.attribute_name);
    });
  }

  return (variantsRes.data ?? []).map((v) => toRecord(v, valuesByVariant, productById, onHand));
}

function toRecord(
  v: VariantRow,
  valuesByVariant: Map<string, VariantValue[]>,
  productById: Map<string, string>,
  onHand: Map<string, number>,
): VariantRecord {
  return {
    id: v.id,
    product_id: v.product_id,
    product_name: productById.get(v.product_id) ?? null,
    sku: v.sku,
    name: v.name,
    barcode: v.barcode,
    sale_price: Number(v.sale_price ?? 0),
    cost_price: Number(v.cost_price ?? 0),
    status: v.status,
    combo_key: v.combo_key,
    created_at: v.created_at,
    promoted_at: v.promoted_at,
    archived_at: v.archived_at,
    values: valuesByVariant.get(v.id) ?? [],
    on_hand: onHand.get(v.id) ?? 0,
  };
}

export async function getVariant(id: string): Promise<VariantRecord | null> {
  const all = await listVariants();
  return all.find((v) => v.id === id) ?? null;
}

/* ------------------------------------------------------------------- write */

/**
 * Create a variant and its combination — ONE RPC, one transaction.
 *
 * This cannot be done as two table writes from the client, and the reason is
 * worth keeping: `product_variants_require_values` is a DEFERRABLE INITIALLY
 * DEFERRED constraint trigger, so it fires at TRANSACTION COMMIT and demands
 * the child rows exist by then. PostgREST commits every request separately, so
 * "insert parent, then insert values" commits the parent alone and is refused —
 * correctly. The first version of this function did exactly that and could
 * never have worked.
 *
 * inv_create_variant does both inserts in one transaction, which is what the
 * guard always required and what every other Inventory 2 write already does.
 * There is no half-built row to clean up because there is no window in which
 * one exists.
 */
export async function createVariant(input: VariantInput): Promise<VariantRecord> {
  const values = Object.fromEntries(
    Object.entries(input.values).filter(([, v]) => !!v),
  );

  const { data: newId, error } = await supabase.rpc('inv_create_variant', {
    p_product_id: input.product_id,
    p_sku: input.sku,
    p_name: input.name,
    p_barcode: input.barcode,
    p_sale_price: input.sale_price,
    p_cost_price: input.cost_price,
    p_status: input.status,
    p_values: values,
  });
  if (error) throw error;

  const record = await getVariant(newId as string);
  if (!record) throw new Error('Variant was created but could not be read back.');
  return record;
}

/** Header fields only. The combination is immutable — see the note below. */
export async function updateVariant(id: string, patch: VariantPatch): Promise<void> {
  const row: Tables['product_variants']['Update'] = {};
  if (patch.sku !== undefined) row.sku = patch.sku.trim();
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.barcode !== undefined) row.barcode = patch.barcode?.trim() ? patch.barcode.trim() : null;
  if (patch.sale_price !== undefined) row.sale_price = patch.sale_price;
  if (patch.cost_price !== undefined) row.cost_price = patch.cost_price;
  if (Object.keys(row).length === 0) return;

  const { error } = await supabase.from('product_variants').update(row).eq('id', id);
  if (error) throw error;
}

/**
 * Archive, restore, or promote.
 *
 * Deliberately the only way status moves, so the guard rails stay in one place.
 * The database refuses to archive a variant with stock and refuses to regress a
 * permanent one; both refusals arrive here as sentences and are not softened.
 */
export async function setVariantStatus(id: string, status: VariantStatus): Promise<void> {
  const { error } = await supabase.from('product_variants').update({ status }).eq('id', id);
  if (error) throw error;
}

/* ------------------------------------------------- attribute candidate space */

export interface AttributeOption {
  id: string;
  name: string;
  display_type: string;
  values: {
    id: string;
    value: string;
    color_hex: string | null;
    /** Effective adjustment for this product's category. 0 means "adds nothing". */
    extra_price: number;
    /** Which category declared it — for showing where a value came from. */
    source_category_name: string;
  }[];
}

/**
 * The candidate space for generation, SCOPED TO THE PRODUCT'S CATEGORY.
 *
 * Two things decide what a product may be built from, and they are different
 * questions:
 *   assignment  which ATTRIBUTES this product varies by (Size, Polish)
 *   scoping     which VALUES of those attributes its category allows, and at
 *               what price — `product_category_values_resolved`, nearest wins
 *
 * Before Pass C only the first was applied, so every product offered every
 * value of an assigned attribute and a Dining Chair could be built in a polish
 * only sold on wardrobes. Assignment still creates nothing: a product with 8
 * allowed sizes and 5 allowed polishes offers 40 candidates and only the
 * combinations actually sold get created.
 *
 * NO CATEGORY MEANS NO VALUES. `categoryId: null` comes back with the assigned
 * attributes still listed but every value list empty — deliberately not a
 * fallback to all values, which is the behaviour this replaced. The caller
 * shows the reason; see ProductForm's banner.
 */
export interface AssignedAttributes {
  /** null when the product has no category — the screen must say why. */
  categoryId: string | null;
  categoryName: string | null;
  attributes: AttributeOption[];
}

export async function listAssignedAttributes(productId: string): Promise<AssignedAttributes> {
  const [assignRes, attrsRes, valsRes, scope] = await Promise.all([
    supabase.from('product_attribute_assignments').select('attribute_id').eq('product_id', productId),
    supabase.from('product_attributes').select('id, name, display_type, sort_order').eq('is_active', true),
    supabase.from('product_attribute_values').select('id, attribute_id, value, color_hex, sort_order'),
    resolvedValuesForProduct(productId),
  ]);
  if (assignRes.error) throw assignRes.error;
  if (attrsRes.error) throw attrsRes.error;
  if (valsRes.error) throw valsRes.error;

  const assigned = new Set((assignRes.data ?? []).map((a) => a.attribute_id));
  const valsByAttr = new Map<string, AttributeOption['values']>();
  for (const v of valsRes.data ?? []) {
    // The scope filter. An uncategorised product has an empty map, so nothing
    // survives this line — which is the intended answer, not a failure.
    const allowed = scope.byValueId.get(v.id);
    if (!allowed) continue;
    const list = valsByAttr.get(v.attribute_id) ?? [];
    list.push({
      id: v.id,
      value: v.value,
      color_hex: v.color_hex,
      extra_price: allowed.extraPrice,
      source_category_name: allowed.sourceCategoryName,
    });
    valsByAttr.set(v.attribute_id, list);
  }

  const attributes = (attrsRes.data ?? [])
    .filter((a) => assigned.has(a.id))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
    .map((a) => ({
      id: a.id,
      name: a.name,
      display_type: a.display_type,
      values: valsByAttr.get(a.id) ?? [],
    }));

  return { categoryId: scope.categoryId, categoryName: scope.categoryName, attributes };
}

/** Which products exist, for the config-side variant creator. */
export async function listProductOptions(): Promise<{ id: string; name: string; sku: string; mode: ProductMode }[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sku, mode')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}
