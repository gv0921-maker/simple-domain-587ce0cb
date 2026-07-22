
ALTER TABLE public.activity_log
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

DROP FUNCTION IF EXISTS public.get_activity_log_with_users(text, uuid, int, int);

CREATE OR REPLACE FUNCTION public.get_activity_log_with_users(
  p_record_type text,
  p_record_id uuid,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  record_type text,
  record_id uuid,
  action_type text,
  field_name text,
  old_value text,
  new_value text,
  note_text text,
  changed_by uuid,
  changed_by_name text,
  changed_by_email text,
  changed_at timestamptz,
  is_deleted boolean,
  deleted_by uuid,
  deleted_at timestamptz,
  attachments jsonb,
  total_count bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
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
    COALESCE(NULLIF(TRIM(e.full_name), ''), SPLIT_PART(au.email, '@', 1), 'Unknown user'),
    au.email,
    al.changed_at, al.is_deleted, al.deleted_by, al.deleted_at,
    COALESCE(al.attachments, '[]'::jsonb),
    (SELECT c FROM counted)
  FROM base al
  LEFT JOIN auth.users au ON au.id = al.changed_by
  LEFT JOIN public.employees e ON e.auth_user_id = al.changed_by
  LEFT JOIN public.crm_pipeline_stages s_old
    ON al.field_name = 'stage_id'
   AND al.old_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND s_old.id = al.old_value::uuid
  LEFT JOIN public.crm_pipeline_stages s_new
    ON al.field_name = 'stage_id'
   AND al.new_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND s_new.id = al.new_value::uuid
  ORDER BY al.changed_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.get_activity_log_with_users(text, uuid, int, int) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='activity attachments: authenticated can read') THEN
    CREATE POLICY "activity attachments: authenticated can read"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'activity-attachments');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='activity attachments: authenticated can upload') THEN
    CREATE POLICY "activity attachments: authenticated can upload"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'activity-attachments' AND owner = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='activity attachments: owners can delete') THEN
    CREATE POLICY "activity attachments: owners can delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'activity-attachments' AND owner = auth.uid());
  END IF;
END $$;
