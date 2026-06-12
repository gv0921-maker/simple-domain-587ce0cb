CREATE OR REPLACE FUNCTION public.get_dashboard_role()
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RETURN 'unknown'; END IF;

  -- Check legacy user_roles (enum app_role)
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'super_admin') THEN
    RETURN 'super_admin';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin') THEN
    RETURN 'admin';
  END IF;

  -- Check app role assignments (named roles)
  IF EXISTS (
    SELECT 1 FROM public.app_user_role_assignments a
    JOIN public.app_roles r ON r.id = a.role_id
    WHERE a.user_id = v_uid AND r.name IN ('Super Admin')
  ) THEN
    RETURN 'super_admin';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.app_user_role_assignments a
    JOIN public.app_roles r ON r.id = a.role_id
    WHERE a.user_id = v_uid AND r.name IN ('Admin')
  ) THEN
    RETURN 'admin';
  END IF;

  -- Role-specific (legacy enum)
  SELECT role::text INTO v_role FROM public.user_roles
  WHERE user_id = v_uid
    AND role::text IN ('sales_manager','sales_rep','warehouse_operator','pos_operator','accountant','hr_manager')
  ORDER BY CASE role::text
    WHEN 'sales_manager' THEN 1
    WHEN 'hr_manager' THEN 2
    WHEN 'accountant' THEN 3
    WHEN 'warehouse_operator' THEN 4
    WHEN 'sales_rep' THEN 5
    WHEN 'pos_operator' THEN 6
    ELSE 99 END
  LIMIT 1;
  IF v_role IS NOT NULL THEN RETURN v_role; END IF;

  -- Role-specific (named app roles)
  SELECT lower(replace(r.name, ' ', '_')) INTO v_role
  FROM public.app_user_role_assignments a
  JOIN public.app_roles r ON r.id = a.role_id
  WHERE a.user_id = v_uid
    AND r.name IN ('Sales Manager','Sales Rep','Warehouse Operator','POS Operator','Accountant','HR Manager')
  LIMIT 1;
  IF v_role IS NOT NULL THEN RETURN v_role; END IF;

  -- Employee fallback
  IF EXISTS (SELECT 1 FROM public.employees WHERE user_id = v_uid) THEN
    RETURN 'employee';
  END IF;

  RETURN 'unknown';
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_role() TO authenticated;