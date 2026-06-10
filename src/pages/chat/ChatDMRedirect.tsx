import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { findOrCreateDM } from '@/lib/services/chat/api';
import { useToast } from '@/hooks/use-toast';

export default function ChatDMRedirect() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!userId) return;
    findOrCreateDM(userId)
      .then((ch) => navigate(`/chat/channels/${ch.id}`, { replace: true }))
      .catch((e) => {
        toast({ title: 'Failed to open DM', description: e?.message });
        navigate('/chat', { replace: true });
      });
  }, [userId, navigate, toast]);

  return <div className="p-6 text-sm text-muted-foreground">Opening conversation…</div>;
}