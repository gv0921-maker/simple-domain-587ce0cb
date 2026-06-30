
-- PART A: Link customers to crm_contacts with auto-sync trigger
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS crm_contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_crm_contact ON public.customers(crm_contact_id) WHERE crm_contact_id IS NOT NULL;

-- PART B: Dedupe crm_contacts by lowercased email (keep oldest, merge tags/notes)
WITH dups AS (
  SELECT id, LOWER(TRIM(email)) AS k, created_at,
    ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(email)) ORDER BY created_at ASC, id ASC) AS rn
  FROM public.crm_contacts
  WHERE email IS NOT NULL AND TRIM(email) <> ''
),
keepers AS (SELECT k, id AS keeper_id FROM dups WHERE rn = 1),
losers AS (SELECT d.id AS loser_id, k.keeper_id FROM dups d JOIN keepers k USING (k) WHERE d.rn > 1)
-- Repoint customers from loser contacts to keeper
UPDATE public.customers c SET crm_contact_id = l.keeper_id
FROM losers l WHERE c.crm_contact_id = l.loser_id;

-- Merge tags/notes from losers into keepers, then delete loser contacts
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    WITH dups AS (
      SELECT id, LOWER(TRIM(email)) AS k,
        ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(email)) ORDER BY created_at ASC, id ASC) AS rn
      FROM public.crm_contacts WHERE email IS NOT NULL AND TRIM(email) <> ''
    ),
    keepers AS (SELECT k, id AS keeper_id FROM dups WHERE rn = 1)
    SELECT d.id AS loser_id, k.keeper_id
    FROM dups d JOIN keepers k USING (k) WHERE d.rn > 1
  LOOP
    UPDATE public.crm_contacts kp
      SET tags = ARRAY(SELECT DISTINCT unnest(COALESCE(kp.tags,'{}'::text[]) || COALESCE(ls.tags,'{}'::text[])))::text[],
          notes = TRIM(BOTH E'\n' FROM COALESCE(kp.notes,'') || E'\n' || COALESCE(ls.notes,''))
      FROM public.crm_contacts ls
      WHERE kp.id = r.keeper_id AND ls.id = r.loser_id;
    DELETE FROM public.crm_contacts WHERE id = r.loser_id;
  END LOOP;
END $$;

-- Link existing customers to contacts where emails match
UPDATE public.customers c
SET crm_contact_id = ct.id
FROM public.crm_contacts ct
WHERE c.crm_contact_id IS NULL
  AND c.email IS NOT NULL AND TRIM(c.email) <> ''
  AND LOWER(TRIM(c.email)) = LOWER(TRIM(ct.email));

-- Fallback: match by name+phone for customers without email
UPDATE public.customers c
SET crm_contact_id = ct.id
FROM public.crm_contacts ct
WHERE c.crm_contact_id IS NULL
  AND TRIM(c.name) = TRIM(CONCAT(ct.first_name, ' ', ct.last_name))
  AND COALESCE(c.phone,'') = COALESCE(ct.phone,'');

-- For customers still unlinked, create a contact and link
DO $$
DECLARE r RECORD; new_id uuid;
BEGIN
  FOR r IN SELECT * FROM public.customers WHERE crm_contact_id IS NULL LOOP
    INSERT INTO public.crm_contacts (first_name, last_name, email, phone, company_name, gstin, status, type)
    VALUES (
      NULLIF(SPLIT_PART(COALESCE(r.name,''),' ',1),''),
      NULLIF(TRIM(SUBSTRING(COALESCE(r.name,'') FROM POSITION(' ' IN COALESCE(r.name,'')))),''),
      NULLIF(r.email,''),
      r.phone,
      r.contact_person,
      r.gstin,
      'active',
      CASE WHEN r.type = 'company' THEN 'company'::contact_type ELSE 'individual'::contact_type END
    ) RETURNING id INTO new_id;
    UPDATE public.customers SET crm_contact_id = new_id WHERE id = r.id;
  END LOOP;
END $$;

-- One-way sync trigger crm_contacts -> customers
CREATE OR REPLACE FUNCTION public.sync_customer_from_contact()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  full_name text;
  existing_customer_id uuid;
BEGIN
  full_name := TRIM(CONCAT(NEW.first_name, ' ', NEW.last_name));
  IF full_name = '' THEN full_name := COALESCE(NEW.company_name, NEW.email, 'Unnamed'); END IF;

  SELECT id INTO existing_customer_id FROM public.customers WHERE crm_contact_id = NEW.id LIMIT 1;

  IF existing_customer_id IS NOT NULL THEN
    UPDATE public.customers SET
      name = full_name,
      email = NULLIF(NEW.email, ''),
      phone = NEW.phone,
      gstin = NEW.gstin,
      contact_person = NEW.company_name,
      type = CASE WHEN NEW.type::text = 'company' THEN 'company' ELSE 'individual' END,
      updated_at = now()
    WHERE id = existing_customer_id;
  ELSE
    INSERT INTO public.customers (name, email, phone, gstin, contact_person, crm_contact_id, is_active, type)
    VALUES (full_name, NULLIF(NEW.email, ''), NEW.phone, NEW.gstin, NEW.company_name, NEW.id, true,
      CASE WHEN NEW.type::text = 'company' THEN 'company' ELSE 'individual' END);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_customer_from_contact ON public.crm_contacts;
CREATE TRIGGER trg_sync_customer_from_contact
AFTER INSERT OR UPDATE ON public.crm_contacts
FOR EACH ROW EXECUTE FUNCTION public.sync_customer_from_contact();

-- Resolver RPC
CREATE OR REPLACE FUNCTION public.get_or_create_customer_for_contact(p_contact_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cust_id uuid;
BEGIN
  SELECT id INTO cust_id FROM public.customers WHERE crm_contact_id = p_contact_id LIMIT 1;
  IF cust_id IS NULL THEN
    UPDATE public.crm_contacts SET updated_at = now() WHERE id = p_contact_id;
    SELECT id INTO cust_id FROM public.customers WHERE crm_contact_id = p_contact_id LIMIT 1;
  END IF;
  RETURN cust_id;
END $$;
GRANT EXECUTE ON FUNCTION public.get_or_create_customer_for_contact TO authenticated;
