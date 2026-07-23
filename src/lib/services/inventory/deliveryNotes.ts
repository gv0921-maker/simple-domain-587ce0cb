import { supabase } from '@/integrations/supabase/client';
import { generateDocumentNumber } from '@/lib/services/numbering/api';

export type DeliveryNoteStatus = 'draft' | 'confirmed' | 'delivered';

export interface DeliveryNoteProduct {
  product_id: string;
  product_name: string;
  quantity: number;
  unit: string;
  serial_numbers: string[];
  warehouse_location: string;
}

export interface DeliveryNote {
  id: string;
  reference: string;
  salesOrderId: string | null;
  invoiceId: string | null;
  warehouseId: string | null;
  customerId: string | null;
  deliveryDate: string | null;
  status: DeliveryNoteStatus;
  createdBy: string | null;
  qcBy: string | null;
  productsJson: DeliveryNoteProduct[];
  customerDeliveryName: string | null;
  customerDeliveryAddress: string | null;
  customerDeliveryPhone: string | null;
  signatureCollected: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

const sb = supabase as any;

function mapRow(r: any): DeliveryNote {
  return {
    id: r.id,
    reference: r.reference,
    salesOrderId: r.sales_order_id,
    invoiceId: r.invoice_id,
    warehouseId: r.warehouse_id,
    customerId: r.customer_id,
    deliveryDate: r.delivery_date,
    status: r.status,
    createdBy: r.created_by,
    qcBy: r.qc_by,
    productsJson: (r.products_json ?? []) as DeliveryNoteProduct[],
    customerDeliveryName: r.customer_delivery_name,
    customerDeliveryAddress: r.customer_delivery_address,
    customerDeliveryPhone: r.customer_delivery_phone,
    signatureCollected: !!r.signature_collected,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listDeliveryNotesAsync(): Promise<DeliveryNote[]> {
  const { data, error } = await sb
    .from('delivery_notes').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function getDeliveryNoteAsync(id: string): Promise<DeliveryNote | null> {
  const { data, error } = await sb
    .from('delivery_notes').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

export async function generateDeliveryNoteFromInvoiceAsync(invoiceId: string): Promise<DeliveryNote> {
  // 1. Load invoice
  const { data: invoice, error: invErr } = await sb
    .from('invoices').select('*').eq('id', invoiceId).single();
  if (invErr) throw invErr;
  if (!invoice.sales_order_id) {
    throw new Error('Invoice is not linked to a sales order');
  }

  // 2. Load sales order (for address + customer)
  const { data: order, error: ordErr } = await sb
    .from('sales_orders').select('*').eq('id', invoice.sales_order_id).single();
  if (ordErr) throw ordErr;

  // 3. Reservations for this order
  const { data: reservations, error: resErr } = await sb
    .from('stock_reservations').select('*')
    .eq('sales_order_id', invoice.sales_order_id);
  if (resErr) throw resErr;

  // 4. Order lines for product names/units
  const { data: orderLines, error: olErr } = await sb
    .from('order_lines').select('id,product_id,product_name,units,quantity')
    .eq('order_id', invoice.sales_order_id);
  if (olErr) throw olErr;

  // 5. Resolve serial numbers (id → name)
  const serialIds = (reservations ?? []).map((r: any) => r.serial_number_id).filter(Boolean);
  let serialMap = new Map<string, { name: string; locationId: string | null }>();
  if (serialIds.length) {
    const { data: serials } = await sb
      .from('serial_numbers').select('id,name,location_id').in('id', serialIds);
    (serials ?? []).forEach((s: any) =>
      serialMap.set(s.id, { name: s.name, locationId: s.location_id }),
    );
  }

  // 6. Warehouse derivation — first location → warehouse
  let warehouseId: string | null = null;
  let locationNameById = new Map<string, string>();
  const locIds = Array.from(new Set(
    Array.from(serialMap.values()).map((v) => v.locationId).filter(Boolean) as string[],
  ));
  if (locIds.length) {
    const { data: locs } = await sb
      .from('warehouse_locations').select('id,name,warehouse_id').in('id', locIds);
    (locs ?? []).forEach((l: any) => {
      locationNameById.set(l.id, l.name);
      if (!warehouseId) warehouseId = l.warehouse_id;
    });
  }
  if (!warehouseId) {
    const { data: w } = await sb.from('warehouses').select('id').limit(1).maybeSingle();
    warehouseId = w?.id ?? null;
  }

  // 7. Get product fallback names + units
  const productIds = Array.from(new Set(
    (reservations ?? []).map((r: any) => r.product_id),
  ));
  let productMap = new Map<string, { name: string; unit: string }>();
  if (productIds.length) {
    const { data: prods } = await sb
      .from('products').select('id,name,unit_of_measure').in('id', productIds);
    (prods ?? []).forEach((p: any) =>
      productMap.set(p.id, { name: p.name, unit: p.unit_of_measure ?? 'Unit' }),
    );
  }

  const olByProduct = new Map<string, any>();
  (orderLines ?? []).forEach((l: any) => {
    if (l.product_id) olByProduct.set(l.product_id, l);
  });

  // 8. Group reservations by product
  const byProduct = new Map<string, DeliveryNoteProduct>();
  (reservations ?? []).forEach((r: any) => {
    const pid = r.product_id;
    const ol = olByProduct.get(pid);
    const prod = productMap.get(pid);
    const serialInfo = r.serial_number_id ? serialMap.get(r.serial_number_id) : null;
    const locName = serialInfo?.locationId
      ? locationNameById.get(serialInfo.locationId) ?? ''
      : '';
    const existing = byProduct.get(pid) ?? {
      product_id: pid,
      product_name: ol?.product_name ?? prod?.name ?? 'Product',
      quantity: 0,
      unit: ol?.units ?? prod?.unit ?? 'Unit',
      serial_numbers: [],
      warehouse_location: locName,
    };
    existing.quantity += Number(r.quantity ?? 1);
    if (serialInfo?.name) existing.serial_numbers.push(serialInfo.name);
    if (!existing.warehouse_location && locName) existing.warehouse_location = locName;
    byProduct.set(pid, existing);
  });

  // 9. QC info
  const { data: qcRow } = await sb
    .from('delivery_qc').select('*')
    .eq('sales_order_id', invoice.sales_order_id)
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle();

  // 10. Delivery address (prefer delivery_*, fallback billing_*)
  const addrParts = [
    order.delivery_address_line_1 || order.billing_address_line_1,
    order.delivery_address_line_2 || order.billing_address_line_2,
    order.delivery_city || order.billing_city,
    order.delivery_state || order.billing_state,
    order.delivery_zip || order.billing_zip,
  ].filter(Boolean);
  const customerDeliveryAddress = addrParts.join(', ');
  const customerDeliveryName = order.delivery_name || order.billing_name || order.customer_name || '';
  const customerDeliveryPhone = order.delivery_phone_1 || order.billing_phone_1 || '';

  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id ?? null;

  const reference = await generateDocumentNumber('delivery_note');

  const insertRow = {
    reference,
    sales_order_id: invoice.sales_order_id,
    invoice_id: invoiceId,
    warehouse_id: warehouseId,
    customer_id: invoice.customer_id ?? order.customer_id ?? null,
    delivery_date: null,
    status: 'draft' as const,
    created_by: userId,
    qc_by: qcRow?.verified_by ?? null,
    products_json: Array.from(byProduct.values()),
    customer_delivery_name: customerDeliveryName,
    customer_delivery_address: customerDeliveryAddress,
    customer_delivery_phone: customerDeliveryPhone,
  };

  const { data, error } = await sb.from('delivery_notes').insert(insertRow).select().single();
  if (error) throw error;
  return mapRow(data);
}

export async function markDeliveryNoteAsDeliveredAsync(id: string): Promise<DeliveryNote> {
  // Delegate to the atomic `complete_delivery_with_qc` RPC. That function
  // locks serials, writes stock_moves + stock_move_lines (source → CUSTOMERS),
  // marks serials as sold, clears reservations, updates the delivery note,
  // and closes the sales order when all sibling DNs are delivered — all in
  // a single transaction. On failure the whole transaction rolls back.
  const { error: rpcErr } = await sb.rpc('complete_delivery_with_qc', {
    _dn_id: id,
    _signature_received: true,
  });
  if (rpcErr) throw new Error(rpcErr.message);

  // Best-effort: sync invoice status (not part of the delivery ledger)
  const { data: dn } = await sb.from('delivery_notes').select('*').eq('id', id).single();
  if (dn?.invoice_id) {
    await sb.from('invoices').update({ status: 'delivered' }).eq('id', dn.invoice_id);
  }
  return mapRow(dn);
}

export async function getUserNamesAsync(userIds: string[]): Promise<Record<string, string>> {
  // We don't have a profiles table here; just return empty so UI falls back to id/email.
  const out: Record<string, string> = {};
  void userIds;
  return out;
}