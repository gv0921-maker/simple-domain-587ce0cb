
CREATE TABLE IF NOT EXISTS public.qc_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL CHECK (document_type IN ('ito','goods_receipt','delivery_note','return')),
  document_id uuid NOT NULL,
  document_line_id uuid,
  serial_number text,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  qc_status text NOT NULL DEFAULT 'pending' CHECK (qc_status IN ('pending','pass','fail')),
  qc_notes text,
  photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  inspected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  inspected_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qc_inspections_document ON public.qc_inspections(document_type, document_id);
CREATE INDEX IF NOT EXISTS idx_qc_inspections_serial ON public.qc_inspections(serial_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qc_inspections_doc_serial
  ON public.qc_inspections(document_type, document_id, serial_number)
  WHERE serial_number IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qc_inspections TO authenticated;
GRANT ALL ON public.qc_inspections TO service_role;

ALTER TABLE public.qc_inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qc_inspections_select_auth" ON public.qc_inspections
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "qc_inspections_insert_warehouse" ON public.qc_inspections
  FOR INSERT TO authenticated WITH CHECK (public.can_write_inventory());

CREATE POLICY "qc_inspections_update_warehouse" ON public.qc_inspections
  FOR UPDATE TO authenticated
  USING (public.can_write_inventory())
  WITH CHECK (public.can_write_inventory());

CREATE POLICY "qc_inspections_delete_warehouse" ON public.qc_inspections
  FOR DELETE TO authenticated USING (public.can_write_inventory());

CREATE TRIGGER trg_qc_inspections_updated_at
  BEFORE UPDATE ON public.qc_inspections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
