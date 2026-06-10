import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useChannel, useChannelMembers, useDirectory, chatKeys } from '@/hooks/chat';
import { addChannelMember, removeChannelMember } from '@/lib/services/chat/api';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Trash2, UserPlus } from 'lucide-react';

export function ChannelSettingsDialog({
  channelId, open, onOpenChange,
}: { channelId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: channel } = useChannel(channelId);
  const { data: members = [] } = useChannelMembers(channelId);
  const { data: directory = [] } = useDirectory();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (channel) {
      setName(channel.name);
      setDescription(channel.description ?? '');
    }
  }, [channel]);

  if (!channel) return null;

  const myMembership = members.find((m) => m.user_id === user?.id);
  const isAdmin = myMembership?.role === 'owner' || myMembership?.role === 'admin';
  const nameMap = new Map(directory.map((d) => [d.user_id, d.name]));
  const nonMembers = directory.filter((d) => !members.find((m) => m.user_id === d.user_id));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: chatKeys.members(channelId) });
    qc.invalidateQueries({ queryKey: chatKeys.channel(channelId) });
    qc.invalidateQueries({ queryKey: chatKeys.channels() });
  };

  const saveDetails = async () => {
    const { error } = await supabase
      .from('chat_channels')
      .update({ name: name.trim(), description: description.trim() || null })
      .eq('id', channelId);
    if (error) return toast({ title: 'Failed', description: error.message });
    toast({ title: 'Saved' });
    invalidate();
  };

  const archive = async () => {
    const { error } = await supabase
      .from('chat_channels').update({ is_archived: true }).eq('id', channelId);
    if (error) return toast({ title: 'Failed', description: error.message });
    onOpenChange(false);
    navigate('/chat');
    invalidate();
  };

  const leave = async () => {
    if (!user) return;
    try {
      await removeChannelMember(channelId, user.id);
      onOpenChange(false);
      navigate('/chat');
      invalidate();
    } catch (e: any) {
      toast({ title: 'Failed', description: e?.message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Channel settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!isAdmin} />
          </div>
          {isAdmin && <Button size="sm" onClick={saveDetails}>Save details</Button>}

          <div>
            <Label>Members ({members.length})</Label>
            <ScrollArea className="h-40 mt-1 border rounded-md">
              <div className="p-2 space-y-1">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-sm">
                      {nameMap.get(m.user_id) ?? 'User'}{' '}
                      <span className="text-xs text-muted-foreground">({m.role})</span>
                    </span>
                    {isAdmin && m.user_id !== user?.id && (
                      <Button variant="ghost" size="icon" onClick={async () => {
                        await removeChannelMember(channelId, m.user_id);
                        invalidate();
                      }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {isAdmin && nonMembers.length > 0 && (
            <div>
              <Label>Add member</Label>
              <ScrollArea className="h-32 mt-1 border rounded-md">
                <div className="p-2 space-y-1">
                  {nonMembers.map((d) => (
                    <div key={d.user_id} className="flex items-center justify-between px-2 py-1.5">
                      <span className="text-sm">{d.name}</span>
                      <Button variant="ghost" size="icon" onClick={async () => {
                        await addChannelMember(channelId, d.user_id);
                        invalidate();
                      }}>
                        <UserPlus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 flex-wrap">
          {isAdmin && channel.type !== 'dm' && (
            <Button variant="outline" onClick={archive}>Archive channel</Button>
          )}
          {channel.type !== 'dm' && (
            <Button variant="destructive" onClick={leave}>Leave</Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}