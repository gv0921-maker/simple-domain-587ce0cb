import { supabase } from '@/integrations/supabase/client';

import { db } from '@/integrations/supabase/db';
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

/**
 * A per-(document type, financial year) counter row.
 *
 * These four columns are the whole table — there is no prefix, padding or
 * separator here. `generate_document_number` reads ONLY `last_number` from this
 * table (via `INSERT … ON CONFLICT (document_type, fy_label) DO UPDATE SET
 * last_number = last_number + 1`); the prefix comes from a hardcoded CASE in
 * that function and the format comes from `numbering_settings`.
 */
export interface NumberingSequence {
  id: string;
  document_type: string;
  fy_label: string;
  last_number: number;
  updated_at: string;
}

const sb = db;

/** Returns the current FY label (e.g. "2526") via the DB function. */
export async function getCurrentFY(): Promise<string> {
  const { data, error } = await supabase.rpc('get_current_fy_label');
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
  const { data, error } = await supabase.rpc('generate_document_number', { p_document_type: documentType });
  if (error) throw error;
  return (data as unknown as string) ?? '';
}

/** Preview the next document number without incrementing. */
export async function previewNextNumber(documentType: DocumentType | string): Promise<string> {
  const { data, error } = await supabase.rpc('preview_next_document_number', { p_document_type: documentType });
  if (error) throw error;
  return (data as unknown as string) ?? '';
}

// ---------------------------------------------------------------------------
// numbering_sequences — the counters
//
// Nothing in the frontend touched this table before; documents get their
// numbers from triggers calling generate_document_number. These functions exist
// so the counters can be inspected and, deliberately, advanced.
// ---------------------------------------------------------------------------

export async function listNumberingSequences(): Promise<NumberingSequence[]> {
  const { data, error } = await supabase
    .from('numbering_sequences')
    .select('*')
    .order('document_type');
  if (error) throw error;
  return (data ?? []) as NumberingSequence[];
}

/**
 * Create a counter for a (document_type, fy_label) pair.
 *
 * `last_number` is the count already issued, so a fresh sequence starts at 0
 * and the first generated document gets 1. UNIQUE (document_type, fy_label)
 * rejects duplicates; the error surfaces verbatim.
 */
export async function createNumberingSequence(input: {
  document_type: string;
  fy_label: string;
  last_number?: number;
}): Promise<NumberingSequence> {
  const { data, error } = await supabase
    .from('numbering_sequences')
    .insert({
      document_type: input.document_type,
      fy_label: input.fy_label,
      last_number: Math.max(0, Math.floor(input.last_number ?? 0)),
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as NumberingSequence;
}

/**
 * Advance a counter. Sparse by construction: `last_number` is the only column
 * written, so document_type, fy_label and id can never be disturbed by an edit.
 *
 * FORWARD ONLY. Lowering a counter would make generate_document_number re-issue
 * numbers that are already on live documents, and no unique constraint exists on
 * any *_number column to catch the collision. The guard is enforced here as well
 * as in the form so it cannot be bypassed by a different caller.
 */
export async function advanceNumberingSequence(
  id: string,
  lastNumber: number,
): Promise<NumberingSequence> {
  const next = Math.floor(lastNumber);
  const { data: existing, error: readErr } = await supabase
    .from('numbering_sequences')
    .select('last_number')
    .eq('id', id)
    .single();
  if (readErr) throw readErr;
  if (next < existing.last_number) {
    throw new Error(
      `Refusing to lower the counter from ${existing.last_number} to ${next}: ` +
        'document numbers already issued would be re-used.',
    );
  }

  const { data, error } = await supabase
    .from('numbering_sequences')
    .update({ last_number: next })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as NumberingSequence;
}