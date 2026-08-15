/**
 * Inventory 2 — internal transfer read layer. Sibling to `receipts.ts`.
 *
 * READ-ONLY. Every write goes through `transferWrites.ts`, which calls only
 * sanctioned RPCs. inv_stock_item, inv_move_line and inv_stock_tracking are
 * never written from anywhere in this module.
 *
 * ── WHAT A TRANSFER IS ────────────────────────────────────────────────────
 * A location-to-location move of units — showroom → packing, godown →
 * showroom. The OPERATION TYPE carries the route: "Godown → Showroom" is a
 * type, not a parameter of one. That is why both ends are read and rendered
 * here, and why `locks_source` matters on this document in a way it never did
 * on a receipt.
 *
 * ── WHY THIS IS NOT `receipts.ts` WITH A DIFFERENT FILTER ─────────────────
 * Four things a receipt read carries are absent, and their absence is the
 * point rather than an omission:
 *
 *   no QC          inv_test_result has no operation_id, so an inspection is
 *                  unit-scoped. Reading it onto a transfer page would render
 *                  the RECEIPT's verdict under a transfer's heading with
 *                  nothing on screen saying so. requires_qc stays false for
 *                  internal and the Quality segment is not adopted. CLAUDE.md.
 *   no vendor       a transfer has no partner. Both ends are locations.
 *   no purchase order  inv_create_operation refuses one on a non-receipt kind.
 *   no cost         inv_transfer_stock_item has no cost parameter; the unit
 *                  was costed when it was received.
 *
 * ── THE ONE FIGURE THAT IS EASY TO GET WRONG ──────────────────────────────
 * A unit's location on this page is `inv_stock_item.location_id` — where it
 * IS NOW, which after a completed transfer is the destination. The per-unit
 * "from" is read from `inv_move_line.from_location_id`, the ledger's record of
 * where that unit actually started, NOT from the operation's source. On a
 * mis-configured document those differ, and showing the document's source
 * would quietly claim a movement that did not happen.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Tables = Database['public']['Tables'];
type MoveRow = Tables['inv_move']['Row'];
type MoveLineRow = Tables['inv_move_line']['Row'];
type StockItemRow = Tables['inv_stock_item']['Row'];
type TrackingRow = Tables['inv_stock_tracking']['Row'];
type ProductRef = { id: string; name: string; sku: string | null };

export type InvOperationState = Database['public']['Enums']['inv_operation_state'];
export type InvStockStatus = Database['public']['Enums']['inv_stock_status'];

/* ------------------------------------------------------------------ types */

export interface TransferRow {
  id: string;
  number: string;
  state: InvOperationState;
  operation_type_name: string | null;
  source_location_name: string | null;
  dest_location_name: string | null;
  scheduled_at: string | null;
  done_at: string | null;
  created_at: string;
  source_document: string | null;
  /** Units actually moved on this document. */
  unit_count: number;
  /** Units this document asked for, summed across its lines. */
  demand_qty: number;
}

export interface TransferLine {
  move_id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  demand_qty: number;
  move_state: string;
  /** Units moved onto this line. */
  moved_qty: number;
}

export interface TransferUnit {
  stock_item_id: string;
  move_id: string;
  product_id: string | null;
  serial: string;
  status: InvStockStatus;
  /** Where the unit is NOW — after a completed transfer, the destination. */
  location_name: string | null;
  /** Where this unit actually started, from inv_move_line, not the document. */
  from_location_name: string | null;
  to_location_name: string | null;
  done_at: string | null;
}

export interface TransferLedgerRow {
  id: string;
  stock_item_id: string;
  serial: string;
  product_name: string | null;
  entry_type: string;
  from_location_name: string | null;
  to_location_name: string | null;
  created_at: string;
}

/** Units on THIS document grouped by where they are now and their condition. */
export interface TransferUnitBucket {
  location_name: string;
  status: InvStockStatus;
  qty: number;
}

export interface TransferDetail {
  transfer: {
    id: string;
    number: string;
    state: InvOperationState;
    operation_type_id: string;
    operation_type_name: string | null;
    /**
     * Transfers are the FIRST real consumer of locks_source. It has sat on
     * inv_operation_type since Step 2 read by nothing; the page renders the
     * source read-only with a lock when it is true, exactly as the receipt page
     * already does for locks_destination.
     */
    operation_type_locks_source: boolean;
    operation_type_locks_destination: boolean;
    source_location_name: string | null;
    dest_location_name: string | null;
    source_document: string | null;
    scheduled_at: string | null;
    done_at: string | null;
    created_at: string;
    created_by: string | null;
    notes: string | null;
  };
  lines: TransferLine[];
  units: TransferUnit[];
  ledger: TransferLedgerRow[];
  unitBuckets: TransferUnitBucket[];
}

/* --------------------------------------------------------------- helpers */

/** Ids of every operation type whose kind is `internal`. */
async function internalTypeIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('inv_operation_type')
    .select('id')
    .eq('kind', 'internal');
  if (error) throw error;
  return (data ?? []).map((r) => r.id);
}

async function locationIndex(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('inv_location').select('id, name');
  if (error) throw error;
  return new Map((data ?? []).map((l) => [l.id, l.name]));
}

/* ----------------------------------------------------------------- list */

export async function listTransfers(): Promise<TransferRow[]> {
  const typeIds = await internalTypeIds();
  if (typeIds.length === 0) return [];

  const [opsRes, typesRes, locsRes] = await Promise.all([
    supabase.from('inv_operation')
      .select('id, number, state, operation_type_id, source_location_id, dest_location_id, scheduled_at, done_at, created_at, source_document')
      .in('operation_type_id', typeIds)
      .order('created_at', { ascending: false }),
    supabase.from('inv_operation_type').select('id, name'),
    supabase.from('inv_location').select('id, name'),
  ]);
  if (opsRes.error) throw opsRes.error;
  if (typesRes.error) throw typesRes.error;
  if (locsRes.error) throw locsRes.error;

  const ops = opsRes.data ?? [];
  if (ops.length === 0) return [];

  const typeName = new Map((typesRes.data ?? []).map((t) => [t.id, t.name]));
  const locName = new Map((locsRes.data ?? []).map((l) => [l.id, l.name]));

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

  const countByOp = new Map<string, number>();
  if ((moves ?? []).length > 0) {
    const { data: mls, error: mlErr } = await supabase
      .from('inv_move_line').select('move_id')
      .in('move_id', (moves ?? []).map((m) => m.id));
    if (mlErr) throw mlErr;
    for (const ml of mls ?? []) {
      const opId = moveToOp.get(ml.move_id);
      if (opId) countByOp.set(opId, (countByOp.get(opId) ?? 0) + 1);
    }
  }

  return ops.map((o) => ({
    id: o.id,
    number: o.number,
    state: o.state,
    operation_type_name: typeName.get(o.operation_type_id) ?? null,
    source_location_name: o.source_location_id ? locName.get(o.source_location_id) ?? null : null,
    dest_location_name: o.dest_location_id ? locName.get(o.dest_location_id) ?? null : null,
    scheduled_at: o.scheduled_at,
    done_at: o.done_at,
    created_at: o.created_at,
    source_document: o.source_document,
    unit_count: countByOp.get(o.id) ?? 0,
    demand_qty: demandByOp.get(o.id) ?? 0,
  }));
}

/* --------------------------------------------------------------- detail */

export async function getTransferDetail(id: string): Promise<TransferDetail | null> {
  const { data: op, error: opErr } = await supabase
    .from('inv_operation').select('*').eq('id', id).maybeSingle();
  if (opErr) throw opErr;
  if (!op) return null;

  const [typeRes, locIdx, movesRes] = await Promise.all([
    supabase.from('inv_operation_type').select('*').eq('id', op.operation_type_id).maybeSingle(),
    locationIndex(),
    supabase.from('inv_move').select('*').eq('operation_id', id),
  ]);
  if (typeRes.error) throw typeRes.error;
  if (movesRes.error) throw movesRes.error;

  const type = typeRes.data;
  const moves: MoveRow[] = movesRes.data ?? [];
  const moveIds = moves.map((m) => m.id);
  const productIds = [...new Set(moves.map((m) => m.product_id))];

  const [mlRes, prodRes] = await Promise.all([
    moveIds.length ? supabase.from('inv_move_line').select('*').in('move_id', moveIds) : null,
    productIds.length
      ? supabase.from('products').select('id, name, sku').in('id', productIds)
      : null,
  ]);
  if (mlRes?.error) throw mlRes.error;
  if (prodRes?.error) throw prodRes.error;

  const moveLines: MoveLineRow[] = mlRes?.data ?? [];
  const stockItemIds = [...new Set(moveLines.map((l) => l.stock_item_id))];

  const [itemRes, trackRes] = await Promise.all([
    stockItemIds.length
      ? supabase.from('inv_stock_item').select('*').in('id', stockItemIds)
      : null,
    // Scoped to THIS document. A unit's full history spans every document it
    // ever touched; showing all of it under one transfer's Moves tab would
    // credit this document with movements it did not perform.
    supabase.from('inv_stock_tracking').select('*')
      .eq('document_type', 'inv_operation')
      .eq('document_id', id)
      .order('created_at'),
  ]);
  if (itemRes?.error) throw itemRes.error;
  if (trackRes.error) throw trackRes.error;

  const trackingRows: TrackingRow[] = trackRes.data ?? [];
  const prodName = new Map<string, ProductRef>((prodRes?.data ?? []).map((p) => [p.id, p]));
  const itemById = new Map<string, StockItemRow>((itemRes?.data ?? []).map((s) => [s.id, s]));

  const movedByMove = new Map<string, number>();
  for (const l of moveLines) {
    movedByMove.set(l.move_id, (movedByMove.get(l.move_id) ?? 0) + 1);
  }

  const lines: TransferLine[] = moves.map((m) => ({
    move_id: m.id,
    product_id: m.product_id,
    product_name: prodName.get(m.product_id)?.name ?? null,
    product_sku: prodName.get(m.product_id)?.sku ?? null,
    demand_qty: Number(m.demand_qty ?? 0),
    move_state: m.state,
    moved_qty: movedByMove.get(m.id) ?? 0,
  })).sort((a, b) => (a.product_name ?? '').localeCompare(b.product_name ?? ''));

  const units: TransferUnit[] = moveLines.map((l) => {
    const it = itemById.get(l.stock_item_id);
    return {
      stock_item_id: l.stock_item_id,
      move_id: l.move_id,
      product_id: it?.product_id ?? null,
      serial: it?.serial ?? '—',
      status: it?.status ?? 'quarantined',
      location_name: it?.location_id ? locIdx.get(it.location_id) ?? null : null,
      // From the move LINE, which recorded where this unit actually was.
      from_location_name: l.from_location_id ? locIdx.get(l.from_location_id) ?? null : null,
      to_location_name: l.to_location_id ? locIdx.get(l.to_location_id) ?? null : null,
      done_at: l.done_at,
    };
  }).sort((a, b) => a.serial.localeCompare(b.serial));

  const ledger: TransferLedgerRow[] = trackingRows.map((t) => {
    const it = itemById.get(t.stock_item_id);
    return {
      id: t.id,
      stock_item_id: t.stock_item_id,
      serial: it?.serial ?? '—',
      product_name: it ? prodName.get(it.product_id)?.name ?? null : null,
      entry_type: t.entry_type,
      from_location_name: t.from_location_id ? locIdx.get(t.from_location_id) ?? null : null,
      to_location_name: t.to_location_id ? locIdx.get(t.to_location_id) ?? null : null,
      created_at: t.created_at,
    };
  });

  const buckets = new Map<string, TransferUnitBucket>();
  for (const u of units) {
    const location = u.location_name ?? '—';
    const key = `${location} ${u.status}`;
    const existing = buckets.get(key);
    if (existing) existing.qty += 1;
    else buckets.set(key, { location_name: location, status: u.status, qty: 1 });
  }

  return {
    transfer: {
      id: op.id,
      number: op.number,
      state: op.state,
      operation_type_id: op.operation_type_id,
      operation_type_name: type?.name ?? null,
      operation_type_locks_source: !!type?.locks_source,
      operation_type_locks_destination: !!type?.locks_destination,
      source_location_name: op.source_location_id ? locIdx.get(op.source_location_id) ?? null : null,
      dest_location_name: op.dest_location_id ? locIdx.get(op.dest_location_id) ?? null : null,
      source_document: op.source_document,
      scheduled_at: op.scheduled_at,
      done_at: op.done_at,
      created_at: op.created_at,
      created_by: op.created_by,
      notes: op.notes,
    },
    lines,
    units,
    ledger,
    unitBuckets: [...buckets.values()].sort((a, b) =>
      a.location_name.localeCompare(b.location_name) || a.status.localeCompare(b.status)),
  };
}
