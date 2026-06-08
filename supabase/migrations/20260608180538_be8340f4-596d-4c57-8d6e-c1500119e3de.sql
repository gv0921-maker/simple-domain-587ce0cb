DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema='public'
      AND is_nullable='NO'
      AND table_name IN ('sales_orders','quotations','order_lines','quotation_lines','order_activities')
      AND column_name IN ('invoice_id','invoice_ids','payment_id','payment_ids','delivery_id','delivery_ids')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', r.table_name, r.column_name);
    RAISE NOTICE 'Dropped NOT NULL on %.%', r.table_name, r.column_name;
  END LOOP;
END $$;