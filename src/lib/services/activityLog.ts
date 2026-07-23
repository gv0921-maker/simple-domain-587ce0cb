import { supabase } from '@/integrations/supabase/client';

export type ActivityRecordType =
  | 'sales_order' | 'quotation' | 'invoice' | 'delivery_note'
  | 'work_order' | 'vendor_order' | 'return_request'
  | 'employee' | 'product' | string;

export type ActivityActionType =
  | 'field_change' | 'status_change' | 'manual_note' | 'created' | 'deleted';

export const ACTIVITY_ATTACHMENTS_BUCKET = 'activity-attachments';
export const MAX_ACTIVITY_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface ActivityAttachment {
  path: string;
  url: string;
  name: string;
  size: number;
  mime: string;
  kind: 'image' | 'file';
  width?: number | null;
  height?: number | null;
}

export interface ActivityLogEntry {
  id: string;
  record_type: string;
  record_id: string;
  action_type: ActivityActionType;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  note_text: string | null;
  changed_by: string;
  changed_at: string;
  is_deleted: boolean;
  deleted_by: string | null;
  deleted_at: string | null;
  attachments: ActivityAttachment[];
  // joined
  changed_by_name?: string | null;
  changed_by_avatar?: string | null;
}

async function currentUid(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function fetchActivityLog(
  recordType: ActivityRecordType,
  recordId: string,
  limit = 20,
  offset = 0,
): Promise<{ entries: ActivityLogEntry[]; total: number }> {
  const { data, error } = await supabase.rpc('get_activity_log_with_users' as any, {
    p_record_type: recordType,
    p_record_id: recordId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const total = rows[0]?.total_count ? Number(rows[0].total_count) : rows.length;
  const entries: ActivityLogEntry[] = rows.map((r) => ({
    id: r.id,
    record_type: r.record_type,
    record_id: r.record_id,
    action_type: r.action_type,
    field_name: r.field_name,
    old_value: r.old_value,
    new_value: r.new_value,
    note_text: r.note_text,
    changed_by: r.changed_by,
    changed_at: r.changed_at,
    is_deleted: r.is_deleted,
    deleted_by: r.deleted_by,
    deleted_at: r.deleted_at,
    attachments: Array.isArray(r.attachments) ? r.attachments as ActivityAttachment[] : [],
    changed_by_name: r.changed_by_name,
  }));
  return { entries, total };
}

function stringify(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

async function insertEntry(row: Record<string, unknown>) {
  const uid = await currentUid();
  if (!uid) return; // not signed in — silently skip
  const { error } = await supabase
    .from('activity_log' as any)
    .insert({ ...row, changed_by: uid });
  if (error) throw error;
}

export async function addManualNote(
  recordType: ActivityRecordType, recordId: string, noteText: string,
  attachments: ActivityAttachment[] = [],
  opts: { mentions?: string[]; recordLabel?: string; linkUrl?: string } = {},
) {
  const t = noteText.trim();
  if (!t && attachments.length === 0) return;
  await insertEntry({
    record_type: recordType, record_id: recordId,
    action_type: 'manual_note', note_text: t,
    attachments: attachments as unknown as Record<string, unknown>,
  });
  const mentions = Array.from(new Set(opts.mentions ?? [])).filter(Boolean);
  if (mentions.length > 0) {
    const uid = await currentUid();
    const title = opts.recordLabel
      ? `You were mentioned on ${opts.recordLabel}`
      : 'You were mentioned in a note';
    // Strip HTML from body preview.
    const plain = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
    const rows = mentions
      .filter((m) => m !== uid) // don't notify yourself
      .map((recipient) => ({
        recipient_user_id: recipient,
        title,
        body: plain || 'You were mentioned.',
        category: 'mention',
        notification_type: 'mention',
        priority: 'normal',
        related_entity_type: recordType,
        related_entity_id: recordId,
        link_url: opts.linkUrl ?? null,
      }));
    if (rows.length > 0) {
      // Fire-and-forget: mention notifications should not block note creation.
      await supabase.from('notifications' as any).insert(rows as any);
    }
  }
}

export async function uploadActivityAttachment(
  file: File,
  recordType: ActivityRecordType,
  recordId: string,
): Promise<ActivityAttachment> {
  if (file.size > MAX_ACTIVITY_ATTACHMENT_BYTES) {
    throw new Error(`File "${file.name}" exceeds 25 MB limit`);
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const stamp = Date.now();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${recordType}/${recordId}/${user.id}/${stamp}-${safe}`;

  const { error: upErr } = await supabase.storage
    .from(ACTIVITY_ATTACHMENTS_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });
  if (upErr) throw upErr;

  const { data: signed, error: sErr } = await supabase.storage
    .from(ACTIVITY_ATTACHMENTS_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (sErr) throw sErr;

  const mime = file.type || 'application/octet-stream';
  const kind: ActivityAttachment['kind'] = mime.startsWith('image/') ? 'image' : 'file';

  let width: number | null = null;
  let height: number | null = null;
  if (kind === 'image' && typeof window !== 'undefined') {
    try {
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
      width = dims.w; height = dims.h;
    } catch { /* ignore */ }
  }

  return {
    path,
    url: signed?.signedUrl ?? path,
    name: file.name,
    size: file.size,
    mime,
    kind,
    width,
    height,
  };
}

// Refresh a signed URL for a stored path (URLs expire after 7 days).
export async function refreshActivityAttachmentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(ACTIVITY_ATTACHMENTS_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function logFieldChange(
  recordType: ActivityRecordType, recordId: string,
  fieldName: string, oldValue: unknown, newValue: unknown,
) {
  await insertEntry({
    record_type: recordType, record_id: recordId,
    action_type: 'field_change',
    field_name: fieldName,
    old_value: stringify(oldValue),
    new_value: stringify(newValue),
  });
}

export async function logStatusChange(
  recordType: ActivityRecordType, recordId: string,
  oldStatus: unknown, newStatus: unknown,
) {
  await insertEntry({
    record_type: recordType, record_id: recordId,
    action_type: 'status_change',
    field_name: 'status',
    old_value: stringify(oldStatus),
    new_value: stringify(newStatus),
  });
}

export async function logRecordCreated(
  recordType: ActivityRecordType, recordId: string,
) {
  await insertEntry({
    record_type: recordType, record_id: recordId,
    action_type: 'created',
  });
}

export async function softDeleteLogEntry(logId: string) {
  const uid = await currentUid();
  const { error } = await supabase
    .from('activity_log' as any)
    .update({ is_deleted: true, deleted_by: uid, deleted_at: new Date().toISOString() })
    .eq('id', logId);
  if (error) throw error;
}