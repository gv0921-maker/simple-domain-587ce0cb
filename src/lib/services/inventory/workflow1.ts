import { supabase } from '@/integrations/supabase/client';
import { getQCInspections, type QCExpectedLine } from '@/lib/services/inventory/qcEngine';

const sb = supabase as any;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

async function authUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function usersWithRoles(roles: string[]): Promise<string[]> {
  if (roles.length === 0) return [];
  const { data, error } = await sb
    .from('user_roles')
    .select('user_id')
    .in('role', roles);
  if (error) return [];
  return Array.from(new Set(((data ?? []) as Array<{ user_id: string }>).map(r => r.user_id)));
}

async function notifyUsers(
  userIds: string[],
  payload: {
    title: string;
    body: string;
    category: string;
    priority?: 'low' | 'normal' | 'high';
    relatedEntityType: string;
    relatedEntityId: string;
    linkUrl?: string;
  },
): Promise<void> {
  const clean = Array.from(new Set(userIds.filter(Boolean)));
  if (clean.length === 0) return;
  const rows = clean.map(uid => ({
    recipient_user_id: uid,
    notification_type: 'system',
    category: payload.category,
    priority: payload.priority ?? 'normal',
    title: payload.title,
    body: payload.body,
    link_url: payload.linkUrl ?? null,
    related_entity_type: payload.relatedEntityType,
    related_entity_id: payload.relatedEntityId,
  }));
  await sb.from('notifications').insert(rows).then(() => undefined, () => undefined);
}

/** Load serials reserved for a Sales Order (the pool an ITO draws from). */
export async function getReservedSerialsForSO(
  salesOrderId: string,
): Promise<Array<{
  id: string;
  serial_number: string;
  product_id: string;
  current_warehouse_id: string | null;
  goods_receipt_id: string;
  stock_status: string;
}>> {
  const { data, error } = await sb
    .from('goods_receipt_serials')
    .select('id, serial_number, product_id, current_warehouse_id, goods_receipt_id, stock_status')
    .eq('reserved_for_so_id', salesOrderId);
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function getTransitLocationForWarehouse(
  warehouseId: string,
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await sb
    .from('warehouse_locations')
    .select('id, name')
    .eq('warehouse_id', warehouseId)
    .eq('type', 'transit')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data ? { id: data.id, name: data.name } : null;
}

/** Build expected lines for the ITO Scan QC Panel from ITO lines + reserved serials. */
export async function buildItoExpectedLines(
  itoLines: Array<{ id: string; product_id: string; quantity_expected: number }>,
  salesOrderId: string,
): Promise<QCExpectedLine[]> {
  const reserved = await getReservedSerialsForSO(salesOrderId);
  const byProduct = new Map<string, string[]>();
  reserved.forEach(r => {
    const arr = byProduct.get(r.product_id) ?? [];
    arr.push(r.serial_number);
    byProduct.set(r.product_id, arr);
  });
  const { data: products } = await sb
    .from('products')
    .select('id, name')
    .in('id', Array.from(new Set(itoLines.map(l => l.product_id))));
  const productName = new Map<string, string>(
    ((products ?? []) as Array<{ id: string; name: string }>).map(p => [p.id, p.name]),
  );
  return itoLines.map(l => ({
    lineId: l.id,
    productId: l.product_id,
    productName: productName.get(l.product_id) ?? 'Product',
    expectedQty: l.quantity_expected,
    serials: byProduct.get(l.product_id) ?? [],
  }));
}

// ------------------------------------------------------------------
// ITO completion → move stock to transit
// ------------------------------------------------------------------

export interface CompleteItoResult {
  moved: number;
  failed: number;
  correctionOrderId: string | null;
  transitLocationId: string;
}

export async function completeItoWithQc(itoId: string): Promise<CompleteItoResult> {
  // Delegate the entire operation to the atomic `complete_ito_with_qc`
  // Postgres function. That RPC locks the affected serials, applies stock
  // moves + serial updates + ITO status change in a single transaction, and
  // on QC failures atomically creates a Correction Order + moves failed
  // serials to the CORRECTION virtual location before returning a
  // 'blocked_by_failures' payload. If the transaction fails, everything
  // rolls back and the error is surfaced to the caller.
  const { data, error } = await sb.rpc('complete_ito_with_qc', { _ito_id: itoId });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as {
    status?: 'completed' | 'blocked_by_failures';
    moved?: number;
    transit_location_id?: string;
    transit_location_name?: string;
    failed?: number;
    failed_serials?: string[];
    correction_order_id?: string | null;
    ito_number?: string;
  };

  if (result.status === 'blocked_by_failures') {
    const failedCount = result.failed ?? (result.failed_serials?.length ?? 0);
    const serials = (result.failed_serials ?? []).join(', ');
    throw new Error(
      `ITO cannot complete: ${failedCount} unit${failedCount === 1 ? '' : 's'} failed QC (${serials}). ` +
      `Correction Order created. Resolve or replace failed units before completing.`,
    );
  }

  // Success — fire off notifications (non-transactional side effect).
  const { data: ito } = await sb
    .from('internal_transfer_orders')
    .select('sales_order_id, ito_number')
    .eq('id', itoId)
    .maybeSingle();
  const salesOrderId: string | null = ito?.sales_order_id ?? null;
  const itoNumber: string = ito?.ito_number ?? result.ito_number ?? '';
  if (salesOrderId) {
    const [{ data: so }, mgrIds] = await Promise.all([
      sb.from('sales_orders').select('created_by, reference').eq('id', salesOrderId).maybeSingle(),
      usersWithRoles(['sales_manager', 'super_admin']),
    ]);
    const recipients = new Set<string>(mgrIds);
    if (so?.created_by) recipients.add(so.created_by);
    await notifyUsers(Array.from(recipients), {
      title: `ITO ${itoNumber} completed — stock in transit`,
      body: `${result.moved ?? 0} units moved to ${result.transit_location_name ?? 'transit'}. Ready for packing.`,
      category: 'fulfillment',
      priority: 'normal',
      relatedEntityType: 'internal_transfer_order',
      relatedEntityId: itoId,
      linkUrl: `/inventory/ito/${itoId}`,
    });
  }

  return {
    moved: result.moved ?? 0,
    failed: 0,
    correctionOrderId: result.correction_order_id ?? null,
    transitLocationId: result.transit_location_id ?? '',
  };
}

// ------------------------------------------------------------------
// Delivery completion → move stock out
// ------------------------------------------------------------------

export interface PaymentGateStatus {
  allowed: boolean;
  paidAmount: number;
  totalAmount: number;
  message: string;
}

export async function canCreateDeliveryForSO(salesOrderId: string): Promise<PaymentGateStatus> {
  const { data, error } = await sb
    .from('sales_orders')
    .select('paid_amount, grand_total, total')
    .eq('id', salesOrderId)
    .maybeSingle();
  if (error || !data) {
    return { allowed: false, paidAmount: 0, totalAmount: 0, message: 'Sales order not found' };
  }
  const paid = Number(data.paid_amount ?? 0);
  const total = Number(data.grand_total ?? data.total ?? 0);
  const allowed = total > 0 && paid + 0.005 >= total;
  return {
    allowed,
    paidAmount: paid,
    totalAmount: total,
    message: allowed
      ? 'Fully paid — delivery available.'
      : `Delivery available after full payment. Current: ₹${paid.toLocaleString('en-IN')} paid of ₹${total.toLocaleString('en-IN')}`,
  };
}

export interface CompleteDeliveryResult {
  delivered: number;
  soClosed: boolean;
}

export async function completeDeliveryWithQc(
  dnId: string,
  opts: { signatureReceived?: boolean } = {},
): Promise<CompleteDeliveryResult> {
  // 1. Load DN
  const { data: dn, error: dnErr } = await sb
    .from('delivery_notes').select('*').eq('id', dnId).maybeSingle();
  if (dnErr) throw dnErr;
  if (!dn) throw new Error('Delivery note not found');
  if (dn.status === 'delivered') throw new Error('Delivery note already delivered');
  const salesOrderId: string | null = dn.sales_order_id;
  if (!salesOrderId) throw new Error('Delivery note has no linked sales order');

  // 2. Payment gate (defence-in-depth; UI already blocks the button)
  const gate = await canCreateDeliveryForSO(salesOrderId);
  if (!gate.allowed) throw new Error(gate.message);

  // 3. Load inspections
  const inspections = await getQCInspections('delivery_note', dnId);
  const failed = inspections.filter(i => i.qcStatus === 'fail');
  if (failed.length > 0) {
    const serials = failed.map(f => f.serialNumber).join(', ');
    throw new Error(`Cannot deliver: ${failed.length} unit(s) failed QC at handoff (${serials}). Resolve before completing.`);
  }
  const passed = inspections.filter(i => i.qcStatus === 'pass');

  // 4. Move each passed serial from transit → sold
  const serialsAtDelivery = passed
    .map(i => i.serialNumber)
    .filter((s): s is string => !!s);
  const uid = await authUserId();

  if (serialsAtDelivery.length > 0) {
    const { error: upErr } = await sb
      .from('goods_receipt_serials')
      .update({
        stock_status: 'sold',
        current_location: null,
        qc_status: 'passed',
        qc_checked_by: uid,
        qc_checked_at: new Date().toISOString(),
      })
      .eq('reserved_for_so_id', salesOrderId)
      .in('serial_number', serialsAtDelivery);
    if (upErr) throw upErr;
  }

  // 5. Update DN
  const nowIso = new Date().toISOString();
  const { error: dupErr } = await sb
    .from('delivery_notes')
    .update({
      status: 'delivered',
      delivered_at: nowIso,
      delivery_date: nowIso,
      signature_collected: !!opts.signatureReceived,
      customer_signature_received: !!opts.signatureReceived,
      customer_signature_date: opts.signatureReceived ? nowIso.slice(0, 10) : null,
      qc_by: uid,
    })
    .eq('id', dnId);
  if (dupErr) throw dupErr;

  // 6. Close SO if all its DNs are delivered
  const { data: siblingDNs } = await sb
    .from('delivery_notes').select('id, status').eq('sales_order_id', salesOrderId);
  const allDelivered = ((siblingDNs ?? []) as Array<{ status: string }>).every(d => d.status === 'delivered');
  let soClosed = false;
  if (allDelivered) {
    await sb.from('sales_orders').update({ status: 'delivered' }).eq('id', salesOrderId);
    soClosed = true;
  }

  // 7. Notifications
  const [{ data: so }, adminIds] = await Promise.all([
    sb.from('sales_orders').select('created_by, reference').eq('id', salesOrderId).maybeSingle(),
    usersWithRoles(['super_admin']),
  ]);
  const recipients = new Set<string>(adminIds);
  if (so?.created_by) recipients.add(so.created_by);
  await notifyUsers(Array.from(recipients), {
    title: `Delivery ${dn.reference} completed`,
    body: `${passed.length} unit(s) handed to customer${soClosed ? '. Sales order closed.' : '.'}`,
    category: 'fulfillment',
    priority: 'normal',
    relatedEntityType: 'delivery_note',
    relatedEntityId: dnId,
    linkUrl: `/inventory/delivery-notes/${dnId}`,
  });

  return { delivered: passed.length, soClosed };
}