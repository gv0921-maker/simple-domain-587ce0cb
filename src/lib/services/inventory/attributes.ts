import { supabase } from '@/integrations/supabase/client';

export type AttributeDisplayType = 'radio' | 'select' | 'color' | 'pills';

export interface ProductAttribute {
  id: string;
  name: string;
  displayType: AttributeDisplayType;
  isActive: boolean;
  sortOrder: number;
  values?: ProductAttributeValue[];
}

export interface ProductAttributeValue {
  id: string;
  attributeId: string;
  value: string;
  extraPrice: number;
  colorHex?: string | null;
  sortOrder: number;
}

export interface ProductAttributeAssignment {
  id: string;
  productId: string;
  attributeId: string;
}

const mapAttr = (r: any): ProductAttribute => ({
  id: r.id,
  name: r.name,
  displayType: (r.display_type ?? 'radio') as AttributeDisplayType,
  isActive: !!r.is_active,
  sortOrder: Number(r.sort_order ?? 0),
});

const mapVal = (r: any): ProductAttributeValue => ({
  id: r.id,
  attributeId: r.attribute_id,
  value: r.value,
  extraPrice: Number(r.extra_price ?? 0),
  colorHex: r.color_hex ?? null,
  sortOrder: Number(r.sort_order ?? 0),
});

export async function listAttributes(): Promise<ProductAttribute[]> {
  const [{ data: attrs, error: e1 }, { data: vals, error: e2 }] = await Promise.all([
    supabase.from('product_attributes' as any).select('*').order('sort_order').order('name'),
    supabase.from('product_attribute_values' as any).select('*').order('sort_order').order('value'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const valuesByAttr = new Map<string, ProductAttributeValue[]>();
  (vals ?? []).forEach((v: any) => {
    const arr = valuesByAttr.get(v.attribute_id) ?? [];
    arr.push(mapVal(v));
    valuesByAttr.set(v.attribute_id, arr);
  });
  return (attrs ?? []).map((a: any) => ({ ...mapAttr(a), values: valuesByAttr.get(a.id) ?? [] }));
}

export async function saveAttribute(input: Partial<ProductAttribute> & { name: string }): Promise<ProductAttribute> {
  const payload: any = {
    name: input.name,
    display_type: input.displayType ?? 'radio',
    is_active: input.isActive ?? true,
    sort_order: input.sortOrder ?? 0,
  };
  if (input.id) {
    const { data, error } = await supabase.from('product_attributes' as any).update(payload).eq('id', input.id).select('*').single();
    if (error) throw error;
    return mapAttr(data);
  }
  const { data, error } = await supabase.from('product_attributes' as any).insert(payload).select('*').single();
  if (error) throw error;
  return mapAttr(data);
}

export async function deleteAttribute(id: string): Promise<void> {
  const { error } = await supabase.from('product_attributes' as any).delete().eq('id', id);
  if (error) throw error;
}

export async function saveAttributeValue(input: Partial<ProductAttributeValue> & { attributeId: string; value: string }): Promise<ProductAttributeValue> {
  const payload: any = {
    attribute_id: input.attributeId,
    value: input.value,
    extra_price: input.extraPrice ?? 0,
    color_hex: input.colorHex ?? null,
    sort_order: input.sortOrder ?? 0,
  };
  if (input.id) {
    const { data, error } = await supabase.from('product_attribute_values' as any).update(payload).eq('id', input.id).select('*').single();
    if (error) throw error;
    return mapVal(data);
  }
  const { data, error } = await supabase.from('product_attribute_values' as any).insert(payload).select('*').single();
  if (error) throw error;
  return mapVal(data);
}

export async function deleteAttributeValue(id: string): Promise<void> {
  const { error } = await supabase.from('product_attribute_values' as any).delete().eq('id', id);
  if (error) throw error;
}

export async function listAssignmentsForProduct(productId: string): Promise<ProductAttributeAssignment[]> {
  const { data, error } = await supabase
    .from('product_attribute_assignments' as any)
    .select('*')
    .eq('product_id', productId);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, productId: r.product_id, attributeId: r.attribute_id }));
}

export async function setAssignmentsForProduct(productId: string, attributeIds: string[]): Promise<void> {
  const { error: delErr } = await supabase
    .from('product_attribute_assignments' as any)
    .delete()
    .eq('product_id', productId);
  if (delErr) throw delErr;
  if (attributeIds.length === 0) return;
  const rows = attributeIds.map((aid) => ({ product_id: productId, attribute_id: aid }));
  const { error } = await supabase.from('product_attribute_assignments' as any).insert(rows);
  if (error) throw error;
}

/** Fetch the attributes assigned to a product with their values. */
export async function listAttributesForProduct(productId: string): Promise<ProductAttribute[]> {
  const assigns = await listAssignmentsForProduct(productId);
  if (assigns.length === 0) return [];
  const ids = assigns.map((a) => a.attributeId);
  const [{ data: attrs, error: e1 }, { data: vals, error: e2 }] = await Promise.all([
    supabase.from('product_attributes' as any).select('*').in('id', ids).eq('is_active', true).order('sort_order'),
    supabase.from('product_attribute_values' as any).select('*').in('attribute_id', ids).order('sort_order'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const byAttr = new Map<string, ProductAttributeValue[]>();
  (vals ?? []).forEach((v: any) => {
    const arr = byAttr.get(v.attribute_id) ?? [];
    arr.push(mapVal(v));
    byAttr.set(v.attribute_id, arr);
  });
  return (attrs ?? []).map((a: any) => ({ ...mapAttr(a), values: byAttr.get(a.id) ?? [] }));
}