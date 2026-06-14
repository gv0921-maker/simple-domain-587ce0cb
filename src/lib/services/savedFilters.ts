import { supabase } from '@/integrations/supabase/client';
import type { FilterState } from '@/lib/filters/types';

export interface SavedFilter {
  id: string;
  user_id: string;
  module: string;
  name: string;
  filter_state: FilterState;
  is_default: boolean;
  is_system_default: boolean;
  created_at: string;
  updated_at: string;
}

export async function getSavedFilters(module: string): Promise<SavedFilter[]> {
  const { data, error } = await supabase
    .from('user_saved_filters')
    .select('*')
    .eq('module', module)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as SavedFilter[];
}

export async function getDefaultFilter(module: string): Promise<SavedFilter | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('user_saved_filters')
    .select('*')
    .eq('module', module);
  if (error) throw error;
  const all = (data ?? []) as unknown as SavedFilter[];
  return all.find(f => f.user_id === user.id && f.is_default)
    ?? all.find(f => f.is_system_default)
    ?? null;
}

export async function saveFilter(
  module: string, name: string, filter_state: FilterState,
  opts?: { is_default?: boolean; is_system_default?: boolean },
): Promise<SavedFilter> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('user_saved_filters')
    .insert({
      user_id: user.id, module, name,
      filter_state: filter_state as unknown as Record<string, unknown>,
      is_default: !!opts?.is_default,
      is_system_default: !!opts?.is_system_default,
    })
    .select('*').single();
  if (error) throw error;
  if (opts?.is_default && data) await setUserDefault(module, data.id);
  if (opts?.is_system_default && data) await setSystemDefault(module, data.id);
  return data as unknown as SavedFilter;
}

export async function updateFilter(
  id: string,
  patch: Partial<Pick<SavedFilter, 'name' | 'filter_state' | 'is_default' | 'is_system_default'>>,
): Promise<void> {
  const updates: Record<string, unknown> = { ...patch };
  if (patch.filter_state) updates.filter_state = patch.filter_state as unknown as Record<string, unknown>;
  const { error } = await supabase.from('user_saved_filters').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteFilter(id: string): Promise<void> {
  const { error } = await supabase.from('user_saved_filters').delete().eq('id', id);
  if (error) throw error;
}

export async function setUserDefault(module: string, filterId: string): Promise<void> {
  const { error } = await supabase.rpc('set_user_default_filter', { p_module: module, p_filter_id: filterId });
  if (error) throw error;
}

export async function setSystemDefault(module: string, filterId: string): Promise<void> {
  const { error } = await supabase.rpc('set_system_default_filter', { p_module: module, p_filter_id: filterId });
  if (error) throw error;
}
