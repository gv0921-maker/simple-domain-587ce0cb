import { useEffect, useMemo, useRef } from 'react';
import { useMessages, useMarkChannelRead, useDirectory } from '@/hooks/chat';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

function initials(name: string) {
  return name.split(' ').map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MessageList({ channelId }: { channelId: string }) {
  const { user } = useAuth();
  const { data: messages = [], isLoading } = useMessages(channelId);
  const { data: directory = [] } = useDirectory();
  const markRead = useMarkChannelRead();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (channelId) markRead.mutate(channelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, messages.length]);

  const dirMap = useMemo(() => {
    const m = new Map<string, string>();
    directory.forEach((d) => m.set(d.user_id, d.name));
    return m;
  }, [directory]);

  type Group = { user_id: string | null; created_at: string; messages: typeof messages };
  const groups = useMemo<Group[]>(() => {
    const out: Group[] = [];
    for (const msg of messages) {
      const last = out[out.length - 1];
      if (last && last.user_id === msg.user_id &&
          new Date(msg.created_at).getTime() - new Date(last.created_at).getTime() < 5 * 60_000) {
        last.messages.push(msg);
      } else {
        out.push({ user_id: msg.user_id, created_at: msg.created_at, messages: [msg] });
      }
    }
    return out;
  }, [messages]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {groups.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-12">No messages yet. Say hello 👋</div>
      )}
      {groups.map((g, gi) => {
        const mine = g.user_id === user?.id;
        const name = g.user_id ? dirMap.get(g.user_id) ?? 'User' : 'System';
        return (
          <div key={gi} className={cn('flex gap-3', mine && 'flex-row-reverse')}>
            <Avatar className="h-8 w-8 flex-shrink-0">
              <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
            </Avatar>
            <div className={cn('flex-1 min-w-0', mine && 'flex flex-col items-end')}>
              <div className={cn('flex items-baseline gap-2 mb-1', mine && 'flex-row-reverse')}>
                <span className="text-sm font-medium">{mine ? 'You' : name}</span>
                <span className="text-[11px] text-muted-foreground">{formatTime(g.created_at)}</span>
              </div>
              <div className="space-y-1 max-w-[75%]">
                {g.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      'rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words',
                      mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
                      m.is_deleted && 'italic opacity-60'
                    )}
                  >
                    {m.is_deleted ? 'Message deleted' : m.body}
                    {m.is_edited && !m.is_deleted && (
                      <span className={cn('ml-2 text-[10px]', mine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                        (edited)
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}