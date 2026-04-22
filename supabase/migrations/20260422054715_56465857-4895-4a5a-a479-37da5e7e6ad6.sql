
-- Drop existing permissive policies on crm_audit_logs
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.crm_audit_logs;
DROP POLICY IF EXISTS "Authenticated users can view audit logs" ON public.crm_audit_logs;

-- Only admins can view audit logs
CREATE POLICY "Admins can view audit logs"
ON public.crm_audit_logs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Only the service role (edge functions) can insert audit logs.
-- For authenticated users calling edge functions, the function uses the service role client internally.
-- We allow insert via a SECURITY DEFINER function instead of a direct policy.
CREATE OR REPLACE FUNCTION public.insert_audit_log(
  _user_id text,
  _user_name text,
  _action text,
  _resource text,
  _resource_id text DEFAULT NULL,
  _details text DEFAULT NULL,
  _ip_address text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.crm_audit_logs (user_id, user_name, action, resource, resource_id, details, ip_address)
  VALUES (_user_id, _user_name, _action, _resource, _resource_id, _details, _ip_address)
  RETURNING id;
$$;
