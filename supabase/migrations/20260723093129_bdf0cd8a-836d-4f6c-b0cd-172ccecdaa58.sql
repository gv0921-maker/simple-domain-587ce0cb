
-- 1. Fix get_activity_log_with_users so stray non-uuid old/new values (like 'labels_pending')
--    do not cause the whole feed to fail with 22P02.
CREATE OR REPLACE FUNCTION public.get_activity_log_with_users(
  p_record_type text, p_record_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
) RETURNS TABLE(
  id uuid, record_type text, record_id uuid, action_type text, field_name text,
  old_value text, new_value text, note_text text, changed_by uuid,
  changed_by_name text, changed_by_email text, changed_at timestamp with time zone,
  is_deleted boolean, deleted_by uuid, deleted_at timestamp with time zone,
  attachments jsonb, total_count bigint
) LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH base AS (
    SELECT al.*
    FROM public.activity_log al
    WHERE al.record_type = p_record_type
      AND al.record_id = p_record_id
      AND al.is_deleted = false
  ),
  counted AS (SELECT count(*)::bigint AS c FROM base)
  SELECT
    al.id, al.record_type, al.record_id, al.action_type,
    al.field_name,
    CASE WHEN al.field_name = 'stage_id' THEN COALESCE(s_old.name, al.old_value) ELSE al.old_value END,
    CASE WHEN al.field_name = 'stage_id' THEN COALESCE(s_new.name, al.new_value) ELSE al.new_value END,
    al.note_text,
    al.changed_by,
    CASE
      WHEN al.changed_by IS NULL THEN 'System'
      ELSE COALESCE(NULLIF(TRIM(e.full_name), ''), SPLIT_PART(au.email, '@', 1), 'Unknown user')
    END,
    au.email,
    al.changed_at, al.is_deleted, al.deleted_by, al.deleted_at,
    COALESCE(al.attachments, '[]'::jsonb),
    (SELECT c FROM counted)
  FROM base al
  LEFT JOIN auth.users au ON au.id = al.changed_by
  LEFT JOIN public.employees e ON e.auth_user_id = al.changed_by
  LEFT JOIN public.crm_pipeline_stages s_old
    ON s_old.id = (CASE
      WHEN al.field_name = 'stage_id'
       AND al.old_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN al.old_value::uuid END)
  LEFT JOIN public.crm_pipeline_stages s_new
    ON s_new.id = (CASE
      WHEN al.field_name = 'stage_id'
       AND al.new_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN al.new_value::uuid END)
  ORDER BY al.changed_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;

-- 2. Canonical stock views — everything visible derives from goods_receipt_serials.
CREATE OR REPLACE VIEW public.v_product_stock AS
SELECT
  grs.product_id,
  COUNT(*) FILTER (WHERE grs.stock_status IN ('available','reserved'))::int AS on_hand,
  COUNT(*) FILTER (WHERE grs.stock_status = 'available')::int              AS available,
  COUNT(*) FILTER (WHERE grs.stock_status = 'reserved')::int               AS reserved,
  COUNT(*) FILTER (WHERE grs.stock_status = 'in_transit')::int             AS in_transit,
  COUNT(*) FILTER (WHERE grs.stock_status = 'under_correction')::int       AS under_correction,
  COUNT(*) FILTER (WHERE grs.stock_status = 'delivered')::int              AS delivered,
  COUNT(*) FILTER (WHERE grs.stock_status = 'scrapped')::int               AS scrapped,
  COUNT(*) FILTER (WHERE grs.stock_status = 'lost')::int                   AS lost
FROM public.goods_receipt_serials grs
GROUP BY grs.product_id;

CREATE OR REPLACE VIEW public.v_product_stock_by_location AS
SELECT
  grs.product_id,
  grs.current_warehouse_id,
  grs.current_location AS location_id,
  wl.name              AS location_name,
  COUNT(*) FILTER (WHERE grs.stock_status IN ('available','reserved'))::int AS on_hand,
  COUNT(*) FILTER (WHERE grs.stock_status = 'available')::int              AS available,
  COUNT(*) FILTER (WHERE grs.stock_status = 'reserved')::int               AS reserved,
  COUNT(*) FILTER (WHERE grs.stock_status = 'in_transit')::int             AS in_transit,
  COUNT(*) FILTER (WHERE grs.stock_status = 'under_correction')::int       AS under_correction
FROM public.goods_receipt_serials grs
LEFT JOIN public.warehouse_locations wl
  ON grs.current_location ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 AND wl.id = grs.current_location::uuid
GROUP BY grs.product_id, grs.current_warehouse_id, grs.current_location, wl.name;

CREATE OR REPLACE VIEW public.v_available_serials AS
SELECT
  grs.id,
  grs.product_id,
  grs.serial_number,
  grs.barcode_value,
  grs.current_warehouse_id,
  grs.current_location AS location_id,
  wl.name              AS location_name,
  grs.goods_receipt_id,
  grs.updated_at
FROM public.goods_receipt_serials grs
LEFT JOIN public.warehouse_locations wl
  ON grs.current_location ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 AND wl.id = grs.current_location::uuid
WHERE grs.stock_status = 'available';

GRANT SELECT ON public.v_product_stock TO authenticated, anon;
GRANT SELECT ON public.v_product_stock_by_location TO authenticated, anon;
GRANT SELECT ON public.v_available_serials TO authenticated, anon;
