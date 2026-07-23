// Stock Reservations service — Supabase-backed API for linking sales orders
// to specific inventory units (serial numbers / lots / quantity).
import { supabase } from '@/integrations/supabase/client';

export type StockReservationStatus = 'reserved' | 'released' | 'delivered';

export interface StockReservation {
  id: string;
  salesOrderId: string;
  orderLineId?: string | null;
  productId: string;
  serialNumberId?: string | null;
  lotId?: string | null;
  quantity: number;
  status: StockReservationStatus;
  reservedBy?: string | null;
  reservedAt: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapRow(r: any): StockReservation {
  return {
    id: r.id,
    salesOrderId: r.sales_order_id,
    orderLineId: r.order_line_id,
    productId: r.product_id,
    serialNumberId: r.serial_number_id,
    lotId: r.lot_id,
    quantity: Number(r.quantity ?? 0),
    status: r.status,
    reservedBy: r.reserved_by,
    reservedAt: r.reserved_at,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listReservationsAsync(): Promise<StockReservation[]> {
  const { data, error } = await (supabase as any)
    .from('stock_reservations').select('*').order('reserved_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function listReservationsBySalesOrderAsync(
  salesOrderId: string,
): Promise<StockReservation[]> {
  const { data, error } = await (supabase as any)
    .from('stock_reservations').select('*')
    .eq('sales_order_id', salesOrderId)
    .order('reserved_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function listReservationsByProductAsync(
  productId: string,
): Promise<StockReservation[]> {
  const { data, error } = await (supabase as any)
    .from('stock_reservations').select('*')
    .eq('product_id', productId)
    .eq('status', 'reserved')
    .order('reserved_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export interface CreateReservationInput {
  salesOrderId: string;
  orderLineId?: string | null;
  productId: string;
  serialNumberId?: string | null;
  lotId?: string | null;
  quantity: number;
  notes?: string;
}

export async function createReservationsAsync(
  inputs: CreateReservationInput[],
): Promise<StockReservation[]> {
  if (inputs.length === 0) return [];

  // Group serial-based inputs by (SO, orderLine, product) and route through
  // reserve_serials RPC; route bulk-qty inputs through reserve_quantity.
  // Each RPC runs in a single Postgres transaction with row locks.
  const serialInputs = inputs.filter((i) => !!i.serialNumberId);
  const qtyInputs = inputs.filter((i) => !i.serialNumberId);
  const createdIds: string[] = [];

  if (serialInputs.length > 0) {
    const groups = new Map<string, { soId: string; olId: string | null; pid: string; notes?: string; serials: string[] }>();
    for (const i of serialInputs) {
      const key = `${i.salesOrderId}::${i.orderLineId ?? ''}::${i.productId}`;
      const g = groups.get(key) ?? {
        soId: i.salesOrderId, olId: i.orderLineId ?? null, pid: i.productId,
        notes: i.notes, serials: [],
      };
      g.serials.push(i.serialNumberId as string);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const { data, error } = await (supabase as any).rpc('reserve_serials', {
        _so_id: g.soId,
        _order_line_id: g.olId,
        _product_id: g.pid,
        _serial_ids: g.serials,
        _notes: g.notes ?? null,
      });
      if (error) throw new Error(error.message);
      const ids = ((data ?? {}).reservation_ids ?? []) as string[];
      ids.forEach((x) => createdIds.push(x));
    }
  }

  for (const i of qtyInputs) {
    const { data, error } = await (supabase as any).rpc('reserve_quantity', {
      _so_id: i.salesOrderId,
      _order_line_id: i.orderLineId ?? null,
      _product_id: i.productId,
      _quantity: i.quantity,
      _notes: i.notes ?? null,
    });
    if (error) throw new Error(error.message);
    if (data) createdIds.push(data as string);
  }

  if (createdIds.length === 0) return [];
  const { data: rows, error: fetchErr } = await (supabase as any)
    .from('stock_reservations').select('*').in('id', createdIds);
  if (fetchErr) throw fetchErr;
  return (rows ?? []).map(mapRow);
}

export async function releaseReservationAsync(id: string): Promise<void> {
  const { error } = await (supabase as any).rpc('release_reservations', {
    _document_type: 'reservation',
    _document_id: id,
  });
  if (error) throw new Error(error.message);
}

export async function deleteReservationAsync(id: string): Promise<void> {
  // Delegates to the same atomic RPC — one transaction handles both the
  // reservation row deletion and the serial flip back to 'available'.
  await releaseReservationAsync(id);
}

export async function releaseReservationsForSalesOrderAsync(salesOrderId: string): Promise<number> {
  const { data, error } = await (supabase as any).rpc('release_reservations', {
    _document_type: 'sales_order',
    _document_id: salesOrderId,
  });
  if (error) throw new Error(error.message);
  return Number((data ?? {}).released ?? 0);
}