
-- ============================ ENUMS ============================
DO $$ BEGIN
  CREATE TYPE public.appraisal_cycle_type AS ENUM ('quarterly','half_yearly','annual','probation','custom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.appraisal_cycle_status AS ENUM ('draft','active','in_progress','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.appraisal_template_scope AS ENUM ('all','department','designation','employment_type');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.appraisal_criterion_category AS ENUM ('kpi','competency','goal','behavioral','skill');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.appraisal_rating_scale AS ENUM ('1_to_5','1_to_10','percentage');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.appraisal_status AS ENUM ('not_started','self_review','manager_review','hr_review','completed','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.appraisal_recommendation AS ENUM ('promote','increment','maintain','improve','pip');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.appraisal_goal_priority AS ENUM ('low','medium','high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.appraisal_goal_status AS ENUM ('not_started','in_progress','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Helper: is current user the employee row
CREATE OR REPLACE FUNCTION public.is_employee_self(_employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.employees WHERE id = _employee_id AND user_id = auth.uid())
$$;

-- Helper: is current user the manager (reviewer) for given employee row
CREATE OR REPLACE FUNCTION public.is_reviewer_for(_reviewer_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.employees WHERE id = _reviewer_id AND user_id = auth.uid())
$$;

-- ======================== appraisal_cycles ========================
CREATE TABLE public.appraisal_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  cycle_type public.appraisal_cycle_type NOT NULL DEFAULT 'annual',
  period_start_date date NOT NULL,
  period_end_date date NOT NULL,
  self_review_start_date date,
  self_review_end_date date,
  manager_review_start_date date,
  manager_review_end_date date,
  hr_finalization_deadline date,
  status public.appraisal_cycle_status NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.appraisal_cycles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.appraisal_cycles TO authenticated;
GRANT ALL ON public.appraisal_cycles TO service_role;
ALTER TABLE public.appraisal_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cycles read all auth" ON public.appraisal_cycles FOR SELECT TO authenticated USING (true);
CREATE POLICY "cycles manage hr/admin" ON public.appraisal_cycles FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]));
CREATE TRIGGER trg_cycles_updated BEFORE UPDATE ON public.appraisal_cycles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ======================= appraisal_templates ======================
CREATE TABLE public.appraisal_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  applies_to public.appraisal_template_scope NOT NULL DEFAULT 'all',
  applies_to_filter_json jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appraisal_templates TO authenticated;
GRANT ALL ON public.appraisal_templates TO service_role;
ALTER TABLE public.appraisal_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "templates read auth" ON public.appraisal_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "templates manage hr/admin" ON public.appraisal_templates FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]));
CREATE TRIGGER trg_tpl_updated BEFORE UPDATE ON public.appraisal_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ======================= appraisal_criteria =======================
CREATE TABLE public.appraisal_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.appraisal_templates(id) ON DELETE CASCADE,
  criterion_name text NOT NULL,
  description text,
  category public.appraisal_criterion_category NOT NULL DEFAULT 'kpi',
  weightage_percentage numeric(5,2) NOT NULL DEFAULT 0,
  rating_scale public.appraisal_rating_scale NOT NULL DEFAULT '1_to_5',
  is_required boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appraisal_criteria TO authenticated;
GRANT ALL ON public.appraisal_criteria TO service_role;
ALTER TABLE public.appraisal_criteria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "criteria read auth" ON public.appraisal_criteria FOR SELECT TO authenticated USING (true);
CREATE POLICY "criteria manage hr/admin" ON public.appraisal_criteria FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]));

-- ========================== appraisals ===========================
CREATE TABLE public.appraisals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_cycle_id uuid NOT NULL REFERENCES public.appraisal_cycles(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.appraisal_templates(id) ON DELETE SET NULL,
  reviewer_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  reviewer_2_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  hr_reviewer_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  status public.appraisal_status NOT NULL DEFAULT 'not_started',
  self_review_submitted_at timestamptz,
  manager_review_submitted_at timestamptz,
  hr_finalized_at timestamptz,
  self_overall_rating numeric(5,2),
  manager_overall_rating numeric(5,2),
  final_overall_rating numeric(5,2),
  recommendation public.appraisal_recommendation,
  increment_percentage_recommended numeric(5,2),
  promotion_recommended_designation text,
  strengths text,
  areas_of_improvement text,
  training_recommendations text,
  manager_comments text,
  hr_comments text,
  employee_acknowledgement boolean NOT NULL DEFAULT false,
  employee_acknowledged_at timestamptz,
  employee_response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appraisal_cycle_id, employee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appraisals TO authenticated;
GRANT ALL ON public.appraisals TO service_role;
ALTER TABLE public.appraisals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "appraisals hr/admin manage" ON public.appraisals FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[]));
CREATE POLICY "appraisals self read" ON public.appraisals FOR SELECT TO authenticated
  USING (public.is_employee_self(employee_id));
CREATE POLICY "appraisals self update" ON public.appraisals FOR UPDATE TO authenticated
  USING (public.is_employee_self(employee_id))
  WITH CHECK (public.is_employee_self(employee_id));
CREATE POLICY "appraisals reviewer read" ON public.appraisals FOR SELECT TO authenticated
  USING (reviewer_id IS NOT NULL AND public.is_reviewer_for(reviewer_id));
CREATE POLICY "appraisals reviewer update" ON public.appraisals FOR UPDATE TO authenticated
  USING (reviewer_id IS NOT NULL AND public.is_reviewer_for(reviewer_id))
  WITH CHECK (reviewer_id IS NOT NULL AND public.is_reviewer_for(reviewer_id));
CREATE TRIGGER trg_appraisals_updated BEFORE UPDATE ON public.appraisals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ======================= appraisal_ratings =======================
CREATE TABLE public.appraisal_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id uuid NOT NULL REFERENCES public.appraisals(id) ON DELETE CASCADE,
  criterion_id uuid NOT NULL REFERENCES public.appraisal_criteria(id) ON DELETE CASCADE,
  self_rating numeric(5,2),
  self_comments text,
  manager_rating numeric(5,2),
  manager_comments text,
  final_rating numeric(5,2),
  hr_comments text,
  weighted_score numeric(7,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(appraisal_id, criterion_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appraisal_ratings TO authenticated;
GRANT ALL ON public.appraisal_ratings TO service_role;
ALTER TABLE public.appraisal_ratings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.appraisal_user_can_access(_appraisal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.appraisals a
    WHERE a.id = _appraisal_id AND (
      public.has_any_role(auth.uid(), ARRAY['hr_manager','admin','super_admin']::app_role[])
      OR public.is_employee_self(a.employee_id)
      OR (a.reviewer_id IS NOT NULL AND public.is_reviewer_for(a.reviewer_id))
      OR (a.reviewer_2_id IS NOT NULL AND public.is_reviewer_for(a.reviewer_2_id))
    )
  )
$$;

CREATE POLICY "ratings stakeholder access" ON public.appraisal_ratings FOR ALL TO authenticated
  USING (public.appraisal_user_can_access(appraisal_id))
  WITH CHECK (public.appraisal_user_can_access(appraisal_id));

-- auto-calc weighted_score = final_rating * criterion.weightage / 100
CREATE OR REPLACE FUNCTION public.appraisal_ratings_calc_weighted()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_w numeric(5,2);
BEGIN
  IF NEW.final_rating IS NOT NULL THEN
    SELECT weightage_percentage INTO v_w FROM public.appraisal_criteria WHERE id = NEW.criterion_id;
    NEW.weighted_score := COALESCE(NEW.final_rating,0) * COALESCE(v_w,0) / 100.0;
  ELSE
    NEW.weighted_score := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ratings_weighted BEFORE INSERT OR UPDATE ON public.appraisal_ratings
  FOR EACH ROW EXECUTE FUNCTION public.appraisal_ratings_calc_weighted();

-- ======================== appraisal_goals ========================
CREATE TABLE public.appraisal_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id uuid NOT NULL REFERENCES public.appraisals(id) ON DELETE CASCADE,
  goal_title text NOT NULL,
  goal_description text,
  target_date date,
  priority public.appraisal_goal_priority NOT NULL DEFAULT 'medium',
  status public.appraisal_goal_status NOT NULL DEFAULT 'not_started',
  completion_percentage int NOT NULL DEFAULT 0,
  achievement_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appraisal_goals TO authenticated;
GRANT ALL ON public.appraisal_goals TO service_role;
ALTER TABLE public.appraisal_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "goals stakeholder access" ON public.appraisal_goals FOR ALL TO authenticated
  USING (public.appraisal_user_can_access(appraisal_id))
  WITH CHECK (public.appraisal_user_can_access(appraisal_id));
CREATE TRIGGER trg_goals_updated BEFORE UPDATE ON public.appraisal_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================== appraisal_attachments ====================
CREATE TABLE public.appraisal_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id uuid NOT NULL REFERENCES public.appraisals(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text NOT NULL,
  file_size bigint,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appraisal_attachments TO authenticated;
GRANT ALL ON public.appraisal_attachments TO service_role;
ALTER TABLE public.appraisal_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attachments stakeholder access" ON public.appraisal_attachments FOR ALL TO authenticated
  USING (public.appraisal_user_can_access(appraisal_id))
  WITH CHECK (public.appraisal_user_can_access(appraisal_id));

-- ====================== SEED default template ====================
DO $$
DECLARE v_tpl uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.appraisal_templates WHERE name = 'Standard Annual Review') THEN
    INSERT INTO public.appraisal_templates(name, description, applies_to, is_active)
    VALUES ('Standard Annual Review', 'Default GLF annual performance template', 'all', true)
    RETURNING id INTO v_tpl;

    INSERT INTO public.appraisal_criteria(template_id, criterion_name, category, weightage_percentage, display_order) VALUES
      (v_tpl, 'Sales Achievement', 'kpi', 25, 1),
      (v_tpl, 'Quality of Work', 'kpi', 15, 2),
      (v_tpl, 'Communication', 'competency', 10, 3),
      (v_tpl, 'Teamwork', 'competency', 10, 4),
      (v_tpl, 'Initiative', 'competency', 10, 5),
      (v_tpl, 'Punctuality and Discipline', 'behavioral', 10, 6),
      (v_tpl, 'Customer Service', 'behavioral', 10, 7),
      (v_tpl, 'Job Knowledge', 'skill', 10, 8);
  END IF;
END $$;
