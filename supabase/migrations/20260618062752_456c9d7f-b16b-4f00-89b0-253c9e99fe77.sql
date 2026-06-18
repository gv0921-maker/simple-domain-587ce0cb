
DO $$
DECLARE
  new_user_id uuid := gen_random_uuid();
BEGIN
  -- Remove any existing record with this email to keep things clean
  DELETE FROM auth.users WHERE email = 'vigu0921@gmail.com';

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change,
    email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    'vigu0921@gmail.com',
    crypt('0000abcd', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Vignesh"}'::jsonb,
    now(), now(), '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', 'vigu0921@gmail.com', 'email_verified', true),
    'email',
    'vigu0921@gmail.com',
    now(), now(), now()
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (new_user_id, 'super_admin'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;
