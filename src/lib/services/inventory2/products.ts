/**
 * Inventory 2 — product read/write layer. Pass 9.
 *
 * THIS IS THE FIRST INVENTORY 2 FILE THAT WRITES `products`.
 *
 * `products` is shared with Sales: 37 tables carry a FK to products.id and
 * ~24 call sites read it across sales, invoicing, manufacturing, reports and
 * dashboards. The write surface below is therefore deliberately narrow and
 * enumerated in one place (`WRITABLE`), so a future reader can see the whole
 * boundary without reading the form.
 *
 * WHAT THIS FILE MUST NEVER WRITE, and why:
 *
 *   stock_on_hand   Legacy running total, maintained by the two old RPCs
 *                   (inv_approve_adjustment, inv_validate_stock_move). It is
 *                   already wrong — it reads 10 for the one product that has
 *                   24 units in inv_stock_item — and Inventory 2 derives stock
 *                   from inv_stock_item instead. Writing it would make a stale
 *                   column look authoritative again. Read the derived figure
 *                   via `getProductOnHand()`.
 *
 *   sale_price      Sales-owned. Feeds order_lines, quotation_lines,
 *                   invoice_lines and pricelist_items. Displayed read-only.
 *
 *   category,       The legacy free-text pair. Both are NOT NULL with defaults
 *   unit_of_measure ('' and 'unit'), so an INSERT that omits them succeeds and
 *                   they simply stay at their default. We write the FK columns
 *                   `category_id` / `uom_id` instead, which is what the config
 *                   tables were built for. Writing the text columns is how the
 *                   one existing row ended up with a category ("Furniture")
 *                   and a UoM ("Units") matching no configured row.
 *
 *   track_serials   Not exposed yet — see the note on ProductDetail.track_serials.
 *
 *   variants        Legacy JSONB. Superseded by product_attribute_assignments,
 *                   which is empty and unused. Left untouched.
 *
 *   discontinued_at, discontinuation_reason
 *                   No code in the repository reads either column.
 *
 * DELETE IS NOT IMPLEMENTED. RLS policy `products_no_delete` is USING(false),
 * and 37 foreign keys reference products.id. Deactivate via is_active instead.
 * (The legacy path at services/inventory/api.ts:397 does attempt a delete; it
 * silently affects zero rows and still reports success. Not fixed here — that
 * is legacy inventory code and its own pass.)
 *
 * PERMISSIONS: RLS requires is_admin() for INSERT and UPDATE. A non-admin gets
 * a Postgres permission error, which propagates verbatim per Rule 5.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Tables = Database['public']['Tables'];
type ProductRow = Tables['products']['Row'];

export type InvStockStatus = Database['public']['Enums']['inv_stock_status'];

/** CHECK products_type_check. */
export const PRODUCT_TYPES = ['stockable', 'consumable', 'service'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** CHECK products_cost_method_check. */
export const COST_METHODS = ['average', 'fifo', 'lifo'] as const;
export type CostMethod = (typeof COST_METHODS)[number];

/** enum product_mode. Which selling path the product uses. */
export const PRODUCT_MODES = ['stocked', 'made_to_order', 'both'] as const;
export type ProductMode = (typeof PRODUCT_MODES)[number];

/**
 * The entire write surface, approved in Pass 9 Part B. Anything not in this
 * list is read-only from Inventory 2. Kept as a const array rather than only a
 * type so `pickWritable()` can enforce it at runtime — a typo in the form
 * cannot smuggle an extra column into the update.
 */
export const WRITABLE = [
  'sku',
  'name',
  'type',
  'description',
  'cost_price',
  'reorder_level',
  'cost_method',
  'barcode',
  'track_inventory',
  'is_active',
  'category_id',
  'uom_id',
  // Inventory-owned physical attributes. Nothing outside inventory reads
  // either column, so they carry none of sale_price's shared-ownership risk.
  'weight',
  'volume',
  // Pass 10C. Which selling path this product uses: stocked (pick a variant),
  // made_to_order (customization picker), or both. Explicit rather than
  // inferred from product_attribute_assignments — inference would let the same
  // chair be recorded two different ways, which is the thing this column exists
  // to prevent.
  'mode',
  // Pass 10D. sale_price is now INVENTORY-owned: V's ownership decision is that
  // products belong to Inventory and every other module consumes them. Safe to
  // edit because no document recalculates from it — order_lines,
  // quotation_lines, invoice_lines and subscription_lines each carry their own
  // NOT NULL unit_price, snapshotted when the line is created. Changing the
  // catalogue price seeds the NEXT line and cannot rewrite a past one.
  'sale_price',
  // Both gate which products may appear on a restricted invoice type
  // (pages/invoicing/InvoiceForm.tsx): warranty invoices filter to
  // warranty_eligible, factory invoices to factory_eligible, and adding an
  // ineligible product is refused. Inventory-owned facts about the product.
  'warranty_eligible',
  'factory_eligible',
] as const;

export type WritableColumn = (typeof WRITABLE)[number];

export interface ProductInput {
  sku: string;
  name: string;
  type: ProductType;
  description: string | null;
  cost_price: number;
  reorder_level: number;
  cost_method: CostMethod;
  barcode: string | null;
  track_inventory: boolean;
  is_active: boolean;
  category_id: string | null;
  uom_id: string | null;
  /** numeric(14,3), nullable — blank means "not recorded", not zero. */
  weight: number | null;
  volume: number | null;
  mode: ProductMode;
  /** Inventory-owned since Pass 10D. Sales reads it; nothing recalculates from it. */
  sale_price: number;
  warranty_eligible: boolean;
  factory_eligible: boolean;
}

export interface ProductListRow {
  id: string;
  sku: string;
  name: string;
  type: string;
  is_active: boolean;
  barcode: string | null;
  cost_price: number;
  sale_price: number;
  reorder_level: number;
  category_name: string | null;
  uom_name: string | null;
  /** Derived from inv_stock_item. NOT products.stock_on_hand. */
  on_hand: number;
}

export interface ProductDetail extends ProductInput {
  id: string;
  /**
   * Read-only in this pass. The flag is false on the one product in the
   * database, which nonetheless carries 24 serial-identified units, because
   * nothing in Inventory 2 consults it — inv_stock_item.serial is NOT NULL, so
   * every unit is serial-identified by construction. Exposing a toggle that
   * changes nothing would be worse than exposing no toggle.
   */
  track_serials: boolean;
  /** Legacy free-text, shown so the drift is visible. Never written. */
  legacy_category_text: string;
  legacy_uom_text: string;
  /** Legacy running total, shown only to be contradicted. Never written. */
  legacy_stock_on_hand: number;
  created_at: string;
  updated_at: string;
}

export interface OnHandBucket {
  location_id: string | null;
  location_name: string | null;
  status: InvStockStatus | null;
  qty: number;
  qty_reserved: number;
  qty_unreserved: number;
}

export interface CategoryOption {
  id: string;
  name: string;
}

export interface UomOption {
  id: string;
  name: string;
  abbreviation: string | null;
}

/* -------------------------------------------------------------------- read */

/**
 * The list. On-hand is derived per product from inv_on_hand (which groups
 * inv_stock_item by product/location/status), never read from
 * products.stock_on_hand.
 */
export async function listProducts(): Promise<ProductListRow[]> {
  const [productsRes, onHandRes, catsRes, uomsRes] = await Promise.all([
    supabase
      .from('products')
      .select(
        'id, sku, name, type, is_active, barcode, cost_price, sale_price, reorder_level, category_id, uom_id',
      )
      .order('name'),
    supabase.from('inv_on_hand').select('product_id, qty'),
    supabase.from('product_categories').select('id, name'),
    supabase.from('units_of_measure').select('id, name'),
  ]);

  if (productsRes.error) throw productsRes.error;
  if (onHandRes.error) throw onHandRes.error;
  if (catsRes.error) throw catsRes.error;
  if (uomsRes.error) throw uomsRes.error;

  const onHand = new Map<string, number>();
  for (const r of onHandRes.data ?? []) {
    if (!r.product_id) continue;
    onHand.set(r.product_id, (onHand.get(r.product_id) ?? 0) + Number(r.qty ?? 0));
  }
  const catName = new Map((catsRes.data ?? []).map((c) => [c.id, c.name]));
  const uomName = new Map((uomsRes.data ?? []).map((u) => [u.id, u.name]));

  return (productsRes.data ?? []).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    type: p.type,
    is_active: p.is_active,
    barcode: p.barcode,
    cost_price: Number(p.cost_price ?? 0),
    sale_price: Number(p.sale_price ?? 0),
    reorder_level: Number(p.reorder_level ?? 0),
    category_name: p.category_id ? (catName.get(p.category_id) ?? null) : null,
    uom_name: p.uom_id ? (uomName.get(p.uom_id) ?? null) : null,
    on_hand: onHand.get(p.id) ?? 0,
  }));
}

export async function getProduct(id: string): Promise<ProductDetail | null> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toDetail(data);
}

function toDetail(r: ProductRow): ProductDetail {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    type: r.type as ProductType,
    description: r.description,
    cost_price: Number(r.cost_price ?? 0),
    reorder_level: Number(r.reorder_level ?? 0),
    cost_method: r.cost_method as CostMethod,
    barcode: r.barcode,
    track_inventory: r.track_inventory,
    is_active: r.is_active,
    category_id: r.category_id,
    uom_id: r.uom_id,
    mode: r.mode as ProductMode,
    // Null is meaningful here — it distinguishes "never measured" from 0.
    weight: r.weight == null ? null : Number(r.weight),
    volume: r.volume == null ? null : Number(r.volume),
    sale_price: Number(r.sale_price ?? 0),
    warranty_eligible: r.warranty_eligible,
    factory_eligible: r.factory_eligible,

    track_serials: r.track_serials,
    legacy_category_text: r.category ?? '',
    legacy_uom_text: r.unit_of_measure ?? '',
    legacy_stock_on_hand: Number(r.stock_on_hand ?? 0),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * The derived stock figure, split by location and status — the replacement for
 * products.stock_on_hand. A flat total hides that "24 units" can be 8 sellable
 * and 16 held back, which is exactly the ambiguity the legacy column had.
 */
export async function getProductOnHand(productId: string): Promise<OnHandBucket[]> {
  const [onHandRes, locRes] = await Promise.all([
    supabase
      .from('inv_on_hand')
      .select('location_id, status, qty, qty_reserved, qty_unreserved')
      .eq('product_id', productId),
    supabase.from('inv_location').select('id, name'),
  ]);
  if (onHandRes.error) throw onHandRes.error;
  if (locRes.error) throw locRes.error;

  const locName = new Map((locRes.data ?? []).map((l) => [l.id, l.name]));

  return (onHandRes.data ?? []).map((r) => ({
    location_id: r.location_id,
    location_name: r.location_id ? (locName.get(r.location_id) ?? null) : null,
    status: r.status,
    qty: Number(r.qty ?? 0),
    qty_reserved: Number(r.qty_reserved ?? 0),
    qty_unreserved: Number(r.qty_unreserved ?? 0),
  }));
}

export async function listCategories(): Promise<CategoryOption[]> {
  const { data, error } = await supabase
    .from('product_categories')
    .select('id, name')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listUoms(): Promise<UomOption[]> {
  const { data, error } = await supabase
    .from('units_of_measure')
    .select('id, name, abbreviation')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

/* ------------------------------------------------------------------- write */

/**
 * Reduce an input to exactly the approved columns. Runtime enforcement of the
 * boundary, not just a type: an extra key on the object is dropped here rather
 * than sent to Postgres.
 */
function pickWritable(input: ProductInput): Record<string, unknown> {
  const source = input as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const col of WRITABLE) {
    if (source[col] !== undefined) out[col] = source[col];
  }
  return out;
}

/**
 * Create. `category` and `unit_of_measure` are omitted on purpose — they are
 * NOT NULL with defaults, so Postgres fills them and we never write the legacy
 * text pair.
 *
 * No catch: an RLS refusal (non-admin) or a duplicate SKU surfaces verbatim.
 */
export async function createProduct(input: ProductInput): Promise<ProductDetail> {
  const { data, error } = await supabase
    .from('products')
    .insert(pickWritable(input) as Tables['products']['Insert'])
    .select('*')
    .single();
  if (error) throw error;
  return toDetail(data);
}

export async function updateProduct(
  id: string,
  input: ProductInput,
): Promise<ProductDetail> {
  const { data, error } = await supabase
    .from('products')
    .update(pickWritable(input) as Tables['products']['Update'])
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return toDetail(data);
}
