import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type AppraisalCycle = Database['public']['Tables']['appraisal_cycles']['Row'];
export type AppraisalCycleInsert = Database['public']['Tables']['appraisal_cycles']['Insert'];
export type AppraisalCycleUpdate = Database['public']['Tables']['appraisal_cycles']['Update'];

export type AppraisalTemplate = Database['public']['Tables']['appraisal_templates']['Row'];
export type AppraisalTemplateInsert = Database['public']['Tables']['appraisal_templates']['Insert'];

export type AppraisalCriterion = Database['public']['Tables']['appraisal_criteria']['Row'];
export type AppraisalCriterionInsert = Database['public']['Tables']['appraisal_criteria']['Insert'];

export type Appraisal = Database['public']['Tables']['appraisals']['Row'];
export type AppraisalInsert = Database['public']['Tables']['appraisals']['Insert'];
export type AppraisalUpdate = Database['public']['Tables']['appraisals']['Update'];

export type AppraisalRating = Database['public']['Tables']['appraisal_ratings']['Row'];
export type AppraisalRatingInsert = Database['public']['Tables']['appraisal_ratings']['Insert'];

export type AppraisalGoal = Database['public']['Tables']['appraisal_goals']['Row'];
export type AppraisalGoalInsert = Database['public']['Tables']['appraisal_goals']['Insert'];

// ---------- Cycles ----------
export async function listAppraisalCycles(): Promise<AppraisalCycle[]> {
  const { data, error } = await supabase
    .from('appraisal_cycles').select('*').order('period_start_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
export async function getAppraisalCycle(id: string) {
  const { data, error } = await supabase.from('appraisal_cycles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
export async function createAppraisalCycle(p: AppraisalCycleInsert) {
  const { data, error } = await supabase.from('appraisal_cycles').insert(p).select().single();
  if (error) throw error;
  return data;
}
export async function updateAppraisalCycle(id: string, p: AppraisalCycleUpdate) {
  const { data, error } = await supabase.from('appraisal_cycles').update(p).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
export async function deleteAppraisalCycle(id: string) {
  const { error } = await supabase.from('appraisal_cycles').delete().eq('id', id);
  if (error) throw error;
}

/** Launch cycle: create appraisal rows for every active employee using default template */
export async function launchAppraisalCycle(cycleId: string): Promise<number> {
  const { data: tpls, error: te } = await supabase
    .from('appraisal_templates').select('id, name').eq('is_active', true);
  if (te) throw te;
  const tpl = tpls?.find((t) => t.name === 'Standard Annual Review') ?? tpls?.[0];
  if (!tpl) throw new Error('No active template');
  const { data: emps, error: ee } = await supabase
    .from('employees').select('id, reports_to').eq('status', 'active');
  if (ee) throw ee;
  if (!emps?.length) return 0;
  const rows: AppraisalInsert[] = emps.map((e) => ({
    appraisal_cycle_id: cycleId,
    employee_id: e.id,
    template_id: tpl.id,
    reviewer_id: e.reports_to ?? null,
    status: 'self_review',
  }));
  // upsert via insert ignoring conflicts
  const { error } = await supabase.from('appraisals').upsert(rows, {
    onConflict: 'appraisal_cycle_id,employee_id', ignoreDuplicates: true,
  });
  if (error) throw error;
  // pre-create rating rows
  const { data: crit } = await supabase.from('appraisal_criteria').select('id').eq('template_id', tpl.id);
  const { data: createdAppraisals } = await supabase
    .from('appraisals').select('id').eq('appraisal_cycle_id', cycleId);
  if (crit?.length && createdAppraisals?.length) {
    const ratings: AppraisalRatingInsert[] = [];
    for (const a of createdAppraisals) {
      for (const c of crit) ratings.push({ appraisal_id: a.id, criterion_id: c.id });
    }
    await supabase.from('appraisal_ratings').upsert(ratings, {
      onConflict: 'appraisal_id,criterion_id', ignoreDuplicates: true,
    });
  }
  await supabase.from('appraisal_cycles').update({ status: 'in_progress' }).eq('id', cycleId);
  return emps.length;
}

// ---------- Templates & Criteria ----------
export async function listTemplates() {
  const { data, error } = await supabase
    .from('appraisal_templates').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}
export async function createTemplate(p: AppraisalTemplateInsert) {
  const { data, error } = await supabase.from('appraisal_templates').insert(p).select().single();
  if (error) throw error;
  return data;
}
export async function updateTemplate(id: string, p: Partial<AppraisalTemplate>) {
  const { data, error } = await supabase.from('appraisal_templates').update(p).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
export async function deleteTemplate(id: string) {
  const { error } = await supabase.from('appraisal_templates').delete().eq('id', id);
  if (error) throw error;
}
export async function listCriteria(templateId: string) {
  const { data, error } = await supabase
    .from('appraisal_criteria').select('*').eq('template_id', templateId)
    .order('display_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
export async function createCriterion(p: AppraisalCriterionInsert) {
  const { data, error } = await supabase.from('appraisal_criteria').insert(p).select().single();
  if (error) throw error;
  return data;
}
export async function updateCriterion(id: string, p: Partial<AppraisalCriterion>) {
  const { data, error } = await supabase.from('appraisal_criteria').update(p).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
export async function deleteCriterion(id: string) {
  const { error } = await supabase.from('appraisal_criteria').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Appraisals ----------
export async function listAppraisalsByCycle(cycleId: string) {
  const { data, error } = await supabase
    .from('appraisals').select('*, employees:employee_id(full_name, employee_code, department_id), reviewer:reviewer_id(full_name)')
    .eq('appraisal_cycle_id', cycleId);
  if (error) throw error;
  return data ?? [];
}
export async function listAppraisalsForEmployee(employeeId: string) {
  const { data, error } = await supabase
    .from('appraisals').select('*, appraisal_cycles:appraisal_cycle_id(name, cycle_type, period_start_date, period_end_date)')
    .eq('employee_id', employeeId).order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
export async function listAppraisalsForReviewer(reviewerId: string) {
  const { data, error } = await supabase
    .from('appraisals').select('*, employees:employee_id(full_name, employee_code), appraisal_cycles:appraisal_cycle_id(name)')
    .eq('reviewer_id', reviewerId).order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
export async function getAppraisal(id: string) {
  const { data, error } = await supabase
    .from('appraisals')
    .select('*, employees:employee_id(full_name, employee_code, designation), reviewer:reviewer_id(full_name), appraisal_cycles:appraisal_cycle_id(name, cycle_type, period_start_date, period_end_date)')
    .eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
export async function updateAppraisal(id: string, p: AppraisalUpdate) {
  const { data, error } = await supabase.from('appraisals').update(p).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ---------- Ratings ----------
export async function listRatings(appraisalId: string) {
  const { data, error } = await supabase
    .from('appraisal_ratings')
    .select('*, appraisal_criteria:criterion_id(criterion_name, category, weightage_percentage, rating_scale, display_order)')
    .eq('appraisal_id', appraisalId);
  if (error) throw error;
  return (data ?? []).sort((a: any, b: any) =>
    (a.appraisal_criteria?.display_order ?? 0) - (b.appraisal_criteria?.display_order ?? 0));
}
export async function upsertRating(p: AppraisalRatingInsert & { id?: string }) {
  const { data, error } = await supabase.from('appraisal_ratings').upsert(p, {
    onConflict: 'appraisal_id,criterion_id',
  }).select().single();
  if (error) throw error;
  return data;
}

// ---------- Goals ----------
export async function listGoals(appraisalId: string) {
  const { data, error } = await supabase.from('appraisal_goals').select('*')
    .eq('appraisal_id', appraisalId).order('created_at');
  if (error) throw error;
  return data ?? [];
}
export async function createGoal(p: AppraisalGoalInsert) {
  const { data, error } = await supabase.from('appraisal_goals').insert(p).select().single();
  if (error) throw error;
  return data;
}
export async function updateGoal(id: string, p: Partial<AppraisalGoal>) {
  const { data, error } = await supabase.from('appraisal_goals').update(p).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
export async function deleteGoal(id: string) {
  const { error } = await supabase.from('appraisal_goals').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Workflow ----------
export async function calculateOverallRating(appraisalId: string): Promise<{ self: number; manager: number; final: number }> {
  const rs = await listRatings(appraisalId);
  const total = (key: 'self_rating' | 'manager_rating' | 'final_rating') => {
    let sum = 0, wsum = 0;
    for (const r of rs as any[]) {
      const w = Number(r.appraisal_criteria?.weightage_percentage ?? 0);
      const v = Number(r[key] ?? 0);
      if (r[key] != null) { sum += v * w; wsum += w; }
    }
    return wsum > 0 ? +(sum / wsum).toFixed(2) : 0;
  };
  return { self: total('self_rating'), manager: total('manager_rating'), final: total('final_rating') };
}

export async function submitSelfReview(appraisalId: string) {
  const r = await calculateOverallRating(appraisalId);
  return updateAppraisal(appraisalId, {
    status: 'manager_review',
    self_review_submitted_at: new Date().toISOString(),
    self_overall_rating: r.self,
  });
}
export async function submitManagerReview(appraisalId: string) {
  const r = await calculateOverallRating(appraisalId);
  return updateAppraisal(appraisalId, {
    status: 'hr_review',
    manager_review_submitted_at: new Date().toISOString(),
    manager_overall_rating: r.manager,
  });
}
export async function finalizeAppraisal(appraisalId: string) {
  const r = await calculateOverallRating(appraisalId);
  return updateAppraisal(appraisalId, {
    status: 'completed',
    hr_finalized_at: new Date().toISOString(),
    final_overall_rating: r.final,
  });
}
export async function acknowledgeAppraisal(appraisalId: string, response?: string) {
  return updateAppraisal(appraisalId, {
    employee_acknowledgement: true,
    employee_acknowledged_at: new Date().toISOString(),
    employee_response: response ?? null,
    status: 'closed',
  });
}

export async function getAppraisalStatistics(cycleId: string) {
  const list = await listAppraisalsByCycle(cycleId);
  const total = list.length;
  const by = (s: string) => list.filter((a: any) => a.status === s).length;
  return {
    total,
    not_started: by('not_started'),
    self_review: by('self_review'),
    manager_review: by('manager_review'),
    hr_review: by('hr_review'),
    completed: by('completed'),
    closed: by('closed'),
  };
}

/** Pending increment recommendations across cycles (for payroll integration) */
export async function listPendingIncrements() {
  const { data, error } = await supabase
    .from('appraisals')
    .select('id, employee_id, final_overall_rating, recommendation, increment_percentage_recommended, hr_finalized_at, employees:employee_id(full_name, employee_code)')
    .in('recommendation', ['increment', 'promote'])
    .not('hr_finalized_at', 'is', null)
    .order('hr_finalized_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}