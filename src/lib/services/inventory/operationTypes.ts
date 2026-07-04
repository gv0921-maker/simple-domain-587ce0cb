import { supabase } from '@/integrations/supabase/client';

export type OperationKind = 'receipt' | 'delivery' | 'internal_transfer' | 'manufacturing';
export type BackorderPolicy = 'ask' | 'always' | 'never';

export interface OperationType {
  id: string;
  name: string;
  operationKind: OperationKind;
  sequencePrefix?: string | null;
  defaultSourceLocationId?: string | null;
  defaultDestLocationId?: string | null;
  createBackorder: BackorderPolicy;
  useExistingLots: boolean;
  createNewLots: boolean;
  isActive: boolean;
  cardColor?: string | null;
  returnsOperationTypeId?: string | null;
  printDeliverySlip?: boolean;
  printProductLabels?: boolean;
  printLotSerialLabels?: boolean;
  mandatoryScanProduct?: boolean;
  mandatoryScanLotSerial?: boolean;
  allowExtraProducts?: boolean;
}

const map = (r: any): OperationType => ({
  id: r.id,
  name: r.name,
  operationKind: r.operation_kind as OperationKind,
  sequencePrefix: r.sequence_prefix ?? null,
  defaultSourceLocationId: r.default_source_location_id ?? null,
  defaultDestLocationId: r.default_dest_location_id ?? null,
  createBackorder: (r.create_backorder ?? 'ask') as BackorderPolicy,
  useExistingLots: r.use_existing_lots ?? true,
  createNewLots: r.create_new_lots ?? true,
  isActive: !!r.is_active,
  cardColor: r.card_color ?? 'gray',
  returnsOperationTypeId: r.returns_operation_type_id ?? null,
  printDeliverySlip: !!r.print_delivery_slip,
  printProductLabels: !!r.print_product_labels,
  printLotSerialLabels: !!r.print_lot_serial_labels,
  mandatoryScanProduct: !!r.mandatory_scan_product,
  mandatoryScanLotSerial: !!r.mandatory_scan_lot_serial,
  allowExtraProducts: r.allow_extra_products ?? true,
});

export async function listOperationTypes(): Promise<OperationType[]> {
  const { data, error } = await supabase.from('operation_types' as any).select('*').order('name');
  if (error) throw error;
  return (data ?? []).map(map);
}

export async function saveOperationType(input: Partial<OperationType> & { name: string; operationKind: OperationKind }): Promise<OperationType> {
  const payload: any = {
    name: input.name,
    operation_kind: input.operationKind,
    sequence_prefix: input.sequencePrefix ?? null,
    default_source_location_id: input.defaultSourceLocationId ?? null,
    default_dest_location_id: input.defaultDestLocationId ?? null,
    create_backorder: input.createBackorder ?? 'ask',
    use_existing_lots: input.useExistingLots ?? true,
    create_new_lots: input.createNewLots ?? true,
    is_active: input.isActive ?? true,
    card_color: input.cardColor ?? 'gray',
    returns_operation_type_id: input.returnsOperationTypeId ?? null,
    print_delivery_slip: input.printDeliverySlip ?? false,
    print_product_labels: input.printProductLabels ?? false,
    print_lot_serial_labels: input.printLotSerialLabels ?? false,
    mandatory_scan_product: input.mandatoryScanProduct ?? false,
    mandatory_scan_lot_serial: input.mandatoryScanLotSerial ?? false,
    allow_extra_products: input.allowExtraProducts ?? true,
  };
  if (input.id) {
    const { data, error } = await supabase.from('operation_types' as any).update(payload).eq('id', input.id).select('*').single();
    if (error) throw error;
    return map(data);
  }
  const { data, error } = await supabase.from('operation_types' as any).insert(payload).select('*').single();
  if (error) throw error;
  return map(data);
}

export async function deleteOperationType(id: string): Promise<void> {
  const { error } = await supabase.from('operation_types' as any).delete().eq('id', id);
  if (error) throw error;
}