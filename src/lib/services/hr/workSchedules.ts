import { supabase } from '@/integrations/supabase/client';

const sb = supabase as any;

export interface EmployeeWorkSchedule {
  id: string;
  employee_id: string;
  work_start_time: string; // 'HH:MM:SS'
  work_end_time: string;
  total_work_hours: number;
  break_minutes_allotted: number;
  working_days: number[]; // 0..6 (Sun..Sat)
  late_threshold_minutes: number;
  effective_from: string; // date
  effective_until: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeWithSchedule {
  id: string;
  full_name: string;
  employee_code: string | null;
  designation: string | null;
  status: string | null;
  schedule: EmployeeWorkSchedule | null;
}

export interface ScheduleTemplate {
  work_start_time: string;
  work_end_time: string;
  total_work_hours: number;
  break_minutes_allotted: number;
  working_days: number[];
  late_threshold_minutes: number;
  notes?: string | null;
}

export interface AttendanceMetrics {
  employee_id: string;
  date: string;
  work_minutes_total: number;
  break_minutes_total: number;
  expected_work_minutes: number;
  late_arrival_minutes: number;
  early_departure_minutes: number;
  overtime_minutes: number;
  break_overrun_minutes: number;
  is_working_day: boolean;
  schedule_id: string | null;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Currently effective schedule for an employee (or null). */
export async function getEmployeeWorkSchedule(
  employeeId: string,
  onDate: string = todayISO(),
): Promise<EmployeeWorkSchedule | null> {
  const { data, error } = await sb
    .from('employee_work_schedules')
    .select('*')
    .eq('employee_id', employeeId)
    .lte('effective_from', onDate)
    .or(`effective_until.is.null,effective_until.gte.${onDate}`)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as EmployeeWorkSchedule | null;
}

/** All employees joined with their current effective schedule (admin view). */
export async function getAllEmployeeSchedules(): Promise<EmployeeWithSchedule[]> {
  const today = todayISO();
  const { data: emps, error: e1 } = await sb
    .from('employees')
    .select('id, full_name, employee_code, designation, status')
    .neq('status', 'terminated')
    .order('full_name', { ascending: true });
  if (e1) throw e1;

  const { data: schedules, error: e2 } = await sb
    .from('employee_work_schedules')
    .select('*')
    .lte('effective_from', today)
    .or(`effective_until.is.null,effective_until.gte.${today}`);
  if (e2) throw e2;

  const byEmp: Record<string, EmployeeWorkSchedule> = {};
  for (const s of (schedules ?? []) as EmployeeWorkSchedule[]) {
    const existing = byEmp[s.employee_id];
    if (!existing || s.effective_from > existing.effective_from) byEmp[s.employee_id] = s;
  }

  return ((emps ?? []) as any[]).map((e) => ({
    id: e.id,
    full_name: e.full_name,
    employee_code: e.employee_code,
    designation: e.designation,
    status: e.status,
    schedule: byEmp[e.id] ?? null,
  }));
}

/** Full history of schedules for one employee, newest first. */
export async function getEmployeeScheduleHistory(employeeId: string): Promise<EmployeeWorkSchedule[]> {
  const { data, error } = await sb
    .from('employee_work_schedules')
    .select('*')
    .eq('employee_id', employeeId)
    .order('effective_from', { ascending: false });
  if (error) throw error;
  return (data ?? []) as EmployeeWorkSchedule[];
}

/**
 * Set the active schedule for an employee.
 * Closes any open (effective_until=null) row by setting it to yesterday, then inserts new.
 * Super admin only (enforced by RLS).
 */
export async function setEmployeeWorkSchedule(
  employeeId: string,
  schedule: ScheduleTemplate & { effective_from?: string },
): Promise<EmployeeWorkSchedule> {
  const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
  const effFrom = schedule.effective_from ?? todayISO();

  // Close any open row by setting effective_until to the day before new effective_from
  const closeDate = new Date(effFrom);
  closeDate.setDate(closeDate.getDate() - 1);
  const closeISO = closeDate.toISOString().slice(0, 10);

  const { error: closeErr } = await sb
    .from('employee_work_schedules')
    .update({ effective_until: closeISO })
    .eq('employee_id', employeeId)
    .is('effective_until', null);
  if (closeErr) throw closeErr;

  const { data, error } = await sb
    .from('employee_work_schedules')
    .insert({
      employee_id: employeeId,
      work_start_time: schedule.work_start_time,
      work_end_time: schedule.work_end_time,
      total_work_hours: schedule.total_work_hours,
      break_minutes_allotted: schedule.break_minutes_allotted,
      working_days: schedule.working_days,
      late_threshold_minutes: schedule.late_threshold_minutes,
      effective_from: effFrom,
      notes: schedule.notes ?? null,
      created_by: uid,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as EmployeeWorkSchedule;
}

/** Apply the same schedule template to many employees. Super admin only. */
export async function bulkUpdateSchedules(
  employeeIds: string[],
  template: ScheduleTemplate & { effective_from?: string },
): Promise<EmployeeWorkSchedule[]> {
  const out: EmployeeWorkSchedule[] = [];
  for (const id of employeeIds) {
    out.push(await setEmployeeWorkSchedule(id, template));
  }
  return out;
}

/** Manually trigger metric calculation for one (employee, date). */
export async function recalculateAttendanceMetrics(
  employeeId: string,
  date: string,
): Promise<AttendanceMetrics> {
  const { data, error } = await sb.rpc('calculate_attendance_metrics', {
    p_employee_id: employeeId,
    p_date: date,
  });
  if (error) throw error;
  return data as AttendanceMetrics;
}

/** Bulk recalc for a set of (employee, date) pairs. */
export async function bulkRecalculateMetrics(
  pairs: Array<{ employeeId: string; date: string }>,
): Promise<number> {
  let n = 0;
  for (const p of pairs) {
    try {
      await recalculateAttendanceMetrics(p.employeeId, p.date);
      n++;
    } catch { /* skip */ }
  }
  return n;
}

/** Current user's today attendance (RLS scopes to self+today for regular users). */
export async function getMyTodayAttendance(employeeId: string) {
  const { data, error } = await sb
    .from('attendance_sessions')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('session_date', todayISO())
    .order('check_in_time', { ascending: true });
  if (error) throw error;
  return (data ?? []) as any[];
}