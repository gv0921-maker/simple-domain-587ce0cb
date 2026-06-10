
-- Chat module: channels, members, messages
CREATE TABLE public.chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  type text NOT NULL DEFAULT 'channel' CHECK (type IN ('channel','group','dm')),
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  is_private boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_channels TO authenticated;
GRANT ALL ON public.chat_channels TO service_role;
ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.chat_channel_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  muted_until timestamptz,
  notification_level text NOT NULL DEFAULT 'all' CHECK (notification_level IN ('all','mentions','none')),
  UNIQUE (channel_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_channel_members TO authenticated;
GRANT ALL ON public.chat_channel_members TO service_role;
ALTER TABLE public.chat_channel_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL,
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','system')),
  is_edited boolean NOT NULL DEFAULT false,
  edited_at timestamptz,
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_channel_created_idx ON public.chat_messages (channel_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Security definer helpers to avoid recursion
CREATE OR REPLACE FUNCTION public.is_chat_channel_member(_channel_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.chat_channel_members WHERE channel_id = _channel_id AND user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.is_chat_channel_admin(_channel_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channel_members
    WHERE channel_id = _channel_id AND user_id = _user_id AND role IN ('owner','admin')
  )
$$;

-- Policies: chat_channels
CREATE POLICY chat_channels_select ON public.chat_channels FOR SELECT TO authenticated
  USING (NOT is_private OR public.is_chat_channel_member(id, auth.uid()));
CREATE POLICY chat_channels_insert ON public.chat_channels FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY chat_channels_update ON public.chat_channels FOR UPDATE TO authenticated
  USING (public.is_chat_channel_admin(id, auth.uid()))
  WITH CHECK (public.is_chat_channel_admin(id, auth.uid()));
CREATE POLICY chat_channels_delete ON public.chat_channels FOR DELETE TO authenticated
  USING (public.is_chat_channel_admin(id, auth.uid()));

-- Policies: chat_channel_members
CREATE POLICY chat_members_select ON public.chat_channel_members FOR SELECT TO authenticated
  USING (public.is_chat_channel_member(channel_id, auth.uid()));
CREATE POLICY chat_members_insert ON public.chat_channel_members FOR INSERT TO authenticated
  WITH CHECK (
    public.is_chat_channel_admin(channel_id, auth.uid())
    OR (user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.chat_channels c WHERE c.id = channel_id AND c.is_private = false
    ))
  );
CREATE POLICY chat_members_update ON public.chat_channel_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY chat_members_delete ON public.chat_channel_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_chat_channel_admin(channel_id, auth.uid()));

-- Policies: chat_messages
CREATE POLICY chat_messages_select ON public.chat_messages FOR SELECT TO authenticated
  USING (public.is_chat_channel_member(channel_id, auth.uid()));
CREATE POLICY chat_messages_insert ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_chat_channel_member(channel_id, auth.uid()));
CREATE POLICY chat_messages_update ON public.chat_messages FOR UPDATE TO authenticated
  USING (
    (user_id = auth.uid() AND created_at > now() - interval '15 minutes')
    OR public.is_chat_channel_admin(channel_id, auth.uid())
  )
  WITH CHECK (
    (user_id = auth.uid() AND created_at > now() - interval '15 minutes')
    OR public.is_chat_channel_admin(channel_id, auth.uid())
  );

-- updated_at triggers
CREATE TRIGGER chat_channels_updated_at BEFORE UPDATE ON public.chat_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER chat_messages_updated_at BEFORE UPDATE ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_channels;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_channel_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER TABLE public.chat_channels REPLICA IDENTITY FULL;
ALTER TABLE public.chat_channel_members REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;

-- Seed: Announcements channel + per-department channels, all current users as members
DO $$
DECLARE
  v_announce uuid;
  v_dept record;
  v_ch uuid;
BEGIN
  INSERT INTO public.chat_channels (name, description, type, is_private)
  VALUES ('Announcements', 'Company-wide announcements', 'channel', false)
  RETURNING id INTO v_announce;

  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT v_announce, u.id, 'member' FROM auth.users u
  ON CONFLICT DO NOTHING;

  FOR v_dept IN SELECT id, name FROM public.departments LOOP
    INSERT INTO public.chat_channels (name, description, type, department_id, is_private)
    VALUES ('# ' || v_dept.name, v_dept.name || ' department channel', 'channel', v_dept.id, false)
    RETURNING id INTO v_ch;

    INSERT INTO public.chat_channel_members (channel_id, user_id, role)
    SELECT v_ch, e.user_id, 'member'
    FROM public.employees e
    WHERE e.department_id = v_dept.id AND e.user_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Trigger: when employee added/updated with a user_id + department, auto-join channels
CREATE OR REPLACE FUNCTION public.chat_autojoin_employee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ch uuid;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  -- Announcements
  FOR v_ch IN SELECT id FROM public.chat_channels WHERE name = 'Announcements' AND type = 'channel' LIMIT 1 LOOP
    INSERT INTO public.chat_channel_members (channel_id, user_id, role)
    VALUES (v_ch, NEW.user_id, 'member') ON CONFLICT DO NOTHING;
  END LOOP;

  -- Department channel
  IF NEW.department_id IS NOT NULL THEN
    FOR v_ch IN SELECT id FROM public.chat_channels WHERE department_id = NEW.department_id AND type = 'channel' LIMIT 1 LOOP
      INSERT INTO public.chat_channel_members (channel_id, user_id, role)
      VALUES (v_ch, NEW.user_id, 'member') ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER chat_autojoin_employee_trg
AFTER INSERT OR UPDATE OF user_id, department_id ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.chat_autojoin_employee();
