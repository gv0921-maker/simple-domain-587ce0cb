// Canonical chatter — mirrors the CRM Opportunity chatter design.
// Three tabs (Send message / Log note / Activity), rich-text editor with
// @mentions and attachments, day-grouped feed, avatar + name + timestamp.
// System entries (RPC-written status/field changes) render inline as plain
// lines. All persistence goes through activity_log.
import { useMemo, useState } from 'react';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import {
  Trash2, Search, ArrowRightLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useRoleCheck } from '@/hooks/auth/useRoleCheck';
import { useAppUsers, displayNameFor } from '@/hooks/useAppUsers';
import {
  useActivityLog, useAddManualNote, useSoftDeleteLogEntry,
} from '@/hooks/useActivityLog';
import type {
  ActivityAttachment, ActivityLogEntry, ActivityRecordType,
} from '@/lib/services/activityLog';
import { uploadActivityAttachment } from '@/lib/services/activityLog';
import { RichComposer, RichContent, type RichAttachment } from '@/components/ui/rich-composer';
import { cn } from '@/lib/utils';

interface Props {
  recordType: ActivityRecordType;
  recordId: string | undefined;
  className?: string;
  /** Optional human-readable label for the record (used in mention notifications). */
  recordLabel?: string;
}

type TabKey = 'message' | 'note' | 'activity';

function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function fmtStamp(iso: string): string {
  try { return format(parseISO(iso), 'dd-MM-yyyy h:mm a'); } catch { return iso; }
}

function fmtTime(iso: string): string {
  try { return format(parseISO(iso), 'h:mm a'); } catch { return iso; }
}

function dayBucket(iso: string): string {
  try {
    const d = parseISO(iso);
    if (isToday(d)) return 'Today';
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'MMM d, yyyy');
  } catch {
    return iso.slice(0, 10);
  }
}

function friendlyField(name: string | null): string {
  if (!name) return 'field';
  return name
    .replace(/_id$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function displayValue(v: string | null): string {
  if (v == null || v === '') return '—';
  return v;
}

// A small colored avatar bubble like the CRM opportunity chatter uses.
function ChatterAvatar({ name }: { name: string }) {
  const colors = [
    'bg-[#875A7B]', 'bg-[#00A09D]', 'bg-[#F0AD4E]',
    'bg-[#5CB85C]', 'bg-[#D9534F]', 'bg-[#337AB7]',
  ];
  const hash = Array.from(name).reduce((a, c) => a + c.charCodeAt(0), 0);
  const color = colors[hash % colors.length];
  return (
    <div className={cn(
      'h-8 w-8 shrink-0 rounded-full text-white flex items-center justify-center text-[11px] font-bold',
      color,
    )}>
      {initials(name)}
    </div>
  );
}

// Convert a RichComposer attachment (uploaded via our uploader) back to the
// ActivityAttachment shape stored on the log row.
function toActivityAttachment(a: RichAttachment): ActivityAttachment {
  return {
    path: (a as any).path ?? a.name,
    url: a.url ?? a.dataUrl ?? '',
    name: a.name,
    size: a.size ?? 0,
    mime: a.type || 'application/octet-stream',
    kind: (a.type && a.type.startsWith('image/')) ? 'image' : 'file',
  };
}

// Detect whether the stored note_text is HTML (rich composer output).
function looksLikeHtml(s: string | null): boolean {
  return !!s && /<[a-z][\s\S]*>/i.test(s);
}

// System entry — rendered as a plain inline line (like CRM "Stage changed").
function SystemLine({ entry, currentUserId, currentUserName }: {
  entry: ActivityLogEntry;
  currentUserId?: string;
  currentUserName?: string;
}) {
  const isSelf = entry.changed_by === currentUserId;
  const who = isSelf ? (currentUserName ?? 'You') : (entry.changed_by_name ?? 'System');

  const body = (() => {
    switch (entry.action_type) {
      case 'created':
        return <span>{who} <span className="text-muted-foreground">created this record</span></span>;
      case 'deleted':
        return <span>{who} <span className="text-muted-foreground">deleted this record</span></span>;
      case 'status_change': {
        const label = entry.field_name === 'stage_id' ? 'Stage changed' : 'Status changed';
        if (!entry.old_value && !entry.new_value && entry.note_text) {
          return <span className="whitespace-pre-wrap">{entry.note_text}</span>;
        }
        return (
          <span>
            <span className="font-medium">{label}: </span>
            <span>{displayValue(entry.old_value)}</span>
            <span className="text-muted-foreground"> → </span>
            <span className="font-medium text-foreground">{displayValue(entry.new_value)}</span>
          </span>
        );
      }
      case 'field_change':
        if (!entry.old_value && !entry.new_value && entry.note_text) {
          return <span className="whitespace-pre-wrap">{entry.note_text}</span>;
        }
        return (
          <span>
            <span className="font-medium">{friendlyField(entry.field_name)}: </span>
            <span>{displayValue(entry.old_value)}</span>
            <span className="text-muted-foreground"> → </span>
            <span className="font-medium text-foreground">{displayValue(entry.new_value)}</span>
          </span>
        );
      default:
        return null;
    }
  })();

  return (
    <div className="flex items-start gap-2 py-1.5 text-xs text-muted-foreground">
      <ArrowRightLeft className="h-3 w-3 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">{body}</div>
      <span className="shrink-0 text-[11px]" title={fmtStamp(entry.changed_at)}>
        {fmtTime(entry.changed_at)}
      </span>
    </div>
  );
}

// Manual note — rendered like CRM Opportunity chatter items.
function NoteRow({
  entry, canDelete, onDelete, currentUserId, currentUserName,
}: {
  entry: ActivityLogEntry;
  canDelete: boolean;
  onDelete: (id: string) => void;
  currentUserId?: string;
  currentUserName?: string;
}) {
  const isSelf = entry.changed_by === currentUserId;
  const who = isSelf
    ? (currentUserName ?? 'You')
    : (entry.changed_by_name ?? 'A user');

  const html = looksLikeHtml(entry.note_text)
    ? (entry.note_text as string)
    : entry.note_text
      ? `<p>${(entry.note_text as string).replace(/\n/g, '<br/>')}</p>`
      : '';

  return (
    <div className="flex gap-2.5 mb-3 group">
      <ChatterAvatar name={who} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-bold text-foreground">{who}</span>
          <span className="text-xs text-muted-foreground" title={fmtStamp(entry.changed_at)}>
            {fmtTime(entry.changed_at)}
          </span>
          {canDelete && (
            <Button
              variant="ghost" size="sm"
              className="ml-auto h-6 w-6 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
              onClick={() => onDelete(entry.id)}
              aria-label="Delete note"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="mt-0.5">
          <RichContent
            html={html}
            attachments={(entry.attachments ?? []).map((a) => ({
              name: a.name,
              type: a.mime,
              size: a.size,
              url: a.url,
            }))}
          />
        </div>
      </div>
    </div>
  );
}

export function ActivityChatter({ recordType, recordId, className, recordLabel }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<TabKey>('note');
  const [limit, setLimit] = useState(20);
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');

  const { isSuperAdmin } = useRoleCheck();
  const { data: appUsers = [] } = useAppUsers();

  const q = useActivityLog(recordType, recordId, limit);
  const addNote = useAddManualNote(recordType, recordId ?? '');
  const softDelete = useSoftDeleteLogEntry(recordType, recordId ?? '');

  const entries = q.data?.entries ?? [];
  const total = q.data?.total ?? 0;

  const filtered = useMemo(() => {
    const base = tab === 'note'
      ? entries.filter((e) => e.action_type === 'manual_note' || e.action_type !== 'manual_note') // show all, notes + system inline
      : tab === 'activity'
        ? entries.filter((e) => e.action_type !== 'manual_note')
        : []; // 'message' — future stub, show nothing until enabled
    const q2 = search.trim().toLowerCase();
    if (!q2) return base;
    return base.filter((e) => {
      const t = (e.note_text ?? '') + ' ' + (e.new_value ?? '') + ' ' + (e.old_value ?? '') + ' ' + (e.changed_by_name ?? '');
      return t.toLowerCase().includes(q2);
    });
  }, [entries, tab, search]);

  // Day grouping — newest day first, entries within a day newest-first.
  const grouped = useMemo(() => {
    const map = new Map<string, ActivityLogEntry[]>();
    for (const e of filtered) {
      const key = dayBucket(e.changed_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries()); // preserves insertion (which matches sort)
  }, [filtered]);

  const uploaderForRecord = async (file: File): Promise<RichAttachment> => {
    if (!recordId) throw new Error('No record id');
    const att = await uploadActivityAttachment(file, recordType, recordId);
    return {
      name: att.name,
      type: att.mime,
      size: att.size,
      url: att.url,
      // stash the storage path on the object so we can persist it later
      ...( { path: att.path } as any ),
    };
  };

  const handleSubmit = async (value: { html: string; mentions: string[]; attachments: RichAttachment[] }) => {
    if (!recordId) return;
    if (tab === 'message') {
      toast({ title: 'Messaging not yet enabled', description: 'This will send to the customer/team once configured.' });
      return;
    }
    try {
      await addNote.mutateAsync({
        note: value.html,
        attachments: value.attachments.map(toActivityAttachment),
        mentions: value.mentions,
        recordLabel,
      });
      if (value.mentions?.length) {
        toast({ title: 'Note logged', description: `Notified ${value.mentions.length} user${value.mentions.length === 1 ? '' : 's'}.` });
      }
    } catch (e: any) {
      toast({ title: 'Failed to add note', description: e?.message, variant: 'destructive' });
      throw e;
    }
  };

  const handleDelete = async (id: string) => {
    try { await softDelete.mutateAsync(id); }
    catch (e: any) {
      toast({ title: 'Failed to delete', description: e?.message, variant: 'destructive' });
    }
  };

  if (!recordId) return null;

  const mentionUsers = appUsers.map((u) => ({
    id: u.user_id,
    name: displayNameFor(u) || u.email,
    email: u.email,
  }));

  return (
    <div className={cn('flex flex-col bg-card border border-border rounded-lg overflow-hidden', className)}>
      {/* Tabs — pill style matching CRM Opportunity chatter */}
      <div className="flex items-center border-b border-border px-3 py-2 gap-1 flex-wrap sm:flex-nowrap">
        <Button
          variant={tab === 'message' ? 'default' : 'outline'}
          size="sm"
          className={cn(
            'h-8 px-3 text-xs font-medium',
            tab === 'message' && 'bg-[#875A7B] hover:bg-[#6e4a64] text-white',
          )}
          onClick={() => setTab('message')}
        >
          Send message
        </Button>
        <Button
          variant={tab === 'note' ? 'default' : 'outline'}
          size="sm"
          className={cn(
            'h-8 px-3 text-xs font-medium',
            tab === 'note' && 'bg-foreground text-background hover:bg-foreground/90',
          )}
          onClick={() => setTab('note')}
        >
          Log note
        </Button>
        <Button
          variant={tab === 'activity' ? 'default' : 'outline'}
          size="sm"
          className="h-8 px-3 text-xs font-medium"
          onClick={() => setTab('activity')}
        >
          Activity
        </Button>
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground p-1"
              onClick={() => { setShowSearch((s) => !s); setSearch(''); }}
              aria-label="Search"
            >
              <Search className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Search notes and activity</TooltipContent>
        </Tooltip>
        <span className="pr-1 text-xs text-muted-foreground tabular-nums">{total}</span>
      </div>

      {/* Composer */}
      {(tab === 'note' || tab === 'message') && (
        <div className="p-3 border-b border-border">
          <div className="flex gap-2.5">
            <ChatterAvatar name={user?.name || user?.email?.split('@')[0] || 'User'} />
            <div className="flex-1 min-w-0">
              <RichComposer
                compact
                placeholder={
                  tab === 'note'
                    ? 'Log an internal note… type @ to mention'
                    : 'Send a message… type @ to mention'
                }
                submitLabel={tab === 'note' ? 'Log' : 'Send'}
                users={mentionUsers}
                uploadFile={uploaderForRecord}
                onSubmit={handleSubmit}
                submitting={addNote.isPending}
              />
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      {showSearch && (
        <div className="px-3 py-2 border-b border-border">
          <Input
            autoFocus
            className="h-7 text-xs"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-3 py-3 max-h-[640px]">
        {q.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {tab === 'activity' ? 'No activity yet.' : tab === 'message' ? 'No messages yet.' : 'No notes yet.'}
          </p>
        ) : (
          grouped.map(([label, items]) => (
            <div key={label}>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">{label}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              {items.map((e) =>
                e.action_type === 'manual_note' ? (
                  <NoteRow
                    key={e.id}
                    entry={e}
                    canDelete={isSuperAdmin || e.changed_by === user?.id}
                    onDelete={handleDelete}
                    currentUserId={user?.id}
                    currentUserName={user?.name}
                  />
                ) : (
                  <SystemLine
                    key={e.id}
                    entry={e}
                    currentUserId={user?.id}
                    currentUserName={user?.name}
                  />
                ),
              )}
            </div>
          ))
        )}

        {entries.length < total && (
          <div className="flex justify-center pt-1">
            <Button
              variant="outline" size="sm"
              onClick={() => setLimit((n) => n + 20)}
              disabled={q.isFetching}
            >
              {q.isFetching ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ActivityChatter;