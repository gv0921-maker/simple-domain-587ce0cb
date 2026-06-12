import { supabase } from '@/integrations/supabase/client';

export type DocumentType =
  | 'sales_order' | 'quotation' | 'invoice' | 'delivery_note'
  | 'internal_transfer' | 'vendor_order' | 'work_order' | 'return_request'
  | 'credit_note' | 'goods_receipt' | 'payment_receipt' | 'correction_order'
  | 'stock_count' | 'write_off';

export interface NumberingSettings {
  id: string;
  fy_start_month: number;
  fy_start_day: number;
  prefix_separator: string;
  sequential_padding: number;
  updated_at: string;
  updated_by: string | null;
}

const sb = supabase as any;

/** Returns the current FY label (e.g. "2526") via the DB function. */
export async function getCurrentFY(): Promise<string> {
  const { data, error } = await supabase.rpc('get_current_fy_label' as any);
  if (error) throw error;
  return (data as unknown as string) ?? '';
}

export async function getNumberingSettings(): Promise<NumberingSettings | null> {
  const { data, error } = await sb.from('numbering_settings').select('*').limit(1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function updateNumberingSettings(
  patch: Partial<Pick<NumberingSettings, 'fy_start_month' | 'fy_start_day' | 'sequential_padding' | 'prefix_separator'>>,
): Promise<NumberingSettings> {
  const current = await getNumberingSettings();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
  if (!current) {
    const { data, error } = await sb.from('numbering_settings').insert({ ...patch, updated_by: userId }).select('*').single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await sb.from('numbering_settings').update({ ...patch, updated_by: userId }).eq('id', current.id).select('*').single();
  if (error) throw error;
  return data;
}

/** Atomically reserve & return the next document number. */
export async function generateDocumentNumber(documentType: DocumentType | string): Promise<string> {
  const { data, error } = await supabase.rpc('generate_document_number' as any, { p_document_type: documentType });
  if (error) throw error;
  return (data as unknown as string) ?? '';
}

/** Preview the next document number without incrementing. */
export async function previewNextNumber(documentType: DocumentType | string): Promise<string> {
  const { data, error } = await supabase.rpc('preview_next_document_number' as any, { p_document_type: documentType });
  if (error) throw error;
  return (data as unknown as string) ?? '';
}