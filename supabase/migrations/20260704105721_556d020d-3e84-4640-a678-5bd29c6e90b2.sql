
-- ============ PRODUCT CATEGORIES ============
CREATE TABLE IF NOT EXISTS public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  parent_category_id uuid REFERENCES public.product_categories(id) ON DELETE SET NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;
GRANT ALL ON public.product_categories TO service_role;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cat_select_auth" ON public.product_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "cat_insert_admin" ON public.product_categories FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "cat_update_admin" ON public.product_categories FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "cat_delete_admin" ON public.product_categories FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.product_categories(id) ON DELETE SET NULL;

-- ============ PRODUCT ATTRIBUTES ============
CREATE TABLE IF NOT EXISTS public.product_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_type text NOT NULL DEFAULT 'radio' CHECK (display_type IN ('radio','select','color','pills')),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_attributes TO authenticated;
GRANT ALL ON public.product_attributes TO service_role;
ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attr_select_auth" ON public.product_attributes FOR SELECT TO authenticated USING (true);
CREATE POLICY "attr_insert_admin" ON public.product_attributes FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "attr_update_admin" ON public.product_attributes FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "attr_delete_admin" ON public.product_attributes FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TABLE IF NOT EXISTS public.product_attribute_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attribute_id uuid NOT NULL REFERENCES public.product_attributes(id) ON DELETE CASCADE,
  value text NOT NULL,
  extra_price numeric NOT NULL DEFAULT 0,
  color_hex text,
  sort_order integer NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_attribute_values TO authenticated;
GRANT ALL ON public.product_attribute_values TO service_role;
ALTER TABLE public.product_attribute_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "av_select_auth" ON public.product_attribute_values FOR SELECT TO authenticated USING (true);
CREATE POLICY "av_insert_admin" ON public.product_attribute_values FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "av_update_admin" ON public.product_attribute_values FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "av_delete_admin" ON public.product_attribute_values FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TABLE IF NOT EXISTS public.product_attribute_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  attribute_id uuid NOT NULL REFERENCES public.product_attributes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, attribute_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_attribute_assignments TO authenticated;
GRANT ALL ON public.product_attribute_assignments TO service_role;
ALTER TABLE public.product_attribute_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "paa_select_auth" ON public.product_attribute_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "paa_insert_admin" ON public.product_attribute_assignments FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "paa_update_admin" ON public.product_attribute_assignments FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "paa_delete_admin" ON public.product_attribute_assignments FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- ============ UNITS OF MEASURE ============
CREATE TABLE IF NOT EXISTS public.units_of_measure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  abbreviation text NOT NULL,
  uom_type text NOT NULL DEFAULT 'unit' CHECK (uom_type IN ('unit','reference','bigger','smaller')),
  ratio numeric NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.units_of_measure TO authenticated;
GRANT ALL ON public.units_of_measure TO service_role;
ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;
CREATE POLICY "uom_select_auth" ON public.units_of_measure FOR SELECT TO authenticated USING (true);
CREATE POLICY "uom_insert_admin" ON public.units_of_measure FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "uom_update_admin" ON public.units_of_measure FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "uom_delete_admin" ON public.units_of_measure FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS uom_id uuid REFERENCES public.units_of_measure(id);

-- ============ OPERATION TYPES ============
CREATE TABLE IF NOT EXISTS public.operation_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  operation_kind text NOT NULL CHECK (operation_kind IN ('receipt','delivery','internal_transfer','manufacturing')),
  sequence_prefix text,
  default_source_location_id uuid REFERENCES public.warehouse_locations(id),
  default_dest_location_id uuid REFERENCES public.warehouse_locations(id),
  create_backorder text DEFAULT 'ask' CHECK (create_backorder IN ('ask','always','never')),
  use_existing_lots boolean DEFAULT true,
  create_new_lots boolean DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operation_types TO authenticated;
GRANT ALL ON public.operation_types TO service_role;
ALTER TABLE public.operation_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ot_select_auth" ON public.operation_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "ot_insert_admin" ON public.operation_types FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "ot_update_admin" ON public.operation_types FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "ot_delete_admin" ON public.operation_types FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- ============ updated_at triggers ============
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_pc_updated ON public.product_categories;
CREATE TRIGGER trg_pc_updated BEFORE UPDATE ON public.product_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_uom_updated ON public.units_of_measure;
CREATE TRIGGER trg_uom_updated BEFORE UPDATE ON public.units_of_measure FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_ot_updated ON public.operation_types;
CREATE TRIGGER trg_ot_updated BEFORE UPDATE ON public.operation_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ SEED DATA ============
INSERT INTO public.product_categories (name, sort_order) VALUES
  ('Sofas', 10), ('Dining Tables', 20), ('Beds', 30),
  ('Chairs', 40), ('Wardrobes', 50), ('Coffee Tables', 60)
ON CONFLICT DO NOTHING;

INSERT INTO public.units_of_measure (name, abbreviation, uom_type, ratio) VALUES
  ('Piece', 'pc', 'reference', 1),
  ('Set', 'set', 'unit', 1),
  ('Pair', 'pr', 'bigger', 2),
  ('Dozen', 'dz', 'bigger', 12)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.operation_types (name, operation_kind, sequence_prefix) VALUES
  ('Receipts', 'receipt', 'RCP'),
  ('Delivery', 'delivery', 'DEL'),
  ('Internal Transfer', 'internal_transfer', 'INT')
ON CONFLICT DO NOTHING;

-- Attributes
INSERT INTO public.product_attributes (name, display_type, sort_order) VALUES
  ('Size', 'select', 10),
  ('Colour', 'color', 20),
  ('Fabric', 'pills', 30),
  ('Polish', 'radio', 40)
ON CONFLICT (name) DO NOTHING;

-- Values
DO $$
DECLARE
  size_id uuid; colour_id uuid; fabric_id uuid; polish_id uuid;
BEGIN
  SELECT id INTO size_id FROM public.product_attributes WHERE name='Size';
  SELECT id INTO colour_id FROM public.product_attributes WHERE name='Colour';
  SELECT id INTO fabric_id FROM public.product_attributes WHERE name='Fabric';
  SELECT id INTO polish_id FROM public.product_attributes WHERE name='Polish';

  IF size_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.product_attribute_values WHERE attribute_id=size_id) THEN
    INSERT INTO public.product_attribute_values (attribute_id, value, sort_order) VALUES
      (size_id,'Single',10),(size_id,'Double',20),(size_id,'Queen',30),(size_id,'King',40),
      (size_id,'Small',50),(size_id,'Medium',60),(size_id,'Large',70);
  END IF;
  IF colour_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.product_attribute_values WHERE attribute_id=colour_id) THEN
    INSERT INTO public.product_attribute_values (attribute_id, value, color_hex, sort_order) VALUES
      (colour_id,'Black','#111111',10),(colour_id,'White','#FFFFFF',20),
      (colour_id,'Brown','#8B4513',30),(colour_id,'Grey','#808080',40),
      (colour_id,'Beige','#F5F5DC',50),(colour_id,'Blue','#1E40AF',60);
  END IF;
  IF fabric_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.product_attribute_values WHERE attribute_id=fabric_id) THEN
    INSERT INTO public.product_attribute_values (attribute_id, value, sort_order) VALUES
      (fabric_id,'Leather',10),(fabric_id,'Cotton',20),(fabric_id,'Velvet',30),(fabric_id,'Linen',40);
  END IF;
  IF polish_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.product_attribute_values WHERE attribute_id=polish_id) THEN
    INSERT INTO public.product_attribute_values (attribute_id, value, sort_order) VALUES
      (polish_id,'Matte',10),(polish_id,'Glossy',20),(polish_id,'Teak',30),
      (polish_id,'Walnut',40),(polish_id,'Natural',50);
  END IF;
END $$;
