// Hook to list app users (auth users + their roles) via the
// `list-app-users` edge function. Used to populate user pickers
// such as Opportunity "User Responsible".
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AppUserLite {
  user_id: string;
  email: string;
  name?: string;
  roles?: { id: string; name: string }[];
}

async function fetchAppUsers(): Promise<AppUserLite[]> {
  const { data, error } = await supabase.functions.invoke('list-app-users', { method: 'GET' });
  if (error) throw error;
  const list = (data as any)?.users;
  if (!Array.isArray(list)) return [];
  return list.map((u: any) => ({
    user_id: u.user_id,
    email: u.email,
    name: u.name || u.full_name || u.user_metadata?.name || u.user_metadata?.full_name,
    roles: u.roles,
  }));
}

export function useAppUsers() {
  return useQuery({
    queryKey: ['app-users-lite'],
    queryFn: fetchAppUsers,
    staleTime: 5 * 60 * 1000,
  });
}

export function displayNameFor(u: AppUserLite | undefined): string {
  if (!u) return '';
  return u.name?.trim() || u.email?.split('@')[0] || u.email || '';
}
