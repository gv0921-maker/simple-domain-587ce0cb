-- ============ attendance_sessions ============
CREATE TABLE public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  session_date date NOT NULL DEFAULT CURRENT_DATE,
  session_type text NOT NULL CHECK (session_type IN ('work','break')),
  check_in_time timestamptz NOT NULL DEFAULT now(),
  check_in_latitude numeric(10,7),
  check_in_longitude numeric(10,7),
  check_in_address text,
  check_in_accuracy_meters numeric,
  check_out_time timestamptz,
  check_out_latitude numeric(10,7),
  check_out_longitude numeric(10,7),
  check_out_address text,
  check_out_accuracy_meters numeric,
  duration_minutes integer,
  source text NOT NULL DEFAULT 'mobile_gps' CHECK (source IN ('mobile_gps','manual','biometric','csv_import')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX idx_attendance_sessions_emp_date ON public.attendance_sessions(employee_id, session_date);
CREATE INDEX idx_attendance_sessions_open ON public.attendance_sessions(employee_id) WHERE check_out_time IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_sessions TO authenticated;
GRANT ALL ON public.attendance_sessions TO service_role;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;

-- Auto-calc duration_minutes trigger
CREATE OR REPLACE FUNCTION public.attendance_sessions_calc_duration()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.check_out_time IS NOT NULL AND NEW.check_in_time IS NOT NULL THEN
    NEW.duration_minutes := GREATEST(0, EXTRACT(EPOCH FROM (NEW.check_out_time - NEW.check_in_time))::int / 60);
  ELSE
    NEW.duration_minutes := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_attendance_sessions_calc
BEFORE INSERT OR UPDATE ON public.attendance_sessions
FOR EACH ROW EXECUTE FUNCTION public.attendance_sessions_calc_duration();

-- RLS
CREATE POLICY "att_sessions_select_self_or_hr_or_mgr"
ON public.attendance_sessions FOR SELECT TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[])
  OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = attendance_sessions.employee_id AND e.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.employees emp
             JOIN public.employees mgr ON mgr.id = emp.reports_to
             WHERE emp.id = attendance_sessions.employee_id AND mgr.user_id = auth.uid())
);

CREATE POLICY "att_sessions_insert_self_or_hr"
ON public.attendance_sessions FOR INSERT TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[])
  OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = attendance_sessions.employee_id AND e.user_id = auth.uid())
);

CREATE POLICY "att_sessions_update_open_self_or_hr"
ON public.attendance_sessions FOR UPDATE TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[])
  OR (
    check_out_time IS NULL
    AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id = attendance_sessions.employee_id AND e.user_id = auth.uid())
  )
)
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[])
  OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = attendance_sessions.employee_id AND e.user_id = auth.uid())
);

CREATE POLICY "att_sessions_delete_hr"
ON public.attendance_sessions FOR DELETE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]));

-- ============ attendance_locations ============
CREATE TABLE public.attendance_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  latitude numeric(10,7) NOT NULL,
  longitude numeric(10,7) NOT NULL,
  radius_meters integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_locations TO authenticated;
GRANT ALL ON public.attendance_locations TO service_role;
ALTER TABLE public.attendance_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "att_loc_select_all" ON public.attendance_locations
FOR SELECT TO authenticated USING (true);
CREATE POLICY "att_loc_manage_hr" ON public.attendance_locations
FOR ALL TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]));

-- ============ holidays ============
CREATE TABLE public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'national' CHECK (type IN ('national','regional','company')),
  is_optional boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (holiday_date, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays TO authenticated;
GRANT ALL ON public.holidays TO service_role;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "holidays_select_all" ON public.holidays
FOR SELECT TO authenticated USING (true);
CREATE POLICY "holidays_manage_hr" ON public.holidays
FOR ALL TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]));

INSERT INTO public.holidays (holiday_date, name, type) VALUES
  ('2026-01-26','Republic Day','national'),
  ('2026-08-15','Independence Day','national'),
  ('2026-10-02','Gandhi Jayanti','national')
ON CONFLICT DO NOTHING;

-- ============ work_schedules ============
CREATE TABLE public.work_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL DEFAULT '09:00',
  end_time time NOT NULL DEFAULT '18:00',
  break_duration_minutes integer NOT NULL DEFAULT 60,
  is_working_day boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, day_of_week)
);
CREATE INDEX idx_work_schedules_emp ON public.work_schedules(employee_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_schedules TO authenticated;
GRANT ALL ON public.work_schedules TO service_role;
ALTER TABLE public.work_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_sched_select_self_or_hr"
ON public.work_schedules FOR SELECT TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[])
  OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = work_schedules.employee_id AND e.user_id = auth.uid())
);
CREATE POLICY "work_sched_manage_hr"
ON public.work_schedules FOR ALL TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]));

CREATE TRIGGER trg_work_schedules_updated_at
BEFORE UPDATE ON public.work_schedules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create default schedule (Mon-Sat 9-6, Sun off) on employee creation
CREATE OR REPLACE FUNCTION public.employees_create_default_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.work_schedules (employee_id, day_of_week, start_time, end_time, break_duration_minutes, is_working_day)
  SELECT NEW.id, dow,
         CASE WHEN dow = 0 THEN '00:00'::time ELSE '09:00'::time END,
         CASE WHEN dow = 0 THEN '00:00'::time ELSE '18:00'::time END,
         60,
         dow <> 0
  FROM generate_series(0,6) AS dow
  ON CONFLICT (employee_id, day_of_week) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_employees_default_schedule
AFTER INSERT ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.employees_create_default_schedule();

-- Backfill schedules for existing employees
INSERT INTO public.work_schedules (employee_id, day_of_week, start_time, end_time, break_duration_minutes, is_working_day)
SELECT e.id, dow,
       CASE WHEN dow = 0 THEN '00:00'::time ELSE '09:00'::time END,
       CASE WHEN dow = 0 THEN '00:00'::time ELSE '18:00'::time END,
       60,
       dow <> 0
FROM public.employees e CROSS JOIN generate_series(0,6) AS dow
ON CONFLICT (employee_id, day_of_week) DO NOTHING;