/**
 * Inventory 2 — the scan engine's data layer.
 *
 * DOCUMENT-TYPE-AGNOSTIC BY CONSTRUCTION. Everything in this file works on
 * inv_operation / inv_move / inv_move_line, which all four operation kinds
 * (receipt, internal, outgoing, adjustment) already share. Nothing here knows
 * what a receipt is. The kind-specific verb lives behind `ScanAdapter`, and the
 * only implementation today is `scanReceipt.ts` — generalising means ADDING an
 * adapter file, not editing this one.
 *
 * ── THE ONE RULE THAT IS EASY TO GET WRONG ────────────────────────────────
 * A unit's "from" location is `inv_stock_item.location_id` — where the unit
 * ACTUALLY IS. It is never `inv_operation.source_location_id`.
 *
 * On a receipt the two coincide, because the unit is created at the operation's
 * source. So a mistake here is completely invisible today and would only
 * surface later, as every transfer/delivery adapter failing against
 * inv_transfer_stock_item's guard:
 *
 *   'Stock item % (serial %) is not where it was expected: it is in location %,
 *    but the caller expected %. Refusing to move it.'
 *
 * The defence is structural rather than a comment: `CommitUnitInput` carries
 * the resolved unit's own `currentLocationId` and has NO field for the
 * document's source location. An adapter cannot reach for the wrong value
 * because the wrong value is not in scope.
 *
 * ── SCAN FLAGS ARE UI POLICY, NOT DATA INTEGRITY ──────────────────────────
 * `mandatory_scan_product`, `mandatory_scan_serial`, `mandatory_scan_dest_location`
 * and `allow_extra_products` are read from inv_operation_type and honoured by
 * the screen. Pass 7 Part A checked every trigger, RPC, constraint and view:
 * NONE of them is enforced in the database. The database will happily accept a
 * unit that was never scanned, and it will accept more units than were ordered
 * (RCP/2627/0001 carries 12 units against a demand of 10). Only
 * `locks_destination` has real teeth, inside inv_create_receipt.
 *
 * So these flags describe what the screen promises, not what the data
 * guarantees. Do not read a passing scan flow as proof the data is clean.
 *
 * WRITES: none in this file. Units enter stock only through the sanctioned
 * RPCs called by an adapter. inv_stock_item, inv_move_line and
 * inv_stock_tracking are never written directly.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Enums = Database['public']['Enums'];

export type ScanDocKind = Enums['inv_operation_kind'];
export type ScanDocState = Enums['inv_operation_state'];
export type InvStockStatus = Enums['inv_stock_status'];

/* ------------------------------------------------------------------ types */

/**
 * The scan-behaviour flags carried by inv_operation_type.
 *
 * Read, never written. See the header: the database does not enforce any of
 * these — the screen does.
 */
export interface ScanFlags {
  mandatory_scan_product: boolean;
  mandatory_scan_serial: boolean;
  mandatory_scan_dest_location: boolean;
  allow_extra_products: boolean;
}

/** One line of the document: a move, its product, and its progress. */
export interface ScanDocLine {
  move_id: string;
  product_id: string;
  product_name: string;
  product_sku: string | null;
  product_barcode: string | null;
  demand_qty: number;
  /** Units committed against this move so far (inv_move_line count). */
  received_qty: number;
  move_state: string;
}

/** A unit already sitting on the document, so a re-scan can be recognised. */
export interface ScanDocUnit {
  stock_item_id: string;
  move_id: string;
  serial: string;
  status: InvStockStatus;
  /** The unit's CURRENT location. See the header rule. */
  location_id: string;
}

export interface ScanDocument {
  id: string;
  number: string;
  state: ScanDocState;
  kind: ScanDocKind;
  type_name: string;
  flags: ScanFlags;
  /**
   * Present for display and for the `mandatory_scan_dest_location` prompt.
   * NEVER pass this to an adapter as a unit's "from" location.
   */
  source_location_id: string | null;
  source_location_name: string | null;
  dest_location_id: string | null;
  dest_location_name: string | null;
  vendor_name: string | null;
  lines: ScanDocLine[];
  units: ScanDocUnit[];
}

/** A document open enough to scan into, for the picker. */
export interface OpenScanDocument {
  id: string;
  number: string;
  state: ScanDocState;
  type_name: string;
  vendor_name: string | null;
  dest_location_name: string | null;
  demand_qty: number;
  received_qty: number;
  created_at: string;
}

/* -------------------------------------------------------------- resolution */

export interface ResolvedProduct {
  kind: 'product';
  code: string;
  /** Which column matched — shown to the operator so a surprise is legible. */
  matched: 'barcode' | 'alternate barcode' | 'sku';
  product_id: string;
  product_name: string;
  product_sku: string | null;
}

export interface ResolvedUnit {
  kind: 'unit';
  code: string;
  stock_item_id: string;
  serial: string;
  product_id: string;
  status: InvStockStatus;
  /**
   * The unit's CURRENT location, straight off inv_stock_item. This is the
   * value an adapter must use as "from". See the header rule.
   */
  location_id: string;
  /** Which document this unit arrived on — how a foreign serial is spotted. */
  origin_operation_id: string | null;
}

export type ScanResolution =
  | ResolvedProduct
  | ResolvedUnit
  | { kind: 'unknown'; code: string }
  | { kind: 'empty'; code: string };

/**
 * Resolve a scanned string to a product or a unit.
 *
 * EXACT MATCH ONLY, in this order: products.barcode → products.barcodes[] →
 * products.sku → inv_stock_item.serial.
 *
 * NO PREFIX, LIKE, OR FUZZY MATCHING — deliberately, and this is not a
 * performance choice. The seeded serials are `101205-2627-0001`, and `101205`
 * is the product's barcode. Under prefix matching every serial in the system
 * would also resolve as a product scan, and the operator would silently select
 * a line instead of receiving a unit. That prohibition still stands.
 *
 * The barcodes[] step does not weaken it. Array containment (`@>`) tests whole
 * elements, not substrings: `barcodes @> ARRAY['101205']` matches a product
 * whose array holds exactly "101205" and never one holding
 * "101205-2627-0001". It is exact matching applied to each element, which is
 * the same discipline as the columns either side of it.
 *
 * UNIQUENESS IS NOT SYMMETRIC HERE, which is why this step is written
 * differently from its neighbours. `barcode`, `sku` and `inv_stock_item.serial`
 * each have a unique index, so `maybeSingle()` on them is safe. `barcodes[]`
 * has NO uniqueness of any kind — nothing stops two products listing the same
 * alternate — so a match is fetched as a list and an ambiguous result is
 * reported as the data problem it is, rather than letting maybeSingle() throw
 * something the operator cannot act on.
 *
 * `.contains()` rather than a hand-built `.or(...)` filter string: the scanned
 * code is untrusted input, and a code containing a comma, brace or quote would
 * corrupt PostgREST's filter grammar. `.contains()` lets the client library do
 * the escaping. The cost is one extra round trip, and only when the primary
 * barcode misses.
 */
export async function resolveScan(rawCode: string): Promise<ScanResolution> {
  const code = rawCode.trim();
  if (!code) return { kind: 'empty', code };

  const byBarcode = await supabase
    .from('products')
    .select('id, name, sku')
    .eq('barcode', code)
    .maybeSingle();
  if (byBarcode.error) throw byBarcode.error;
  if (byBarcode.data) {
    return {
      kind: 'product',
      code,
      matched: 'barcode',
      product_id: byBarcode.data.id,
      product_name: byBarcode.data.name,
      product_sku: byBarcode.data.sku,
    };
  }

  const byAltBarcode = await supabase
    .from('products')
    .select('id, name, sku')
    .contains('barcodes', [code]);
  if (byAltBarcode.error) throw byAltBarcode.error;
  if ((byAltBarcode.data?.length ?? 0) > 1) {
    // Rule 5: name the conflict. Silently picking the first would send units to
    // whichever product happened to sort first, and nothing downstream would
    // ever reveal it.
    throw new Error(
      `Barcode ${code} is listed as an alternate on more than one product (` +
      `${byAltBarcode.data!.map((p) => p.sku).join(', ')}). ` +
      `Alternate barcodes must identify exactly one product — fix the duplicate before scanning it.`,
    );
  }
  if (byAltBarcode.data?.length === 1) {
    const p = byAltBarcode.data[0];
    return {
      kind: 'product',
      code,
      matched: 'alternate barcode',
      product_id: p.id,
      product_name: p.name,
      product_sku: p.sku,
    };
  }

  const bySku = await supabase
    .from('products')
    .select('id, name, sku')
    .eq('sku', code)
    .maybeSingle();
  if (bySku.error) throw bySku.error;
  if (bySku.data) {
    return {
      kind: 'product',
      code,
      matched: 'sku',
      product_id: bySku.data.id,
      product_name: bySku.data.name,
      product_sku: bySku.data.sku,
    };
  }

  const bySerial = await supabase
    .from('inv_stock_item')
    .select('id, serial, product_id, status, location_id, origin_operation_id')
    .eq('serial', code)
    .maybeSingle();
  if (bySerial.error) throw bySerial.error;
  if (bySerial.data) {
    return {
      kind: 'unit',
      code,
      stock_item_id: bySerial.data.id,
      serial: bySerial.data.serial,
      product_id: bySerial.data.product_id,
      status: bySerial.data.status,
      location_id: bySerial.data.location_id,
      origin_operation_id: bySerial.data.origin_operation_id,
    };
  }

  return { kind: 'unknown', code };
}

/* ---------------------------------------------------------------- adapter */

/**
 * A unit that already exists in stock, described by where it actually is.
 *
 * Built only from a `ResolvedUnit`. There is no constructor path from a
 * document, which is what stops `operation.source_location_id` leaking in.
 */
export interface ScannedUnitRef {
  stockItemId: string;
  /** From inv_stock_item.location_id. Never from the operation. */
  currentLocationId: string;
}

export interface CommitUnitInput {
  moveId: string;
  serial: string;
  cost: number;
  /**
   * The unit when it already exists in stock, else null.
   *
   * Receipts create the unit, so this is null on a receipt scan and the
   * receipt adapter ignores it. A future transfer/delivery adapter MUST pass
   * `currentLocationId` through to inv_transfer_stock_item's
   * `p_expected_from_location_id`. Note what is absent: this input has no
   * field for the document's source location, by design.
   */
  existing: ScannedUnitRef | null;
}

/**
 * The thin kind-specific seam. One verb to commit a unit, one to close the
 * document, one to say why scanning is refused.
 */
export interface ScanAdapter {
  kind: ScanDocKind;
  /** How the document is named in operator-facing sentences: "receipt". */
  documentNoun: string;
  /** Commits ONE unit. Returns the stock item id. */
  commitUnit(input: CommitUnitInput): Promise<string>;
  completeDocument(operationId: string): Promise<unknown>;
  /**
   * Null when the document can be scanned into. Otherwise the sentence to show
   * the operator, in the spirit of Odoo's "This picking is already done".
   */
  refuseScanReason(doc: ScanDocument): string | null;
}

/** Turn a resolved unit into the ref an adapter accepts. */
export function unitRef(u: ResolvedUnit): ScannedUnitRef {
  return { stockItemId: u.stock_item_id, currentLocationId: u.location_id };
}

/* ------------------------------------------------------------------ reads */

async function typeIdsForKind(kind: ScanDocKind): Promise<string[]> {
  const { data, error } = await supabase
    .from('inv_operation_type')
    .select('id')
    .eq('kind', kind);
  if (error) throw error;
  return (data ?? []).map((r) => r.id);
}

/**
 * Documents of `kind` that are open enough to scan into — anything not done
 * and not cancelled, which is exactly what the receive RPC will accept.
 */
export async function listOpenScanDocuments(kind: ScanDocKind): Promise<OpenScanDocument[]> {
  const typeIds = await typeIdsForKind(kind);
  if (typeIds.length === 0) return [];

  const [opsRes, typesRes, locsRes, vendorsRes] = await Promise.all([
    supabase
      .from('inv_operation')
      .select('id, number, state, operation_type_id, dest_location_id, partner_vendor_id, created_at')
      .in('operation_type_id', typeIds)
      .not('state', 'in', '(done,cancelled)')
      .order('created_at', { ascending: false }),
    supabase.from('inv_operation_type').select('id, name'),
    supabase.from('inv_location').select('id, name'),
    supabase.from('vendors').select('id, name'),
  ]);
  if (opsRes.error) throw opsRes.error;
  if (typesRes.error) throw typesRes.error;
  if (locsRes.error) throw locsRes.error;
  if (vendorsRes.error) throw vendorsRes.error;

  const ops = opsRes.data ?? [];
  if (ops.length === 0) return [];

  const typeName = new Map((typesRes.data ?? []).map((t) => [t.id, t.name]));
  const locName = new Map((locsRes.data ?? []).map((l) => [l.id, l.name]));
  const vendName = new Map((vendorsRes.data ?? []).map((v) => [v.id, v.name]));

  const { data: moves, error: mErr } = await supabase
    .from('inv_move')
    .select('id, operation_id, demand_qty')
    .in('operation_id', ops.map((o) => o.id));
  if (mErr) throw mErr;

  const moveToOp = new Map((moves ?? []).map((m) => [m.id, m.operation_id]));
  const demandByOp = new Map<string, number>();
  for (const m of moves ?? []) {
    demandByOp.set(m.operation_id, (demandByOp.get(m.operation_id) ?? 0) + Number(m.demand_qty ?? 0));
  }

  const receivedByOp = new Map<string, number>();
  if ((moves ?? []).length > 0) {
    const { data: mls, error: mlErr } = await supabase
      .from('inv_move_line')
      .select('move_id')
      .in('move_id', (moves ?? []).map((m) => m.id));
    if (mlErr) throw mlErr;
    for (const ml of mls ?? []) {
      const opId = moveToOp.get(ml.move_id);
      if (opId) receivedByOp.set(opId, (receivedByOp.get(opId) ?? 0) + 1);
    }
  }

  return ops.map((o) => ({
    id: o.id,
    number: o.number,
    state: o.state,
    type_name: typeName.get(o.operation_type_id) ?? '—',
    vendor_name: o.partner_vendor_id ? vendName.get(o.partner_vendor_id) ?? null : null,
    dest_location_name: o.dest_location_id ? locName.get(o.dest_location_id) ?? null : null,
    demand_qty: demandByOp.get(o.id) ?? 0,
    received_qty: receivedByOp.get(o.id) ?? 0,
    created_at: o.created_at,
  }));
}

/** The full working set for one document. */
export async function getScanDocument(operationId: string): Promise<ScanDocument | null> {
  const { data: op, error: opErr } = await supabase
    .from('inv_operation')
    .select('id, number, state, operation_type_id, source_location_id, dest_location_id, partner_vendor_id')
    .eq('id', operationId)
    .maybeSingle();
  if (opErr) throw opErr;
  if (!op) return null;

  const [typeRes, locsRes, vendorRes, movesRes] = await Promise.all([
    supabase
      .from('inv_operation_type')
      .select('id, name, kind, mandatory_scan_product, mandatory_scan_serial, mandatory_scan_dest_location, allow_extra_products')
      .eq('id', op.operation_type_id)
      .maybeSingle(),
    supabase.from('inv_location').select('id, name'),
    op.partner_vendor_id
      ? supabase.from('vendors').select('id, name').eq('id', op.partner_vendor_id).maybeSingle()
      : null,
    supabase.from('inv_move').select('id, product_id, demand_qty, state').eq('operation_id', operationId),
  ]);
  if (typeRes.error) throw typeRes.error;
  if (locsRes.error) throw locsRes.error;
  if (vendorRes?.error) throw vendorRes.error;
  if (movesRes.error) throw movesRes.error;

  const type = typeRes.data;
  if (!type) throw new Error(`Operation type ${op.operation_type_id} not found.`);

  const locName = new Map((locsRes.data ?? []).map((l) => [l.id, l.name]));
  const moves = movesRes.data ?? [];
  const moveIds = moves.map((m) => m.id);
  const productIds = [...new Set(moves.map((m) => m.product_id))];

  const [prodRes, mlRes] = await Promise.all([
    productIds.length
      ? supabase.from('products').select('id, name, sku, barcode').in('id', productIds)
      : null,
    moveIds.length
      ? supabase.from('inv_move_line').select('id, move_id, stock_item_id').in('move_id', moveIds)
      : null,
  ]);
  if (prodRes?.error) throw prodRes.error;
  if (mlRes?.error) throw mlRes.error;

  const products = new Map((prodRes?.data ?? []).map((p) => [p.id, p]));
  const moveLines = mlRes?.data ?? [];
  const stockItemIds = [...new Set(moveLines.map((l) => l.stock_item_id))];

  const itemsRes = stockItemIds.length
    ? await supabase
        .from('inv_stock_item')
        .select('id, serial, status, location_id')
        .in('id', stockItemIds)
    : null;
  if (itemsRes?.error) throw itemsRes.error;
  const itemById = new Map((itemsRes?.data ?? []).map((i) => [i.id, i]));

  const receivedByMove = new Map<string, number>();
  for (const l of moveLines) {
    receivedByMove.set(l.move_id, (receivedByMove.get(l.move_id) ?? 0) + 1);
  }

  const lines: ScanDocLine[] = moves
    .map((m) => {
      const p = products.get(m.product_id);
      return {
        move_id: m.id,
        product_id: m.product_id,
        product_name: p?.name ?? '—',
        product_sku: p?.sku ?? null,
        product_barcode: p?.barcode ?? null,
        demand_qty: Number(m.demand_qty ?? 0),
        received_qty: receivedByMove.get(m.id) ?? 0,
        move_state: m.state,
      };
    })
    .sort((a, b) => a.product_name.localeCompare(b.product_name));

  const units: ScanDocUnit[] = moveLines
    .map((l) => {
      const it = itemById.get(l.stock_item_id);
      return {
        stock_item_id: l.stock_item_id,
        move_id: l.move_id,
        serial: it?.serial ?? '—',
        status: (it?.status ?? 'quarantined') as InvStockStatus,
        location_id: it?.location_id ?? '',
      };
    })
    .sort((a, b) => a.serial.localeCompare(b.serial));

  return {
    id: op.id,
    number: op.number,
    state: op.state,
    kind: type.kind,
    type_name: type.name,
    flags: {
      mandatory_scan_product: type.mandatory_scan_product,
      mandatory_scan_serial: type.mandatory_scan_serial,
      mandatory_scan_dest_location: type.mandatory_scan_dest_location,
      allow_extra_products: type.allow_extra_products,
    },
    source_location_id: op.source_location_id,
    source_location_name: op.source_location_id ? locName.get(op.source_location_id) ?? null : null,
    dest_location_id: op.dest_location_id,
    dest_location_name: op.dest_location_id ? locName.get(op.dest_location_id) ?? null : null,
    vendor_name: vendorRes?.data?.name ?? null,
    lines,
    units,
  };
}
