-- User-saved filters table
CREATE TABLE public.user_saved_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module text NOT NULL,
  name text NOT NULL,
  filter_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  is_system_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, module, name)
);

CREATE INDEX idx_user_saved_filters_user_module ON public.user_saved_filters(user_id, module);
CREATE INDEX idx_user_saved_filters_system_default ON public.user_saved_filters(module, is_system_default) WHERE is_system_default = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_saved_filters TO authenticated;
GRANT ALL ON public.user_saved_filters TO service_role;

ALTER TABLE public.user_saved_filters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own or system defaults"
  ON public.user_saved_filters FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_system_default = true);

CREATE POLICY "users insert own"
  ON public.user_saved_filters FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users update own"
  ON public.user_saved_filters FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users delete own"
  ON public.user_saved_filters FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Only super_admin may flip is_system_default to true
CREATE OR REPLACE FUNCTION public.enforce_system_default_super_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_system_default = true AND (TG_OP = 'INSERT' OR OLD.is_system_default IS DISTINCT FROM NEW.is_system_default) THEN
    IF NOT public.has_role(auth.uid(), 'super_admin') THEN
      RAISE EXCEPTION 'Only super_admin may set is_system_default';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_saved_filters_system_default
  BEFORE INSERT OR UPDATE ON public.user_saved_filters
  FOR EACH ROW EXECUTE FUNCTION public.enforce_system_default_super_admin();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_user_saved_filters_updated_at
  BEFORE UPDATE ON public.user_saved_filters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RPC: set per-user default
CREATE OR REPLACE FUNCTION public.set_user_default_filter(p_module text, p_filter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_saved_filters
     SET is_default = false
   WHERE user_id = auth.uid() AND module = p_module AND id <> p_filter_id;
  UPDATE public.user_saved_filters
     SET is_default = true
   WHERE user_id = auth.uid() AND module = p_module AND id = p_filter_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_user_default_filter(text, uuid) TO authenticated;

-- RPC: set system default (super_admin only)
CREATE OR REPLACE FUNCTION public.set_system_default_filter(p_module text, p_filter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only super_admin may set system default';
  END IF;
  UPDATE public.user_saved_filters
     SET is_system_default = false
   WHERE module = p_module AND id <> p_filter_id;
  UPDATE public.user_saved_filters
     SET is_system_default = true
   WHERE module = p_module AND id = p_filter_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_system_default_filter(text, uuid) TO authenticated;