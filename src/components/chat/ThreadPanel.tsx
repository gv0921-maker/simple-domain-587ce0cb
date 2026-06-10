import { useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  useMessages, useThreadReplies, useDirectory, useMessageAttachments,
} from '@/hooks/chat';
import { MessageBody } from './MessageBody';
import { AttachmentList } from './AttachmentList';
import { MessageComposer } from './MessageComposer';
import { cn } from '@/lib/utils';

function initials(name: string) {
  return name.split(' ').map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
}

export function ThreadPanel({
  channelId, parentMessageId, onClose,
}: { channelId: string; parentMessageId: string; onClose: () => void }) {
  const { data: channelMessages = [] } = useMessages(channelId);
  const parent = channelMessages.find((m) => m.id === parentMessageId);
  const { data: replies = [] } = useThreadReplies(parentMessageId);
  const { data: directory = [] } = useDirectory();

  const ids = useMemo(() => [parentMessageId, ...replies.map((r) => r.id)], [parentMessageId, replies]);
  const { data: atts = {} } = useMessageAttachments(channelId, ids);

  const nameOf = (uid: string | null) =>
    uid ? directory.find((d) => d.user_id === uid)?.name ?? 'User' : 'System';

  return (
    <aside className="w-full md:w-[420px] border-l bg-background flex flex-col h-full">
      <header className="h-14 border-b px-4 flex items-center justify-between flex-shrink-0">
        <div>
          <div className="font-semibold text-sm">Thread</div>
          <div className="text-xs text-muted-foreground">
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {parent && (
            <ThreadMessage msg={parent} name={nameOf(parent.user_id)} atts={atts[parent.id] ?? []} />
          )}
          {replies.length > 0 && (
            <div className="border-t pt-3 space-y-3">
              {replies.map((r) => (
                <ThreadMessage key={r.id} msg={r} name={nameOf(r.user_id)} atts={atts[r.id] ?? []} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <MessageComposer
        channelId={channelId}
        parentMessageId={parentMessageId}
        placeholder="Reply in thread…"
        autoFocus
      />
    </aside>
  );

  function ThreadMessage({ msg, name, atts }: { msg: any; name: string; atts: any[] }) {
    return (
      <div className="flex gap-3">
        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-sm font-medium">{name}</span>
            <span className="text-[11px] text-muted-foreground">{formatTime(msg.created_at)}</span>
          </div>
          <div className={cn('text-sm', msg.is_deleted && 'italic opacity-60')}>
            {msg.is_deleted ? 'Message deleted' : <MessageBody body={msg.body} />}
          </div>
          {atts.length > 0 && <AttachmentList items={atts} />}
        </div>
      </div>
    );
  }
}