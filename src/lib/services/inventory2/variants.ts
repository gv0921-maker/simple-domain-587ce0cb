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
 * Create a variant and its combination.
 *
 * Two statements, not one: the values are a child table, and the parent id is
 * only known after the insert. If the child insert fails — a duplicate
 * combination trips the unique index on the trigger-maintained combo_key — the
 * parent row is left behind, so it is removed on the way out. That cleanup is
 * NOT a Rule 4 deletion: it removes a half-built row this call created moments
 * earlier and that no one has seen, not a record with meaning. RLS forbids
 * deleting variants, so the tidy-up is best-effort and the original error is
 * always the one that surfaces.
 */
export async function createVariant(input: VariantInput): Promise<VariantRecord> {
  const entries = Object.entries(input.values).filter(([, v]) => !!v);
  if (entries.length === 0) {
    throw new Error(
      'A variant must state the combination it stands for — choose a value for at least one attribute.',
    );
  }

  const { data: created, error: createErr } = await supabase
    .from('product_variants')
    .insert({
      product_id: input.product_id,
      sku: input.sku.trim(),
      name: input.name.trim(),
      barcode: input.barcode?.trim() ? input.barcode.trim() : null,
      sale_price: input.sale_price,
      cost_price: input.cost_price,
      status: input.status,
    })
    .select('id')
    .single();
  if (createErr) throw createErr;

  const { error: valuesErr } = await supabase.from('product_variant_values').insert(
    entries.map(([attribute_id, value_id]) => ({
      variant_id: created.id,
      attribute_id,
      value_id,
    })),
  );

  if (valuesErr) {
    await supabase.from('product_variants').delete().eq('id', created.id);
    throw valuesErr;
  }

  const record = await getVariant(created.id);
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
  values: { id: string; value: string; color_hex: string | null }[];
}

/**
 * The attributes assigned to a product, with their values — the candidate space
 * for generation. Assignment defines what MAY be combined; it creates nothing.
 * Generation is opt-in per combination, so a product with 8 sizes and 5 polishes
 * offers 40 candidates and creates only the ones actually sold.
 */
export async function listAssignedAttributes(productId: string): Promise<AttributeOption[]> {
  const [assignRes, attrsRes, valsRes] = await Promise.all([
    supabase.from('product_attribute_assignments').select('attribute_id').eq('product_id', productId),
    supabase.from('product_attributes').select('id, name, display_type, sort_order').eq('is_active', true),
    supabase.from('product_attribute_values').select('id, attribute_id, value, color_hex, sort_order'),
  ]);
  if (assignRes.error) throw assignRes.error;
  if (attrsRes.error) throw attrsRes.error;
  if (valsRes.error) throw valsRes.error;

  const assigned = new Set((assignRes.data ?? []).map((a) => a.attribute_id));
  const valsByAttr = new Map<string, AttributeOption['values']>();
  for (const v of valsRes.data ?? []) {
    const list = valsByAttr.get(v.attribute_id) ?? [];
    list.push({ id: v.id, value: v.value, color_hex: v.color_hex });
    valsByAttr.set(v.attribute_id, list);
  }

  return (attrsRes.data ?? [])
    .filter((a) => assigned.has(a.id))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
    .map((a) => ({
      id: a.id,
      name: a.name,
      display_type: a.display_type,
      values: valsByAttr.get(a.id) ?? [],
    }));
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
