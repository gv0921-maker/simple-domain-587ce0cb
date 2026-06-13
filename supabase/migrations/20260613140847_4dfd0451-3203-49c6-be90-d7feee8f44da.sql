
-- ============================================================
-- Phase 7 Batch 1 — Attendance tweaks
-- ============================================================

-- ---------- 1. is_admin_or_hr() helper ----------
CREATE OR REPLACE FUNCTION public.is_admin_or_hr()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_any_role(
    auth.uid(),
    ARRAY['super_admin','admin','hr_manager']::public.app_role[]
  );
$$;

-- ---------- 2. employee_work_schedules table ----------
CREATE TABLE IF NOT EXISTS public.employee_work_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_start_time time NOT NULL DEFAULT '09:00:00',
  work_end_time time NOT NULL DEFAULT '18:00:00',
  total_work_hours numeric NOT NULL DEFAULT 8,
  break_minutes_allotted integer NOT NULL DEFAULT 60,
  working_days jsonb NOT NULL DEFAULT '[1,2,3,4,5,6]'::jsonb,
  late_threshold_minutes integer NOT NULL DEFAULT 15,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_until date NULL,
  notes text NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_work_sched_emp_eff
  ON public.employee_work_schedules (employee_id, effective_from DESC);

-- Only ONE open (effective_until IS NULL) schedule per employee
CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_work_sched_open
  ON public.employee_work_schedules (employee_id)
  WHERE effective_until IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_work_schedules TO authenticated;
GRANT ALL ON public.employee_work_schedules TO service_role;

ALTER TABLE public.employee_work_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ews_select_self_or_admin_hr"
  ON public.employee_work_schedules
  FOR SELECT TO authenticated
  USING (
    public.is_admin_or_hr()
    OR employee_id = public.get_current_employee_id()
  );

CREATE POLICY "ews_insert_super_admin"
  ON public.employee_work_schedules
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "ews_update_super_admin"
  ON public.employee_work_schedules
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "ews_delete_super_admin"
  ON public.employee_work_schedules
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.tg_set_updated_at_ews()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_ews_updated_at ON public.employee_work_schedules;
CREATE TRIGGER trg_ews_updated_at
  BEFORE UPDATE ON public.employee_work_schedules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at_ews();

-- ---------- 3. attendance_sessions: add metric columns ----------
ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS work_minutes_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS break_minutes_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_arrival_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS early_departure_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS break_overrun_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_work_minutes integer NULL,
  ADD COLUMN IF NOT EXISTS calculation_completed_at timestamptz NULL;

-- ---------- 4. Schedule lookup helper ----------
CREATE OR REPLACE FUNCTION public.get_employee_schedule_for_date(
  p_employee_id uuid,
  p_date date
)
RETURNS public.employee_work_schedules
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.employee_work_schedules
  WHERE employee_id = p_employee_id
    AND effective_from <= p_date
    AND (effective_until IS NULL OR effective_until >= p_date)
  ORDER BY effective_from DESC
  LIMIT 1;
$$;

-- ---------- 5. calculate_attendance_metrics ----------
CREATE OR REPLACE FUNCTION public.calculate_attendance_metrics(
  p_employee_id uuid,
  p_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sched public.employee_work_schedules;
  v_work_minutes integer := 0;
  v_break_minutes integer := 0;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_expected_min integer := 0;
  v_late integer := 0;
  v_early integer := 0;
  v_overtime integer := 0;
  v_break_overrun integer := 0;
  v_sched_start timestamptz;
  v_sched_end timestamptz;
  v_dow integer;
  v_is_working_day boolean := true;
BEGIN
  SELECT * INTO v_sched
  FROM public.get_employee_schedule_for_date(p_employee_id, p_date);

  -- Sum durations
  SELECT
    COALESCE(SUM(CASE WHEN session_type = 'work'  THEN COALESCE(duration_minutes,0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN session_type = 'break' THEN COALESCE(duration_minutes,0) ELSE 0 END), 0),
    MIN(CASE WHEN session_type = 'work' THEN check_in_time END),
    MAX(CASE WHEN session_type = 'work' THEN check_out_time END)
  INTO v_work_minutes, v_break_minutes, v_first_in, v_last_out
  FROM public.attendance_sessions
  WHERE employee_id = p_employee_id
    AND session_date = p_date;

  IF v_sched.id IS NOT NULL THEN
    v_dow := EXTRACT(DOW FROM p_date)::int;
    v_is_working_day := (v_sched.working_days @> to_jsonb(v_dow));
    v_expected_min := COALESCE(v_sched.total_work_hours, 8)::numeric * 60;

    IF v_is_working_day THEN
      v_sched_start := (p_date::text || ' ' || v_sched.work_start_time::text)::timestamptz;
      v_sched_end   := (p_date::text || ' ' || v_sched.work_end_time::text)::timestamptz;

      IF v_first_in IS NOT NULL THEN
        v_late := GREATEST(
          0,
          EXTRACT(EPOCH FROM (v_first_in - v_sched_start))::int / 60
            - COALESCE(v_sched.late_threshold_minutes, 0)
        );
      END IF;

      IF v_last_out IS NOT NULL THEN
        v_early := GREATEST(0, EXTRACT(EPOCH FROM (v_sched_end - v_last_out))::int / 60);
        v_overtime := GREATEST(0, EXTRACT(EPOCH FROM (v_last_out - v_sched_end))::int / 60);
      END IF;

      v_break_overrun := GREATEST(0, v_break_minutes - COALESCE(v_sched.break_minutes_allotted, 0));
    END IF;
  END IF;

  -- Persist on all of today's sessions for the employee
  UPDATE public.attendance_sessions
  SET work_minutes_total       = v_work_minutes,
      break_minutes_total      = v_break_minutes,
      late_arrival_minutes     = v_late,
      early_departure_minutes  = v_early,
      overtime_minutes         = v_overtime,
      break_overrun_minutes    = v_break_overrun,
      expected_work_minutes    = v_expected_min,
      calculation_completed_at = now(),
      updated_at               = now()
  WHERE employee_id = p_employee_id
    AND session_date = p_date;

  RETURN jsonb_build_object(
    'employee_id', p_employee_id,
    'date', p_date,
    'work_minutes_total', v_work_minutes,
    'break_minutes_total', v_break_minutes,
    'expected_work_minutes', v_expected_min,
    'late_arrival_minutes', v_late,
    'early_departure_minutes', v_early,
    'overtime_minutes', v_overtime,
    'break_overrun_minutes', v_break_overrun,
    'is_working_day', v_is_working_day,
    'schedule_id', v_sched.id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_attendance_metrics(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_employee_schedule_for_date(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_or_hr() TO authenticated, service_role;

-- ---------- 6. Auto-recalc on check-out ----------
CREATE OR REPLACE FUNCTION public.tg_recalc_attendance_on_checkout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.check_out_time IS NOT NULL
     AND (OLD.check_out_time IS DISTINCT FROM NEW.check_out_time) THEN
    PERFORM public.calculate_attendance_metrics(NEW.employee_id, NEW.session_date);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_attendance_on_checkout
  ON public.attendance_sessions;
CREATE TRIGGER trg_recalc_attendance_on_checkout
  AFTER UPDATE ON public.attendance_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_attendance_on_checkout();

-- ---------- 7. Update RLS on attendance_sessions ----------
-- Replace existing SELECT policy with today-only for regular users; full for admin/HR.
DROP POLICY IF EXISTS att_sessions_select_self_or_hr_or_mgr ON public.attendance_sessions;

CREATE POLICY "att_sessions_select_admin_hr_all"
  ON public.attendance_sessions
  FOR SELECT TO authenticated
  USING (public.is_admin_or_hr());

CREATE POLICY "att_sessions_select_manager_team"
  ON public.attendance_sessions
  FOR SELECT TO authenticated
  USING (public.is_manager_of(employee_id));

CREATE POLICY "att_sessions_select_self_today"
  ON public.attendance_sessions
  FOR SELECT TO authenticated
  USING (
    employee_id = public.get_current_employee_id()
    AND session_date = CURRENT_DATE
  );
