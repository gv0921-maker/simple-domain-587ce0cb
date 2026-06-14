
CREATE OR REPLACE FUNCTION public.ensure_user_has_at_least_one_role(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_existing_count int;
  v_viewer_role_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.has_role(v_caller, 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden: super_admin required';
  END IF;

  SELECT count(*) INTO v_existing_count
  FROM public.app_user_role_assignments
  WHERE user_id = p_user_id;

  IF v_existing_count > 0 THEN
    RETURN false;
  END IF;

  SELECT id INTO v_viewer_role_id
  FROM public.app_roles
  WHERE lower(name) IN ('viewer','read-only user','read only user')
  ORDER BY is_system DESC, created_at ASC
  LIMIT 1;

  IF v_viewer_role_id IS NULL THEN
    RAISE EXCEPTION 'No viewer/read-only role exists to assign';
  END IF;

  INSERT INTO public.app_user_role_assignments(user_id, role_id, assigned_by)
  VALUES (p_user_id, v_viewer_role_id, v_caller);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_has_at_least_one_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_user_has_at_least_one_role(uuid) TO authenticated;
