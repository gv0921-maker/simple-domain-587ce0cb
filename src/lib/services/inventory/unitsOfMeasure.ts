import { supabase } from '@/integrations/supabase/client';

export type UomType = 'unit' | 'reference' | 'bigger' | 'smaller';

export interface UnitOfMeasure {
  id: string;
  name: string;
  abbreviation: string;
  uomType: UomType;
  ratio: number;
  isActive: boolean;
}

const map = (r: any): UnitOfMeasure => ({
  id: r.id,
  name: r.name,
  abbreviation: r.abbreviation,
  uomType: (r.uom_type ?? 'unit') as UomType,
  ratio: Number(r.ratio ?? 1),
  isActive: !!r.is_active,
});

export async function listUnitsOfMeasure(): Promise<UnitOfMeasure[]> {
  const { data, error } = await supabase.from('units_of_measure' as any).select('*').order('name');
  if (error) throw error;
  return (data ?? []).map(map);
}

export async function saveUnitOfMeasure(input: Partial<UnitOfMeasure> & { name: string; abbreviation: string }): Promise<UnitOfMeasure> {
  const payload: any = {
    name: input.name,
    abbreviation: input.abbreviation,
    uom_type: input.uomType ?? 'unit',
    ratio: input.ratio ?? 1,
    is_active: input.isActive ?? true,
  };
  if (input.id) {
    const { data, error } = await supabase.from('units_of_measure' as any).update(payload).eq('id', input.id).select('*').single();
    if (error) throw error;
    return map(data);
  }
  const { data, error } = await supabase.from('units_of_measure' as any).insert(payload).select('*').single();
  if (error) throw error;
  return map(data);
}

export async function deleteUnitOfMeasure(id: string): Promise<void> {
  const { error } = await supabase.from('units_of_measure' as any).delete().eq('id', id);
  if (error) throw error;
}