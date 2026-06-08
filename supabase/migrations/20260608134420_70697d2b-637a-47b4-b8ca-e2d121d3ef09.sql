
-- Resolve customer id from a portal token
CREATE OR REPLACE FUNCTION public.portal_resolve_customer(_token text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.customers
  WHERE portal_token = _token AND portal_enabled = true
  LIMIT 1;
$$;

-- List quotations (with lines + versions) for the customer matching the token
CREATE OR REPLACE FUNCTION public.portal_list_quotations(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust uuid;
BEGIN
  SELECT id INTO v_cust FROM public.customers
   WHERE portal_token = _token AND portal_enabled = true;
  IF v_cust IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(q.*) || jsonb_build_object(
      'quotation_lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(l.*)) FROM public.quotation_lines l WHERE l.quotation_id = q.id
      ), '[]'::jsonb),
      'quotation_versions', COALESCE((
        SELECT jsonb_agg(to_jsonb(v.*)) FROM public.quotation_versions v WHERE v.quotation_id = q.id
      ), '[]'::jsonb)
    ) ORDER BY q.created_at DESC)
    FROM public.quotations q
    WHERE q.customer_id = v_cust
  ), '[]'::jsonb);
END;
$$;

-- Get a single quotation by id, only if it belongs to the customer matching the token
CREATE OR REPLACE FUNCTION public.portal_get_quotation(_token text, _id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust uuid;
  v_result jsonb;
BEGIN
  SELECT id INTO v_cust FROM public.customers
   WHERE portal_token = _token AND portal_enabled = true;
  IF v_cust IS NULL THEN RETURN NULL; END IF;

  SELECT to_jsonb(q.*) || jsonb_build_object(
    'quotation_lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(l.*)) FROM public.quotation_lines l WHERE l.quotation_id = q.id
    ), '[]'::jsonb),
    'quotation_versions', COALESCE((
      SELECT jsonb_agg(to_jsonb(v.*)) FROM public.quotation_versions v WHERE v.quotation_id = q.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.quotations q
  WHERE q.id = _id AND q.customer_id = v_cust;

  RETURN v_result;
END;
$$;

-- List sales orders (with lines + activities) for the customer
CREATE OR REPLACE FUNCTION public.portal_list_sales_orders(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust uuid;
BEGIN
  SELECT id INTO v_cust FROM public.customers
   WHERE portal_token = _token AND portal_enabled = true;
  IF v_cust IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(o.*) || jsonb_build_object(
      'order_lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(l.*)) FROM public.order_lines l WHERE l.order_id = o.id
      ), '[]'::jsonb),
      'order_activities', COALESCE((
        SELECT jsonb_agg(to_jsonb(a.*)) FROM public.order_activities a WHERE a.order_id = o.id
      ), '[]'::jsonb)
    ) ORDER BY o.created_at DESC)
    FROM public.sales_orders o
    WHERE o.customer_id = v_cust
  ), '[]'::jsonb);
END;
$$;

-- Accept / decline a quotation via portal. Only allowed when status='sent'.
CREATE OR REPLACE FUNCTION public.portal_update_quotation_status(
  _token text, _id uuid, _status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust uuid;
BEGIN
  SELECT id INTO v_cust FROM public.customers
   WHERE portal_token = _token AND portal_enabled = true;
  IF v_cust IS NULL THEN RAISE EXCEPTION 'Invalid portal token'; END IF;
  IF _status NOT IN ('accepted','cancelled') THEN
    RAISE EXCEPTION 'Invalid status %', _status;
  END IF;

  UPDATE public.quotations
     SET status = _status,
         accepted_at = CASE WHEN _status = 'accepted' THEN now() ELSE accepted_at END,
         updated_at = now()
   WHERE id = _id
     AND customer_id = v_cust
     AND status = 'sent';

  RETURN public.portal_get_quotation(_token, _id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_resolve_customer(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_quotations(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_quotation(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_sales_orders(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_update_quotation_status(text, uuid, text) TO anon, authenticated;
