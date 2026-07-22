import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Lock, MessageCircle, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useChannels } from '@/hooks/chat';
import { useToast } from '@/hooks/use-toast';
import * as chat from '@/lib/services/chat/api';
import type { ActivityAttachment } from '@/lib/services/activityLog';

/**
 * Share an activity-log image/file into a chat channel.
 * Re-uploads the file into the chat-attachments bucket so the chat channel
 * can access it under its own storage RLS, then posts a rich chat message.
 */
export function ShareImageToChatDialog({
  open, onOpenChange, attachment,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  attachment: ActivityAttachment | null;
}) {
  const navigate = useNavigate();
  const { data: channels = [] } = useChannels();
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const filtered = channels.filter((c) =>
    c.name.toLowerCase().includes(filter.toLowerCase()),
  );

  const handleSend = async () => {
    if (!selectedId || !attachment) return;
    setBusy(true);
    try {
      const resp = await fetch(attachment.url);
      if (!resp.ok) throw new Error('Failed to fetch file for share');
      const blob = await resp.blob();
      const file = new File([blob], attachment.name, { type: attachment.mime });
      const uploaded = await chat.uploadAttachment(file, selectedId);
      await chat.sendMessageRich({
        channelId: selectedId,
        body: note.trim(),
        attachments: [uploaded],
      });
      toast({ title: 'Shared to chat' });
      onOpenChange(false);
      setNote(''); setSelectedId(null);
      navigate(`/chat/channels/${selectedId}`);
    } catch (e: any) {
      toast({ title: 'Failed to share', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Share via Chat</DialogTitle></DialogHeader>
        {attachment && (
          <div className="text-xs text-muted-foreground">
            Sharing: <span className="font-medium">{attachment.name}</span>
          </div>
        )}
        <Input
          placeholder="Filter conversations…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <ScrollArea className="h-60 border rounded-md">
          {filtered.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">No conversations</div>
          )}
          {filtered.map((c) => {
            const Icon = c.type === 'dm' ? MessageCircle
              : c.is_private ? Lock
              : c.type === 'group' ? Users : Hash;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted ${selectedId === c.id ? 'bg-muted' : ''}`}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{c.name.replace(/^#\s*/, '')}</span>
              </button>
            );
          })}
        </ScrollArea>
        <Textarea
          placeholder="Add a message (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={!selectedId || busy}>
            {busy ? 'Sharing…' : 'Send'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}