import { supabase } from '@/integrations/supabase/client';

export interface ProductCategory {
  id: string;
  name: string;
  parentCategoryId?: string | null;
  description?: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

const map = (r: any): ProductCategory => ({
  id: r.id,
  name: r.name,
  parentCategoryId: r.parent_category_id ?? null,
  description: r.description ?? null,
  isActive: !!r.is_active,
  sortOrder: Number(r.sort_order ?? 0),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listCategories(): Promise<ProductCategory[]> {
  const { data, error } = await supabase
    .from('product_categories' as any)
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(map);
}

export async function saveCategory(input: Partial<ProductCategory> & { name: string }): Promise<ProductCategory> {
  const payload: any = {
    name: input.name,
    parent_category_id: input.parentCategoryId ?? null,
    description: input.description ?? null,
    is_active: input.isActive ?? true,
    sort_order: input.sortOrder ?? 0,
  };
  if (input.id) {
    const { data, error } = await supabase.from('product_categories' as any).update(payload).eq('id', input.id).select('*').single();
    if (error) throw error;
    return map(data);
  }
  const { data, error } = await supabase.from('product_categories' as any).insert(payload).select('*').single();
  if (error) throw error;
  return map(data);
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('product_categories' as any).delete().eq('id', id);
  if (error) throw error;
}