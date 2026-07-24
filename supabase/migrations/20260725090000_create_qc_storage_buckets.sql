-- Create the QC evidence storage buckets.
--
-- Three buckets are referenced by application code but exist in no migration,
-- so every QC photo upload fails against a fresh or re-provisioned project:
--
--   qc-photos           src/lib/services/inventory/qcEngine.ts:171
--   qc-images           src/lib/services/inventory/goodsReceipt.ts:248
--                       src/lib/services/qc/api.ts:70
--   delivery-qc-images  src/lib/services/qc/delivery.ts:50
--
-- INVENTORY_PLAN.md §1.3.5 treats buckets as a manual dashboard step. That is
-- almost certainly how these went missing, and QC photos are mandatory on
-- failure (§3.3), so they are created here instead — versioned and repeatable.
--
-- All three are public because every call site resolves the stored file with
-- getPublicUrl(); switching them to private would require signed URLs and a
-- code change in each service.
--
-- Writes are gated on can_write_inventory() (admin, warehouse_operator or
-- sales_manager), matching the RLS already applied to qc_inspections.

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('qc-photos',          'qc-photos',          true),
  ('qc-images',          'qc-images',          true),
  ('delivery-qc-images', 'delivery-qc-images', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DO $$
DECLARE
  b text;
  buckets text[] := ARRAY['qc-photos', 'qc-images', 'delivery-qc-images'];
BEGIN
  FOREACH b IN ARRAY buckets LOOP
    -- Read: public buckets serve objects over the public URL regardless, so
    -- this only governs the authenticated API surface.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = b || ': authenticated can read'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON storage.objects FOR SELECT TO authenticated USING (bucket_id = %L)',
        b || ': authenticated can read', b
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = b || ': inventory writers can upload'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = %L AND public.can_write_inventory())',
        b || ': inventory writers can upload', b
      );
    END IF;

    -- Update is needed for upsert-style re-uploads of the same path.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = b || ': inventory writers can update'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = %L AND public.can_write_inventory())',
        b || ': inventory writers can update', b
      );
    END IF;

    -- removeQCPhoto (qcEngine.ts:194) deletes evidence; keep it to the
    -- uploader or an admin so one operator cannot erase another's proof.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = b || ': owner or admin can delete'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON storage.objects FOR DELETE TO authenticated USING (bucket_id = %L AND (owner = auth.uid() OR public.is_admin_or_super()))',
        b || ': owner or admin can delete', b
      );
    END IF;
  END LOOP;
END $$;
