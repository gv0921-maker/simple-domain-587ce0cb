import { supabase } from '@/integrations/supabase/client';

export type QCDocumentType = 'ito' | 'goods_receipt' | 'delivery_note' | 'return';
export type QCInspectionStatus = 'pending' | 'pass' | 'fail';

export interface QCInspection {
  id: string;
  documentType: QCDocumentType;
  documentId: string;
  documentLineId: string | null;
  serialNumber: string | null;
  productId: string | null;
  qcStatus: QCInspectionStatus;
  qcNotes: string | null;
  photoUrls: string[];
  inspectedBy: string | null;
  inspectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QCCompletionProgress {
  totalExpected: number;
  scanned: number;
  passed: number;
  failed: number;
  pending: number;
}

export interface QCExpectedLine {
  lineId: string;
  productId: string;
  productName: string;
  expectedQty: number;
  /** Optional restriction: only these serials are valid for this line. */
  serials?: string[];
}

export interface QCReadinessResult {
  ready: boolean;
  reasons: string[];
}

const sb = supabase as any;

function mapRow(r: any): QCInspection {
  return {
    id: r.id,
    documentType: r.document_type,
    documentId: r.document_id,
    documentLineId: r.document_line_id ?? null,
    serialNumber: r.serial_number ?? null,
    productId: r.product_id ?? null,
    qcStatus: r.qc_status,
    qcNotes: r.qc_notes ?? null,
    photoUrls: Array.isArray(r.photo_urls) ? r.photo_urls : [],
    inspectedBy: r.inspected_by ?? null,
    inspectedAt: r.inspected_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getQCInspections(
  documentType: QCDocumentType,
  documentId: string,
): Promise<QCInspection[]> {
  const { data, error } = await sb
    .from('qc_inspections')
    .select('*')
    .eq('document_type', documentType)
    .eq('document_id', documentId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export interface RecordScanInput {
  documentType: QCDocumentType;
  documentId: string;
  documentLineId: string;
  serialNumber: string;
  productId: string;
  expectedLines: QCExpectedLine[];
}

/**
 * Validates the serial against provided expected lines and creates a pending
 * inspection. Throws with a user-friendly message on validation errors.
 */
export async function recordScan(input: RecordScanInput): Promise<QCInspection> {
  const serial = input.serialNumber.trim();
  if (!serial) throw new Error('Serial is empty');

  // If no line advertises any reserved serials, the caller has no stock pool
  // to scan against — refuse every scan with a clear message.
  const anySerialsReserved = input.expectedLines.some(l => (l.serials?.length ?? 0) > 0);
  if (!anySerialsReserved) {
    throw new Error(
      'No stock reserved for this order. Ensure goods have been received and stock is available.',
    );
  }

  // The serial MUST belong to one of the reserved serial lists on this document.
  const line = input.expectedLines.find(
    l => l.serials?.some(s => s.toLowerCase() === serial.toLowerCase()),
  );
  if (!line) {
    throw new Error(`Serial ${serial} is not reserved for this order`);
  }

  // Duplicate check (client-side + DB unique index as backstop).
  const existing = await getQCInspections(input.documentType, input.documentId);
  if (existing.some(e => (e.serialNumber ?? '').toLowerCase() === serial.toLowerCase())) {
    throw new Error('Already scanned');
  }

  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id ?? null;

  const { data, error } = await sb
    .from('qc_inspections')
    .insert({
      document_type: input.documentType,
      document_id: input.documentId,
      document_line_id: line.lineId,
      serial_number: serial,
      product_id: line.productId ?? input.productId,
      qc_status: 'pending',
      photo_urls: [],
      created_by: uid,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function recordQCResult(
  inspectionId: string,
  status: Exclude<QCInspectionStatus, 'pending'>,
  notes?: string,
): Promise<QCInspection> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id ?? null;
  const { data, error } = await sb
    .from('qc_inspections')
    .update({
      qc_status: status,
      qc_notes: notes ?? null,
      inspected_by: uid,
      inspected_at: new Date().toISOString(),
    })
    .eq('id', inspectionId)
    .select('*')
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function uploadQCPhoto(
  inspection: QCInspection,
  file: File,
): Promise<QCInspection> {
  const ext = file.name.split('.').pop() || 'jpg';
  const stamp = Date.now();
  const serial = inspection.serialNumber ?? 'noserial';
  const path = `${inspection.documentType}/${inspection.documentId}/${serial}_${stamp}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('qc-photos')
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from('qc-photos').getPublicUrl(path);
  const nextUrls = [...inspection.photoUrls, pub.publicUrl];

  const { data, error } = await sb
    .from('qc_inspections')
    .update({ photo_urls: nextUrls })
    .eq('id', inspection.id)
    .select('*')
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function removeQCPhoto(
  inspection: QCInspection,
  url: string,
): Promise<QCInspection> {
  const nextUrls = inspection.photoUrls.filter(u => u !== url);
  // Best-effort storage delete (extract path after the bucket segment).
  const marker = '/qc-photos/';
  const idx = url.indexOf(marker);
  if (idx >= 0) {
    const path = url.slice(idx + marker.length);
    await supabase.storage.from('qc-photos').remove([path]).catch(() => undefined);
  }
  const { data, error } = await sb
    .from('qc_inspections')
    .update({ photo_urls: nextUrls })
    .eq('id', inspection.id)
    .select('*')
    .single();
  if (error) throw error;
  return mapRow(data);
}

export function computeProgress(
  expectedLines: QCExpectedLine[],
  inspections: QCInspection[],
): QCCompletionProgress {
  const totalExpected = expectedLines.reduce((s, l) => s + (l.expectedQty || 0), 0);
  const scanned = inspections.length;
  const passed = inspections.filter(i => i.qcStatus === 'pass').length;
  const failed = inspections.filter(i => i.qcStatus === 'fail').length;
  const pending = inspections.filter(i => i.qcStatus === 'pending').length;
  return { totalExpected, scanned, passed, failed, pending };
}

export async function getCompletionProgress(
  documentType: QCDocumentType,
  documentId: string,
  expectedLines: QCExpectedLine[],
): Promise<QCCompletionProgress> {
  const inspections = await getQCInspections(documentType, documentId);
  return computeProgress(expectedLines, inspections);
}

export function validateReadyToComplete(
  expectedLines: QCExpectedLine[],
  inspections: QCInspection[],
  opts: { requireQC?: boolean; requirePhotosOnFail?: boolean } = {},
): QCReadinessResult {
  const reasons: string[] = [];
  const progress = computeProgress(expectedLines, inspections);

  const missing = progress.totalExpected - progress.scanned;
  if (missing > 0) reasons.push(`${missing} unit${missing === 1 ? '' : 's'} not yet scanned`);

  if (opts.requireQC !== false) {
    const pending = inspections.filter(i => i.qcStatus === 'pending').length;
    if (pending > 0) reasons.push(`${pending} unit${pending === 1 ? '' : 's'} awaiting QC`);
  }

  if (opts.requirePhotosOnFail) {
    const missingPhoto = inspections.filter(
      i => i.qcStatus === 'fail' && i.photoUrls.length === 0,
    ).length;
    if (missingPhoto > 0) {
      reasons.push(`${missingPhoto} failed unit${missingPhoto === 1 ? '' : 's'} need a photo`);
    }
  }

  return { ready: reasons.length === 0, reasons };
}