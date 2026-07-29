import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Row = Database['public']['Tables']['operation_types']['Row'];
type Insert = Database['public']['Tables']['operation_types']['Insert'];
type Update = Database['public']['Tables']['operation_types']['Update'];

export type OperationKind = 'receipt' | 'delivery' | 'internal_transfer' | 'manufacturing';
export type BackorderPolicy = 'ask' | 'always' | 'never';

export interface OperationType {
  id: string;
  // --- General ---
  name: string;
  operationKind: OperationKind;
  sequencePrefix?: string | null;
  barcode?: string | null;
  returnsOperationTypeId?: string | null;
  createBackorder: BackorderPolicy;
  cardColor?: string | null;
  useExistingLots: boolean;
  createNewLots: boolean;
  defaultSourceLocationId?: string | null;
  defaultDestLocationId?: string | null;
  isActive: boolean;
  // --- Hardware (print on validation) ---
  printDeliverySlip?: boolean;
  printReturnSlip?: boolean;
  printProductLabels?: boolean;
  printLotSerialLabels?: boolean;
  // --- Barcode app ---
  showReservedLots?: boolean;
  mandatoryScanProduct?: boolean;
  mandatoryScanLotSerial?: boolean;
  mandatoryScanDestLocation?: boolean;
  allowExtraProducts?: boolean;
  allowFullPickingValidation?: boolean;
  forceDestAllProducts?: boolean;
}

const map = (r: Row): OperationType => ({
  id: r.id,
  name: r.name,
  operationKind: r.operation_kind as OperationKind,
  sequencePrefix: r.sequence_prefix ?? null,
  barcode: r.barcode ?? null,
  returnsOperationTypeId: r.returns_operation_type_id ?? null,
  createBackorder: (r.create_backorder ?? 'ask') as BackorderPolicy,
  cardColor: r.card_color ?? 'gray',
  useExistingLots: r.use_existing_lots ?? true,
  createNewLots: r.create_new_lots ?? true,
  defaultSourceLocationId: r.default_source_location_id ?? null,
  defaultDestLocationId: r.default_dest_location_id ?? null,
  isActive: !!r.is_active,
  printDeliverySlip: !!r.print_delivery_slip,
  printReturnSlip: !!r.print_return_slip,
  printProductLabels: !!r.print_product_labels,
  printLotSerialLabels: !!r.print_lot_serial_labels,
  showReservedLots: r.show_reserved_lots ?? true,
  mandatoryScanProduct: !!r.mandatory_scan_product,
  mandatoryScanLotSerial: !!r.mandatory_scan_lot_serial,
  mandatoryScanDestLocation: !!r.mandatory_scan_dest_location,
  allowExtraProducts: r.allow_extra_products ?? true,
  allowFullPickingValidation: !!r.allow_full_picking_validation,
  forceDestAllProducts: !!r.force_dest_all_products,
});

/**
 * Camel -> snake, emitting ONLY the keys the caller actually supplied.
 *
 * This is the fix for a data-loss bug. The previous version built a complete
 * payload with `?? default` on every column, so an UPDATE that omitted a field
 * wrote the default over the stored value instead of leaving it alone — saving
 * without `showReservedLots` would flip it true -> false, and the
 * mandatory-scan flags would reset. This now matches the sparse behaviour of
 * `saveLocationAsync` / `saveWarehouseAsync` (see `locationToRow` in api.ts):
 * an absent key is absent from the UPDATE, so the column is preserved.
 *
 * `undefined` means "leave it alone"; `null` means "clear it". That distinction
 * is what lets a caller blank an optional FK while omitting fields it does not
 * own.
 */
function toRow(input: Partial<OperationType>): Update {
  const out: Update = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.operationKind !== undefined) out.operation_kind = input.operationKind;
  if (input.sequencePrefix !== undefined) out.sequence_prefix = input.sequencePrefix;
  if (input.barcode !== undefined) out.barcode = input.barcode;
  if (input.returnsOperationTypeId !== undefined) out.returns_operation_type_id = input.returnsOperationTypeId;
  if (input.createBackorder !== undefined) out.create_backorder = input.createBackorder;
  if (input.cardColor !== undefined) out.card_color = input.cardColor;
  if (input.useExistingLots !== undefined) out.use_existing_lots = input.useExistingLots;
  if (input.createNewLots !== undefined) out.create_new_lots = input.createNewLots;
  if (input.defaultSourceLocationId !== undefined) out.default_source_location_id = input.defaultSourceLocationId;
  if (input.defaultDestLocationId !== undefined) out.default_dest_location_id = input.defaultDestLocationId;
  if (input.isActive !== undefined) out.is_active = input.isActive;
  if (input.printDeliverySlip !== undefined) out.print_delivery_slip = input.printDeliverySlip;
  if (input.printReturnSlip !== undefined) out.print_return_slip = input.printReturnSlip;
  if (input.printProductLabels !== undefined) out.print_product_labels = input.printProductLabels;
  if (input.printLotSerialLabels !== undefined) out.print_lot_serial_labels = input.printLotSerialLabels;
  if (input.showReservedLots !== undefined) out.show_reserved_lots = input.showReservedLots;
  if (input.mandatoryScanProduct !== undefined) out.mandatory_scan_product = input.mandatoryScanProduct;
  if (input.mandatoryScanLotSerial !== undefined) out.mandatory_scan_lot_serial = input.mandatoryScanLotSerial;
  if (input.mandatoryScanDestLocation !== undefined) out.mandatory_scan_dest_location = input.mandatoryScanDestLocation;
  if (input.allowExtraProducts !== undefined) out.allow_extra_products = input.allowExtraProducts;
  if (input.allowFullPickingValidation !== undefined) out.allow_full_picking_validation = input.allowFullPickingValidation;
  if (input.forceDestAllProducts !== undefined) out.force_dest_all_products = input.forceDestAllProducts;
  return out;
}

/**
 * Explicit values for defaulted columns on INSERT. These mirror the live column
 * defaults exactly, so stating them changes nothing today while keeping a new
 * row's shape independent of future default drift. Caller-supplied values win —
 * they are spread in afterwards.
 */
const CREATE_DEFAULTS = {
  create_backorder: 'ask',
  card_color: 'gray',
  use_existing_lots: true,
  create_new_lots: true,
  is_active: true,
  print_delivery_slip: false,
  print_return_slip: false,
  print_product_labels: false,
  print_lot_serial_labels: false,
  show_reserved_lots: true,
  mandatory_scan_product: false,
  mandatory_scan_lot_serial: false,
  mandatory_scan_dest_location: false,
  allow_extra_products: true,
  allow_full_picking_validation: false,
  force_dest_all_products: false,
} satisfies Partial<Insert>;

export async function listOperationTypes(): Promise<OperationType[]> {
  const { data, error } = await supabase.from('operation_types').select('*').order('name');
  if (error) throw error;
  return (data ?? []).map(map);
}

export async function saveOperationType(
  input: Partial<OperationType> & { name: string; operationKind: OperationKind },
): Promise<OperationType> {
  const row = toRow(input);

  if (input.id) {
    // Sparse: columns the caller did not mention are left exactly as they are.
    const { data, error } = await supabase
      .from('operation_types')
      .update(row)
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) throw error;
    return map(data);
  }

  const { data, error } = await supabase
    .from('operation_types')
    .insert({ ...CREATE_DEFAULTS, ...row, name: input.name, operation_kind: input.operationKind })
    .select('*')
    .single();
  if (error) throw error;
  return map(data);
}

export async function deleteOperationType(id: string): Promise<void> {
  const { error } = await supabase.from('operation_types').delete().eq('id', id);
  if (error) throw error;
}
