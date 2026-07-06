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
  // 1. Load ITO
  const { data: ito, error: ie } = await sb
    .from('internal_transfer_orders')
    .select('*')
    .eq('id', itoId)
    .maybeSingle();
  if (ie) throw ie;
  if (!ito) throw new Error('ITO not found');
  if (ito.status === 'completed') throw new Error('ITO already completed');
  const salesOrderId: string = ito.sales_order_id;

  // 2. Load inspections + reserved serials
  const [inspections, reserved] = await Promise.all([
    getQCInspections('ito', itoId),
    getReservedSerialsForSO(salesOrderId),
  ]);

  const bySerial = new Map(
    reserved.map(r => [r.serial_number.toLowerCase(), r]),
  );

  const passed = inspections.filter(i => i.qcStatus === 'pass');
  const failed = inspections.filter(i => i.qcStatus === 'fail');

  // 3. Auto-create a Correction Order for failed units (if any) and block completion
  let correctionOrderId: string | null = null;
  if (failed.length > 0) {
    correctionOrderId = await createCorrectionOrderForFailedUnits(itoId, ito.ito_number, failed, bySerial);
    const serials = failed.map(f => f.serialNumber).join(', ');
    throw new Error(
      `ITO cannot complete: ${failed.length} unit${failed.length === 1 ? '' : 's'} failed QC (${serials}). ` +
      `Correction Order created. Resolve or replace failed units before completing.`,
    );
  }

  // 4. Resolve destination transit location from the serials being moved
  const passedRows = passed
    .map(i => bySerial.get((i.serialNumber ?? '').toLowerCase()))
    .filter((r): r is NonNullable<typeof r> => !!r);
  if (passedRows.length === 0) throw new Error('No passed units to move');

  const warehouseId = passedRows[0].current_warehouse_id;
  if (!warehouseId) {
    throw new Error('Reserved serials are missing a warehouse — cannot resolve transit location.');
  }
  const transit = await getTransitLocationForWarehouse(warehouseId);
  if (!transit) {
    const { data: wh } = await sb
      .from('warehouses').select('name, code').eq('id', warehouseId).maybeSingle();
    const wLabel = wh?.name ?? wh?.code ?? warehouseId;
    throw new Error(
      `No transit location configured for warehouse "${wLabel}". ` +
      `Create one in Setup → Locations with type = "transit".`,
    );
  }

  // 5. Move each passed serial to transit
  const uid = await authUserId();
  const serialIds = passedRows.map(r => r.id);
  const { error: upErr } = await sb
    .from('goods_receipt_serials')
    .update({
      current_location: transit.id,
      stock_status: 'reserved',
      qc_status: 'passed',
      qc_checked_by: uid,
      qc_checked_at: new Date().toISOString(),
    })
    .in('id', serialIds);
  if (upErr) throw upErr;

  // 6. Mark ITO completed
  const { error: itoErr } = await sb
    .from('internal_transfer_orders')
    .update({ status: 'completed' })
    .eq('id', itoId);
  if (itoErr) throw itoErr;

  // Update line quantity_scanned + status best-effort
  await sb
    .from('internal_transfer_order_lines')
    .update({ line_status: 'completed' })
    .eq('internal_transfer_order_id', itoId);

  // 7. Notifications: SO creator, sales_manager, super_admin
  const [{ data: so }, mgrIds] = await Promise.all([
    sb.from('sales_orders').select('created_by, reference').eq('id', salesOrderId).maybeSingle(),
    usersWithRoles(['sales_manager', 'super_admin']),
  ]);
  const recipients = new Set<string>(mgrIds);
  if (so?.created_by) recipients.add(so.created_by);
  await notifyUsers(Array.from(recipients), {
    title: `ITO ${ito.ito_number} completed — stock in transit`,
    body: `${passedRows.length} units moved to ${transit.name}. Ready for packing.`,
    category: 'fulfillment',
    priority: 'normal',
    relatedEntityType: 'internal_transfer_order',
    relatedEntityId: itoId,
    linkUrl: `/inventory/ito/${itoId}`,
  });

  return {
    moved: passedRows.length,
    failed: 0,
    correctionOrderId,
    transitLocationId: transit.id,
  };
}

async function createCorrectionOrderForFailedUnits(
  itoId: string,
  itoNumber: string,
  failedInspections: Awaited<ReturnType<typeof getQCInspections>>,
  bySerial: Map<string, {
    id: string; product_id: string; goods_receipt_id: string; serial_number: string;
  }>,
): Promise<string | null> {
  const uid = await authUserId();
  const coNumber = `CO-ITO-${Date.now().toString(36).toUpperCase()}`;
  const items = failedInspections
    .map(i => {
      const r = bySerial.get((i.serialNumber ?? '').toLowerCase());
      if (!r) return null;
      return {
        goods_receipt_serial_id: r.id,
        product_id: r.product_id,
        serial_number: r.serial_number,
        original_qc_notes: i.qcNotes,
        original_qc_images: i.photoUrls,
        latest_qc_status: 'failed' as const,
        latest_qc_cycle: 1,
        current_status: 'awaiting_correction' as const,
        notes: `Failed QC during ITO ${itoNumber}`,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  if (items.length === 0) return null;

  const { data: co, error } = await sb
    .from('correction_orders')
    .insert({
      co_number: coNumber,
      source_type: 'goods_receipt',
      source_document_id: itoId,
      source_document_reference: itoNumber,
      addressed_to_type: 'vendor',
      addressed_to_name: 'Vendor (to be assigned)',
      correction_type: 'replace',
      status: 'draft',
      created_by: uid,
      notes: `Auto-created from failed QC on ITO ${itoNumber}`,
    })
    .select('id')
    .single();
  if (error) return null;

  const coId = co.id;
  await sb
    .from('correction_order_items')
    .insert(items.map(i => ({ ...i, correction_order_id: coId })));

  // Flag the serials so they're excluded from further reservations
  await sb
    .from('goods_receipt_serials')
    .update({ stock_status: 'under_correction', qc_status: 'failed' })
    .in('id', items.map(i => i.goods_receipt_serial_id));

  return coId;
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