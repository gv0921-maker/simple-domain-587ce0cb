-- =====================================================================
-- INVENTORY RESET - STEP 4 PART 2: seed one realistic GLF goods receipt
-- =====================================================================
--
-- PERSISTED. This is not a test fixture - it is the first real data in the
-- new module, and it exists so the pages have something true to render.
--
-- THE POINT: every unit, ledger row and move line here is written by the
-- sanctioned functions. Nothing INSERTs into inv_stock_item,
-- inv_stock_tracking or inv_move_line directly. If this file runs, the
-- workflow works.
--
--   inv_allocate_document_number  -> document numbers
--   inv_receive_serial            -> units + ledger + move lines
--   inv_record_qc_results         -> QC results + status promotion
--   inv_complete_receipt          -> move/operation state + PO progress
--
-- Shape follows docs/inventory-preserved/05_config_data.sql (names, codes,
-- location tree, FY 2627 numbering) but creates FRESH inv_ rows. Nothing is
-- imported from the old tables.
--
-- Idempotent: re-running is a no-op. Guarded on the receipt number.
--
-- Touches inv_* only. `products` is read, never written. No CRM, no old module.
-- =====================================================================

BEGIN;

DO $seed$
DECLARE
  v_admin   uuid := '02fb2319-d5e3-4fb8-894e-40bacf614f3c';
  v_prod    uuid;
  v_wh      uuid; v_wh_fty uuid;
  v_sup uuid; v_stock uuid; v_godown uuid; v_cust uuid;
  v_loss uuid; v_scrap uuid; v_prodloc uuid; v_transit uuid;
  v_sq_rcp uuid; v_sq_int uuid; v_sq_out uuid; v_sq_adj uuid;
  v_ot_rcp uuid; v_ot_int uuid; v_ot_out uuid; v_ot_adj uuid;
  v_po uuid; v_op uuid; v_mv uuid;
  v_t_frame uuid; v_t_finish uuid; v_t_moist uuid; v_t_photo uuid; v_t_pack uuid;
  v_num text; v_ponum text;
  v_serial text; v_item uuid;
  v_items uuid[] := ARRAY[]::uuid[];
  i int;
  v_res jsonb;
BEGIN
  -- Act as the admin so can_write_inventory() passes and created_by resolves.
  PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_admin::text)::text, true);

  -- Already seeded? Stop.
  IF EXISTS (SELECT 1 FROM public.inv_operation WHERE number LIKE 'RCP/2627/%') THEN
    RAISE NOTICE 'Seed already present - nothing to do.';
    RETURN;
  END IF;

  SELECT id INTO v_prod FROM public.products ORDER BY created_at LIMIT 1;
  IF v_prod IS NULL THEN
    RAISE EXCEPTION 'No product exists to receive.';
  END IF;

  -- ---------------------------------------------------------- warehouses
  INSERT INTO public.inv_warehouse(code,name) VALUES ('GLF101','GLF')     RETURNING id INTO v_wh;
  INSERT INTO public.inv_warehouse(code,name) VALUES ('FTY102','FACTORY') RETURNING id INTO v_wh_fty;

  -- ------------------------------------------------------- location tree
  -- Counterparties
  INSERT INTO public.inv_location(warehouse_id,code,name,type,barcode)
    VALUES (v_wh,'VDR106','VENDORS','supplier','VDR106')      RETURNING id INTO v_sup;
  INSERT INTO public.inv_location(warehouse_id,code,name,type,barcode)
    VALUES (v_wh,'CTMR107','CUSTOMERS','customer','CTMR107')  RETURNING id INTO v_cust;
  INSERT INTO public.inv_location(warehouse_id,code,name,type,barcode)
    VALUES (v_wh,'DLV-ORD105','DELIVERY ORDER','transit','DLV-ORD105') RETURNING id INTO v_transit;

  -- Real stock
  INSERT INTO public.inv_location(warehouse_id,code,name,type,barcode)
    VALUES (v_wh,'STK103','STOCK','internal','STK103')        RETURNING id INTO v_stock;
  INSERT INTO public.inv_location(warehouse_id,parent_id,code,name,type,barcode)
    VALUES (v_wh,v_stock,'GDN110','GODOWN','internal','GDN110') RETURNING id INTO v_godown;

  -- Virtual counterparties an adjustment must cite
  INSERT INTO public.inv_location(warehouse_id,code,name,type)
    VALUES (v_wh,'LOSS112','INVENTORY LOSS','inventory_loss') RETURNING id INTO v_loss;
  INSERT INTO public.inv_location(warehouse_id,code,name,type)
    VALUES (v_wh,'SCRP113','SCRAP','scrap')                   RETURNING id INTO v_scrap;
  INSERT INTO public.inv_location(warehouse_id,code,name,type,barcode)
    VALUES (v_wh_fty,'FTY104','FACTORY','production','FTY104') RETURNING id INTO v_prodloc;

  -- ---------------------------------------------------------- sequences
  INSERT INTO public.inv_number_sequence(document_type,prefix,fy_label,padding,separator)
    VALUES ('receipt','RCP','2627',4,'/')    RETURNING id INTO v_sq_rcp;
  INSERT INTO public.inv_number_sequence(document_type,prefix,fy_label,padding,separator)
    VALUES ('internal','INT','2627',4,'/')   RETURNING id INTO v_sq_int;
  INSERT INTO public.inv_number_sequence(document_type,prefix,fy_label,padding,separator)
    VALUES ('outgoing','DEL','2627',4,'/')   RETURNING id INTO v_sq_out;
  INSERT INTO public.inv_number_sequence(document_type,prefix,fy_label,padding,separator)
    VALUES ('adjustment','ADJ','2627',4,'/') RETURNING id INTO v_sq_adj;
  INSERT INTO public.inv_number_sequence(document_type,prefix,fy_label,padding,separator)
    VALUES ('purchase_order','PO','2627',4,'/');

  -- ----------------------------------------------------- operation types
  -- GOODS RECEIVED locks its destination: staff cannot re-point it.
  INSERT INTO public.inv_operation_type(
      name,kind,sequence_id,default_source_location_id,default_dest_location_id,
      locks_destination,mandatory_scan_product,mandatory_scan_serial,print_labels)
    VALUES ('GOODS RECEIVED','receipt',v_sq_rcp,v_sup,v_godown,
            true,true,true,true) RETURNING id INTO v_ot_rcp;

  INSERT INTO public.inv_operation_type(
      name,kind,sequence_id,default_source_location_id,default_dest_location_id)
    VALUES ('ITEM ESTIMATE','internal',v_sq_int,v_stock,v_transit) RETURNING id INTO v_ot_int;

  INSERT INTO public.inv_operation_type(
      name,kind,sequence_id,default_source_location_id,default_dest_location_id)
    VALUES ('DELIVERY NOTE','outgoing',v_sq_out,v_transit,v_cust) RETURNING id INTO v_ot_out;

  INSERT INTO public.inv_operation_type(
      name,kind,sequence_id,default_source_location_id,default_dest_location_id)
    VALUES ('STOCK ADJUSTMENT','adjustment',v_sq_adj,v_loss,v_stock) RETURNING id INTO v_ot_adj;

  -- -------------------------------------------------------- QC checklist
  INSERT INTO public.inv_test_template(product_id,name,description,is_required,sort_order)
    VALUES (v_prod,'Frame integrity','Joints tight, no splits or warping.',true,10)
    RETURNING id INTO v_t_frame;
  INSERT INTO public.inv_test_template(product_id,name,description,is_required,sort_order)
    VALUES (v_prod,'Finish quality','Even polish, no scratches or bubbling.',true,20)
    RETURNING id INTO v_t_finish;
  INSERT INTO public.inv_test_template(product_id,name,description,is_required,requires_value,sort_order)
    VALUES (v_prod,'Moisture content','Meter reading, must be under 12%.',true,true,30)
    RETURNING id INTO v_t_moist;
  INSERT INTO public.inv_test_template(product_id,name,description,is_required,requires_attachment,sort_order)
    VALUES (v_prod,'Condition photo','Photograph of the unit as received.',false,true,40)
    RETURNING id INTO v_t_photo;
  INSERT INTO public.inv_test_template(product_id,name,description,is_required,sort_order)
    VALUES (v_prod,'Packaging cosmetic','Carton undamaged. Advisory only.',false,50)
    RETURNING id INTO v_t_pack;

  -- ----------------------------------------------------- purchase order
  -- ONE line: this database holds exactly one product, and Migration A forbids
  -- two lines for the same product on one order.
  v_ponum := public.inv_allocate_document_number('purchase_order','2627');
  INSERT INTO public.inv_purchase_order(number,state,ordered_at,expected_at,created_by,notes)
    VALUES (v_ponum,'confirmed', now() - interval '9 days', now() - interval '2 days', v_admin,
            'Dining chair restock ahead of the festive season.')
    RETURNING id INTO v_po;

  INSERT INTO public.inv_purchase_order_line(order_id,product_id,ordered_qty,notes)
    VALUES (v_po,v_prod,10,'Teak finish, standard size.');

  -- ---------------------------------------------------------- the receipt
  -- Destination GODOWN, deliberately NOT stock: the old module ignored the
  -- document destination and routed everything to STOCK regardless.
  v_num := public.inv_allocate_document_number('receipt','2627');
  INSERT INTO public.inv_operation(
      number,operation_type_id,state,source_location_id,dest_location_id,
      partner_vendor_id,source_purchase_order_id,source_document,
      scheduled_at,created_by,notes)
    VALUES (v_num,v_ot_rcp,'ready',v_sup,v_godown,
            NULL,v_po,v_ponum,
            now() - interval '2 days', v_admin,
            'Vendor delivered 12 against an order for 10. Over-receipt accepted and recorded.')
    RETURNING id INTO v_op;

  INSERT INTO public.inv_move(operation_id,product_id,demand_qty,state)
    VALUES (v_op,v_prod,10,'assigned') RETURNING id INTO v_mv;

  -- ------------------------------------------------- receive 12 serials
  -- Over-receipt: 12 arrived against an order for 10.
  FOR i IN 1..12 LOOP
    v_serial := '101205-2627-' || lpad(i::text,4,'0');
    v_item := public.inv_receive_serial(v_mv, v_serial, 4250.00);
    v_items := v_items || v_item;
  END LOOP;

  -- ------------------------------------------------------------- QC pass
  -- Units 1-3: everything required passes, advisories pass -> ok (sellable)
  FOR i IN 1..3 LOOP
    PERFORM public.inv_record_qc_results(v_items[i], jsonb_build_array(
      jsonb_build_object('template_id',v_t_frame ,'result',true),
      jsonb_build_object('template_id',v_t_finish,'result',true),
      jsonb_build_object('template_id',v_t_moist ,'result',true,'value','9.4%'),
      jsonb_build_object('template_id',v_t_photo ,'result',true,
        'attachments', jsonb_build_array(jsonb_build_object(
          'name','received-'||i||'.jpg','url','/qc/received-'||i||'.jpg'))),
      jsonb_build_object('template_id',v_t_pack  ,'result',true)));
  END LOOP;

  -- Units 4-5: required all pass, ADVISORY fails -> attention (sellable, flagged)
  FOR i IN 4..5 LOOP
    PERFORM public.inv_record_qc_results(v_items[i], jsonb_build_array(
      jsonb_build_object('template_id',v_t_frame ,'result',true),
      jsonb_build_object('template_id',v_t_finish,'result',true),
      jsonb_build_object('template_id',v_t_moist ,'result',true,'value','10.8%'),
      jsonb_build_object('template_id',v_t_pack  ,'result',false,
        'notes','Carton crushed on one corner. Unit itself undamaged.')));
  END LOOP;

  -- Units 6-7: a REQUIRED test fails -> rejected (not sellable)
  PERFORM public.inv_record_qc_results(v_items[6], jsonb_build_array(
    jsonb_build_object('template_id',v_t_frame ,'result',true),
    jsonb_build_object('template_id',v_t_finish,'result',false,
      'notes','Polish bubbling along the front rail.'),
    jsonb_build_object('template_id',v_t_moist ,'result',true,'value','11.2%')));

  PERFORM public.inv_record_qc_results(v_items[7], jsonb_build_array(
    jsonb_build_object('template_id',v_t_frame ,'result',false,
      'notes','Back joint loose, frame flexes under load.'),
    jsonb_build_object('template_id',v_t_finish,'result',true),
    jsonb_build_object('template_id',v_t_moist ,'result',true,'value','13.6%')));

  -- Unit 8: partially inspected - one required test still unanswered
  --         -> stays quarantined, which is the honest state
  PERFORM public.inv_record_qc_results(v_items[8], jsonb_build_array(
    jsonb_build_object('template_id',v_t_frame ,'result',true)));

  -- Units 9-12: not inspected at all -> quarantined

  -- ------------------------------------------------------------ complete
  v_res := public.inv_complete_receipt(v_op);
  RAISE NOTICE 'Receipt completed: %', v_res;
END $seed$;

COMMIT;
