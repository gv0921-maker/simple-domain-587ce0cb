import { supabase } from '@/integrations/supabase/client';

export type ScanDocumentType =
  | 'goods_receipt' | 'internal_transfer' | 'pre_delivery_qc'
  | 'return_receipt' | 'stock_count' | 'correction_order' | 'write_off'
  | 'delivery_note' | 'internal_movement';

export type ScanStatus = 'pending' | 'in_progress' | 'completed';
export type ScanPriority = 'urgent' | 'normal' | 'low';
export type ScanResult = 'valid' | 'invalid' | 'duplicate' | 'not_expected';
export type LabelFormat = 'standard' | 'thermal';

export interface ScanQueueItem {
  id: string;
  document_type: ScanDocumentType;
  document_id: string;
  document_reference: string;
  expected_items_count: number;
  scanned_items_count: number;
  scan_status: ScanStatus;
  priority: ScanPriority;
  assigned_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScanRecord {
  id: string;
  scan_queue_id: string;
  barcode: string;
  serial_number: string | null;
  product_id: string | null;
  scanned_by: string | null;
  scanned_at: string;
  scan_result: ScanResult;
  notes: string | null;
}

export interface LabelPrint {
  id: string;
  product_id: string;
  serial_number: string;
  barcode_value: string;
  label_format: LabelFormat;
  printed_by: string | null;
  printed_at: string;
  goods_receipt_id: string | null;
  print_count: number;
}

export interface ScanQueueFilters {
  status?: ScanStatus | 'all';
  documentType?: ScanDocumentType | 'all';
  assignedToMe?: boolean;
  userId?: string;
  from?: string;
  to?: string;
  sort?: 'priority' | 'oldest' | 'newest';
}

async function uid(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// -------- Queue --------
export async function fetchScanQueue(filters: ScanQueueFilters = {}): Promise<ScanQueueItem[]> {
  let q = supabase.from('scan_queue' as any).select('*');
  if (filters.status && filters.status !== 'all') q = q.eq('scan_status', filters.status);
  if (filters.documentType && filters.documentType !== 'all') q = q.eq('document_type', filters.documentType);
  if (filters.assignedToMe && filters.userId) q = q.eq('assigned_to', filters.userId);
  if (filters.from) q = q.gte('created_at', filters.from);
  if (filters.to) q = q.lte('created_at', filters.to);
  const sort = filters.sort ?? 'newest';
  if (sort === 'newest') q = q.order('created_at', { ascending: false });
  else if (sort === 'oldest') q = q.order('created_at', { ascending: true });
  else q = q.order('priority', { ascending: true }).order('created_at', { ascending: true });
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown) as ScanQueueItem[];
}

export async function getScanQueueItem(id: string): Promise<ScanQueueItem | null> {
  const { data, error } = await supabase
    .from('scan_queue' as any).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? ((data as unknown) as ScanQueueItem) : null;
}

export async function addToScanQueue(
  documentType: ScanDocumentType,
  documentId: string,
  documentReference: string,
  expectedCount: number,
  priority: ScanPriority = 'normal',
): Promise<ScanQueueItem> {
  const { data, error } = await supabase.from('scan_queue' as any).insert({
    document_type: documentType,
    document_id: documentId,
    document_reference: documentReference,
    expected_items_count: expectedCount,
    priority,
  }).select('*').single();
  if (error) throw error;
  return (data as unknown) as ScanQueueItem;
}

export async function listScanRecords(queueId: string): Promise<ScanRecord[]> {
  const { data, error } = await supabase
    .from('scan_records' as any).select('*')
    .eq('scan_queue_id', queueId)
    .order('scanned_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown) as ScanRecord[];
}

export interface RecordScanInput {
  scanQueueId: string;
  barcode: string;
  serialNumber?: string | null;
  productId?: string | null;
  /** Optional list of expected barcodes to validate against. */
  expectedBarcodes?: string[];
  /** Already-scanned barcodes for duplicate detection. */
  alreadyScanned?: string[];
}

export async function recordScan(input: RecordScanInput): Promise<ScanRecord> {
  const { data, error } = await supabase.rpc('record_scan' as any, {
    p_queue_id: input.scanQueueId,
    p_barcode: input.barcode.trim(),
    p_serial: input.serialNumber ?? null,
    p_product_id: input.productId ?? null,
    p_expected: input.expectedBarcodes ?? null,
    p_already_scanned: input.alreadyScanned ?? null,
  });
  if (error) throw error;
  return (data as unknown) as ScanRecord;
}

export async function completeScanQueue(scanQueueId: string, force = false, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('complete_scan_queue' as any, {
    p_queue_id: scanQueueId,
    p_force: force,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

// -------- Barcode + Label generation --------

/** Build a Code128 barcode value from product SKU and serial number. */
export function generateBarcode(productSku: string, serialNumber: string): string {
  return `GLF-${productSku}-${serialNumber}`;
}

function yymm(d = new Date()): string {
  const yy = String(d.getFullYear()).slice(-2);
  // Indian financial year style: just YY + MM
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yy}${mm}`;
}

/** Allocate N sequential serials atomically via RPC. */
export async function allocateSerialNumbers(productSku: string, count: number): Promise<string[]> {
  const prefix = `${productSku}-${yymm()}-`;
  const { data, error } = await supabase.rpc('allocate_serial_numbers' as any, {
    p_prefix: prefix,
    p_count: count,
  });
  if (error) throw error;
  return (data ?? []) as string[];
}

/** Generate a single sequential serial number atomically. */
export async function generateSerialNumber(productSku: string): Promise<string> {
  const [s] = await allocateSerialNumbers(productSku, 1);
  if (!s) throw new Error('failed to allocate serial number');
  return s;
}

export interface LabelData {
  productId: string;
  productSku: string;
  productName: string;
  serialNumber: string;
  barcodeValue: string;
  format: LabelFormat;
}

export async function generateLabel(
  productId: string, productSku: string, productName: string,
  serialNumber: string, barcodeValue: string, format: LabelFormat = 'standard',
): Promise<LabelData> {
  return { productId, productSku, productName, serialNumber, barcodeValue, format };
}

export interface BatchLabelItem {
  productId: string;
  productSku: string;
  productName: string;
  quantity: number;
  format?: LabelFormat;
  goodsReceiptId?: string | null;
}

export async function batchGenerateLabels(items: BatchLabelItem[]): Promise<LabelData[]> {
  const out: LabelData[] = [];
  for (const it of items) {
    if (it.quantity < 1) continue;
    // One RPC call allocates the full batch atomically.
    const serials = await allocateSerialNumbers(it.productSku, it.quantity);
    for (const serial of serials) {
      out.push({
        productId: it.productId,
        productSku: it.productSku,
        productName: it.productName,
        serialNumber: serial,
        barcodeValue: generateBarcode(it.productSku, serial),
        format: it.format ?? 'standard',
      });
    }
  }
  return out;
}

export async function recordLabelPrints(
  labels: LabelData[], goodsReceiptId?: string | null,
): Promise<void> {
  const me = await uid();
  if (!labels.length) return;
  const rows = labels.map((l) => ({
    product_id: l.productId,
    serial_number: l.serialNumber,
    barcode_value: l.barcodeValue,
    label_format: l.format,
    printed_by: me,
    goods_receipt_id: goodsReceiptId ?? null,
    print_count: 1,
  }));
  const { error } = await supabase.from('label_prints' as any).insert(rows);
  if (error) throw error;
}

export async function fetchLabelHistory(productId?: string, limit = 200): Promise<LabelPrint[]> {
  let q = supabase.from('label_prints' as any).select('*')
    .order('printed_at', { ascending: false }).limit(limit);
  if (productId) q = q.eq('product_id', productId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown) as LabelPrint[];
}

// -------- Scan history (cross-queue) --------
export interface ScanHistoryFilters {
  productId?: string;
  serial?: string;
  barcode?: string;
  scannedBy?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export async function fetchScanHistory(filters: ScanHistoryFilters = {}): Promise<ScanRecord[]> {
  let q = supabase.from('scan_records' as any).select('*')
    .order('scanned_at', { ascending: false })
    .limit(filters.limit ?? 200);
  if (filters.productId) q = q.eq('product_id', filters.productId);
  if (filters.serial) q = q.ilike('serial_number', `%${filters.serial}%`);
  if (filters.barcode) q = q.ilike('barcode', `%${filters.barcode}%`);
  if (filters.scannedBy) q = q.eq('scanned_by', filters.scannedBy);
  if (filters.from) q = q.gte('scanned_at', filters.from);
  if (filters.to) q = q.lte('scanned_at', filters.to);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown) as ScanRecord[];
}