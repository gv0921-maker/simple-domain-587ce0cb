/**
 * Inventory 2 — QC layer.
 *
 * Reads the checklist and its history; writes results through
 * inv_record_qc_results ONLY. The status of a unit is derived by that
 * function from the whole checklist — this module never writes
 * inv_stock_item.status, and must not: the QC gate is the one rule the
 * rebuild exists to make unbypassable.
 *
 * ATTACHMENTS. Uploads go to the `qc-images` bucket under an
 * `inv2/<stock_item_id>/` prefix so nothing collides with anything else
 * stored there. The bucket's RLS already grants upload to
 * can_write_inventory() and read to authenticated, so no policy change is
 * needed. This upload code is written for this module; nothing in the legacy
 * inventory services is imported, called, or adapted here.
 *
 * `products` is READ for names only, never written. No CRM, no legacy tables.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';

type Tables = Database['public']['Tables'];
type TestTemplateRow = Tables['inv_test_template']['Row'];
type TestResultRow = Tables['inv_test_result']['Row'];

export type InvStockStatus = Database['public']['Enums']['inv_stock_status'];

/** The bucket is shared storage, not a shared table. We own the inv2/ prefix. */
const QC_BUCKET = 'qc-images';
const QC_PREFIX = 'inv2';

/* ------------------------------------------------------------------ types */

export interface QcAttachment {
  name?: string;
  url?: string;
}

export interface QcTemplate {
  id: string;
  product_id: string | null;
  name: string;
  description: string | null;
  is_required: boolean;
  requires_value: boolean;
  requires_attachment: boolean;
  sort_order: number;
}

export interface QcResultRow {
  id: string;
  seq: number;
  stock_item_id: string;
  template_id: string;
  template_name: string | null;
  result: boolean;
  value: string | null;
  notes: string | null;
  attachments: QcAttachment[];
  tested_at: string;
  tested_by: string | null;
  /** True for the newest result on its template — the one that counts. */
  is_latest: boolean;
}

export interface QcUnit {
  /** Same value as stock_item_id; DocumentList keys its rows on `id`. */
  id: string;
  stock_item_id: string;
  serial: string;
  status: InvStockStatus;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  location_name: string | null;
  received_at: string | null;
  operation_id: string | null;
  operation_number: string | null;
}

export interface QcSubmission {
  template_id: string;
  result: boolean;
  value?: string | null;
  notes?: string | null;
  attachments?: QcAttachment[];
}

/** Why a unit sits where it does, derived the same way the RPC derives it. */
export interface QcVerdict {
  status: InvStockStatus;
  requiredTotal: number;
  requiredPassed: number;
  failedRequired: string[];
  failedAdvisory: string[];
  untestedRequired: string[];
  /** No applicable template at all — the RPC would settle on `ok` untested. */
  noChecklist: boolean;
}

/* -------------------------------------------------------------- helpers */

function toAttachments(value: Json): QcAttachment[] {
  return Array.isArray(value) ? (value as QcAttachment[]) : [];
}

/**
 * Whether an attachment URL actually points at something fetchable.
 *
 * The Step 4 seed wrote paths like `/qc/received-1.jpg`, which resolve to
 * nothing — there is no such route and no such file. Showing them as working
 * evidence would be a lie about what was inspected, so they are surfaced as
 * broken instead of rendered as links.
 */
export function isLiveAttachment(a: QcAttachment): boolean {
  const url = a.url ?? '';
  return /^https?:\/\//i.test(url);
}

/* ------------------------------------------------------------- reads */

/** Templates that apply to a product: its own, plus any global ones. */
export async function listTemplatesForProduct(productId: string): Promise<QcTemplate[]> {
  const { data, error } = await supabase
    .from('inv_test_template')
    .select('*')
    .eq('is_active', true)
    .or(`product_id.eq.${productId},product_id.is.null`)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as TestTemplateRow[];
}

export async function listResultsForUnit(stockItemId: string): Promise<QcResultRow[]> {
  const [resRes, tmplRes] = await Promise.all([
    supabase.from('inv_test_result').select('*').eq('stock_item_id', stockItemId).order('seq'),
    supabase.from('inv_test_template').select('id, name'),
  ]);
  if (resRes.error) throw resRes.error;
  if (tmplRes.error) throw tmplRes.error;

  const nameById = new Map<string, string>((tmplRes.data ?? []).map((t) => [t.id, t.name]));
  const rows = (resRes.data ?? []) as TestResultRow[];

  // Newest seq per template wins — the same rule inv_record_qc_results applies.
  const latestSeq = new Map<string, number>();
  for (const r of rows) {
    const cur = latestSeq.get(r.template_id);
    if (cur === undefined || r.seq > cur) latestSeq.set(r.template_id, r.seq);
  }

  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    stock_item_id: r.stock_item_id,
    template_id: r.template_id,
    template_name: nameById.get(r.template_id) ?? null,
    result: r.result,
    value: r.value,
    notes: r.notes,
    attachments: toAttachments(r.attachments),
    tested_at: r.tested_at,
    tested_by: r.tested_by,
    is_latest: latestSeq.get(r.template_id) === r.seq,
  }));
}

/**
 * Every unit in the system with its receipt, for the QC queue.
 * inv_stock_item's SELECT policy is `true` for authenticated, so this needs
 * no view and no RPC.
 */
export async function listQcUnits(): Promise<QcUnit[]> {
  const { data: items, error } = await supabase
    .from('inv_stock_item')
    .select('id, serial, status, product_id, location_id, received_at, origin_operation_id')
    .order('received_at', { ascending: false });
  if (error) throw error;
  if (!items || items.length === 0) return [];

  const productIds = [...new Set(items.map((i) => i.product_id))];
  const locationIds = [...new Set(items.map((i) => i.location_id).filter(Boolean) as string[])];
  const opIds = [...new Set(items.map((i) => i.origin_operation_id).filter(Boolean) as string[])];

  const [prodRes, locRes, opRes] = await Promise.all([
    productIds.length
      ? supabase.from('products').select('id, name, sku').in('id', productIds) : null,
    locationIds.length
      ? supabase.from('inv_location').select('id, name').in('id', locationIds) : null,
    opIds.length
      ? supabase.from('inv_operation').select('id, number').in('id', opIds) : null,
  ]);
  if (prodRes?.error) throw prodRes.error;
  if (locRes?.error) throw locRes.error;
  if (opRes?.error) throw opRes.error;

  const prod = new Map((prodRes?.data ?? []).map((p) => [p.id, p]));
  const loc = new Map((locRes?.data ?? []).map((l) => [l.id, l.name]));
  const op = new Map((opRes?.data ?? []).map((o) => [o.id, o.number]));

  return items.map((i) => ({
    id: i.id,
    stock_item_id: i.id,
    serial: i.serial,
    status: i.status,
    product_id: i.product_id,
    product_name: prod.get(i.product_id)?.name ?? null,
    product_sku: prod.get(i.product_id)?.sku ?? null,
    location_name: i.location_id ? loc.get(i.location_id) ?? null : null,
    received_at: i.received_at,
    operation_id: i.origin_operation_id,
    operation_number: i.origin_operation_id ? op.get(i.origin_operation_id) ?? null : null,
  }));
}

/* ------------------------------------------------------------- verdict */

/**
 * Re-derives the RPC's reasoning so the UI can say WHY a unit sits where it
 * does. This is a mirror for explanation only — the database remains the
 * authority, and its returned status is what gets displayed.
 */
export function explainVerdict(
  status: InvStockStatus,
  templates: QcTemplate[],
  results: QcResultRow[],
): QcVerdict {
  const latest = new Map<string, QcResultRow>();
  for (const r of results) if (r.is_latest) latest.set(r.template_id, r);

  const required = templates.filter((t) => t.is_required);
  const failedRequired: string[] = [];
  const untestedRequired: string[] = [];
  const failedAdvisory: string[] = [];

  for (const t of required) {
    const r = latest.get(t.id);
    if (!r) untestedRequired.push(t.name);
    else if (!r.result) failedRequired.push(t.name);
  }
  for (const t of templates.filter((x) => !x.is_required)) {
    const r = latest.get(t.id);
    if (r && !r.result) failedAdvisory.push(t.name);
  }

  return {
    status,
    requiredTotal: required.length,
    requiredPassed: required.length - failedRequired.length - untestedRequired.length,
    failedRequired,
    failedAdvisory,
    untestedRequired,
    noChecklist: templates.length === 0,
  };
}

/* -------------------------------------------------------------- writes */

/**
 * Upload one piece of QC evidence.
 * Namespaced per stock item; the filename is sanitised and time-prefixed so
 * two photos of the same name on the same unit cannot overwrite each other.
 */
export async function uploadQcAttachment(
  stockItemId: string,
  file: File,
): Promise<QcAttachment> {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  const path = `${QC_PREFIX}/${stockItemId}/${Date.now()}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from(QC_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;

  const { data } = supabase.storage.from(QC_BUCKET).getPublicUrl(path);
  return { name: file.name, url: data.publicUrl };
}

/** The only write path for QC. Returns the status the database derived. */
export async function recordQcResults(
  stockItemId: string,
  results: QcSubmission[],
): Promise<InvStockStatus> {
  const { data, error } = await supabase.rpc('inv_record_qc_results', {
    p_stock_item_id: stockItemId,
    p_results: results as unknown as Json,
  });
  if (error) throw error;
  return data as InvStockStatus;
}
