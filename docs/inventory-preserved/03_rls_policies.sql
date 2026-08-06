-- GLF inventory module - row level security policies
-- Captured from the live database before the inventory reset.
-- Tag: pre-inventory-reset (a0bdb09). Verbatim catalog output.

ALTER TABLE public.adjustment_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY adjustment_lines_delete_admin ON public.adjustment_lines AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.adjustment_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY adjustment_lines_insert_admin ON public.adjustment_lines AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

ALTER TABLE public.adjustment_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY adjustment_lines_select_all ON public.adjustment_lines AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.adjustment_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY adjustment_lines_update_admin ON public.adjustment_lines AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER TABLE public.correction_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coi insert" ON public.correction_order_items AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.correction_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coi select" ON public.correction_order_items AS PERMISSIVE FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['sales_rep'::app_role, 'sales_manager'::app_role, 'warehouse_operator'::app_role, 'accountant'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.correction_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coi update" ON public.correction_order_items AS PERMISSIVE FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'admin'::app_role, 'super_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.correction_order_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cor delete" ON public.correction_order_refunds AS PERMISSIVE FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));

ALTER TABLE public.correction_order_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cor insert" ON public.correction_order_refunds AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.correction_order_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cor select" ON public.correction_order_refunds AS PERMISSIVE FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'accountant'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.correction_order_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cor update" ON public.correction_order_refunds AS PERMISSIVE FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

ALTER TABLE public.correction_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "co insert" ON public.correction_orders AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.correction_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "co select" ON public.correction_orders AS PERMISSIVE FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['sales_rep'::app_role, 'sales_manager'::app_role, 'warehouse_operator'::app_role, 'accountant'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.correction_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "co update" ON public.correction_orders AS PERMISSIVE FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'admin'::app_role, 'super_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.correction_qc_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cqc insert" ON public.correction_qc_cycles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.correction_qc_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cqc select" ON public.correction_qc_cycles AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.delivery_note_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY dnl_delete_admin ON public.delivery_note_lines AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.delivery_note_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY dnl_select_via_delivery_note ON public.delivery_note_lines AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM delivery_notes d
  WHERE (d.id = delivery_note_lines.delivery_note_id))));

ALTER TABLE public.delivery_note_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY dnl_update_warehouse ON public.delivery_note_lines AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_write_inventory())
  WITH CHECK (can_write_inventory());

ALTER TABLE public.delivery_note_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY dnl_write_warehouse ON public.delivery_note_lines AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_write_inventory());

ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators can create delivery notes" ON public.delivery_notes AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_write_inventory());

ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators can update delivery notes" ON public.delivery_notes AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_write_inventory())
  WITH CHECK (can_write_inventory());

ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_notes_no_delete ON public.delivery_notes AS PERMISSIVE FOR DELETE TO authenticated
  USING (false);

ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_notes_select ON public.delivery_notes AS PERMISSIVE FOR SELECT TO authenticated
  USING ((_can_see_all_sales() OR has_role(auth.uid(), 'warehouse_operator'::app_role) OR (EXISTS ( SELECT 1
   FROM sales_orders so
  WHERE ((so.id = delivery_notes.sales_order_id) AND (is_sales_rep_for_record(so.salesperson_id) OR (so.created_by = auth.uid())))))));

ALTER TABLE public.factory_inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY fii_delete_admin ON public.factory_inventory_items AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.factory_inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY fii_insert_admin ON public.factory_inventory_items AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

ALTER TABLE public.factory_inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY fii_select ON public.factory_inventory_items AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_admin() OR has_role(auth.uid(), 'factory_incharge'::app_role)));

ALTER TABLE public.factory_inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY fii_update_admin ON public.factory_inventory_items AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER TABLE public.factory_stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY fsm_insert ON public.factory_stock_movements AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_admin() OR has_role(auth.uid(), 'factory_incharge'::app_role)));

ALTER TABLE public.factory_stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY fsm_select ON public.factory_stock_movements AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_admin() OR has_role(auth.uid(), 'factory_incharge'::app_role)));

ALTER TABLE public.factory_user_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY factory_assignments_select ON public.factory_user_assignments AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR is_admin_or_super()));

ALTER TABLE public.factory_user_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY factory_assignments_write ON public.factory_user_assignments AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

ALTER TABLE public.goods_receipt_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY grl_select_auth ON public.goods_receipt_lines AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.goods_receipt_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY grl_write_warehouse ON public.goods_receipt_lines AS PERMISSIVE FOR ALL TO authenticated
  USING (can_write_inventory())
  WITH CHECK (can_write_inventory());

ALTER TABLE public.goods_receipt_serials ENABLE ROW LEVEL SECURITY;
CREATE POLICY grs_select_auth ON public.goods_receipt_serials AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.goods_receipt_serials ENABLE ROW LEVEL SECURITY;
CREATE POLICY grs_write_warehouse ON public.goods_receipt_serials AS PERMISSIVE FOR ALL TO authenticated
  USING (can_write_inventory())
  WITH CHECK (can_write_inventory());

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY gr_delete_admin ON public.goods_receipts AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY gr_insert_warehouse ON public.goods_receipts AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_write_inventory());

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY gr_select_auth ON public.goods_receipts AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY gr_update_warehouse ON public.goods_receipts AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_write_inventory())
  WITH CHECK (can_write_inventory());

ALTER TABLE public.internal_movement_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY imi_delete ON public.internal_movement_items AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_admin() OR has_role(auth.uid(), 'warehouse_operator'::app_role)));

ALTER TABLE public.internal_movement_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY imi_insert ON public.internal_movement_items AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_admin() OR has_role(auth.uid(), 'warehouse_operator'::app_role)));

ALTER TABLE public.internal_movement_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY imi_select_via_parent ON public.internal_movement_items AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM internal_movements m
  WHERE ((m.id = internal_movement_items.internal_movement_id) AND (is_admin() OR can_write_inventory())))));

ALTER TABLE public.internal_movement_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY imi_update ON public.internal_movement_items AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_admin() OR has_role(auth.uid(), 'warehouse_operator'::app_role)));

ALTER TABLE public.internal_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY im_delete ON public.internal_movements AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.internal_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY im_insert ON public.internal_movements AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_admin() OR has_role(auth.uid(), 'warehouse_operator'::app_role)));

ALTER TABLE public.internal_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY im_select ON public.internal_movements AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_admin() OR has_role(auth.uid(), 'warehouse_operator'::app_role) OR has_role(auth.uid(), 'sales_rep'::app_role) OR has_role(auth.uid(), 'sales_manager'::app_role)));

ALTER TABLE public.internal_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY im_update ON public.internal_movements AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_admin() OR (created_by = auth.uid())));

ALTER TABLE public.internal_transfer_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ITO lines delete" ON public.internal_transfer_order_lines AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.internal_transfer_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ITO lines insert" ON public.internal_transfer_order_lines AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_write_inventory());

ALTER TABLE public.internal_transfer_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ITO lines select" ON public.internal_transfer_order_lines AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_admin() OR has_role(auth.uid(), 'warehouse_operator'::app_role) OR has_role(auth.uid(), 'sales_manager'::app_role) OR has_role(auth.uid(), 'sales_rep'::app_role)));

ALTER TABLE public.internal_transfer_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ITO lines update" ON public.internal_transfer_order_lines AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_write_inventory())
  WITH CHECK (can_write_inventory());

ALTER TABLE public.internal_transfer_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ITO delete for admin" ON public.internal_transfer_orders AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.internal_transfer_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ITO insert for warehouse + admin + creator" ON public.internal_transfer_orders AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_write_inventory());

ALTER TABLE public.internal_transfer_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ITO select for sales_rep + warehouse + admin" ON public.internal_transfer_orders AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_admin() OR has_role(auth.uid(), 'warehouse_operator'::app_role) OR has_role(auth.uid(), 'sales_manager'::app_role) OR has_role(auth.uid(), 'sales_rep'::app_role)));

ALTER TABLE public.internal_transfer_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ITO update for warehouse + admin" ON public.internal_transfer_orders AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_write_inventory())
  WITH CHECK (can_write_inventory());

ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_adjustments_delete_admin ON public.inventory_adjustments AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_adjustments_insert_admin ON public.inventory_adjustments AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_adjustments_select_all ON public.inventory_adjustments AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_adjustments_update_admin ON public.inventory_adjustments AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER TABLE public.label_prints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Warehouse+admins can insert label_prints" ON public.label_prints AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_write_inventory());

ALTER TABLE public.label_prints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Warehouse+admins can read label_prints" ON public.label_prints AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_write_inventory());

ALTER TABLE public.label_prints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Warehouse+admins can update label_prints" ON public.label_prints AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_write_inventory())
  WITH CHECK (can_write_inventory());

ALTER TABLE public.lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY lots_delete_admin ON public.lots AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY lots_insert_admin ON public.lots AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

ALTER TABLE public.lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY lots_select_all ON public.lots AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY lots_update_admin ON public.lots AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER TABLE public.numbering_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read numbering sequences" ON public.numbering_sequences AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.numbering_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read numbering settings" ON public.numbering_settings AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.numbering_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Only super admins can modify numbering settings" ON public.numbering_settings AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

ALTER TABLE public.operation_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY ot_delete_admin ON public.operation_types AS PERMISSIVE FOR DELETE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.operation_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY ot_insert_admin ON public.operation_types AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.operation_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY ot_select_auth ON public.operation_types AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.operation_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY ot_update_admin ON public.operation_types AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.product_attribute_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY paa_delete_admin ON public.product_attribute_assignments AS PERMISSIVE FOR DELETE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.product_attribute_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY paa_insert_admin ON public.product_attribute_assignments AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.product_attribute_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY paa_select_auth ON public.product_attribute_assignments AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.product_attribute_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY paa_update_admin ON public.product_attribute_assignments AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.product_attribute_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY av_delete_admin ON public.product_attribute_values AS PERMISSIVE FOR DELETE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.product_attribute_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY av_insert_admin ON public.product_attribute_values AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.product_attribute_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY av_select_auth ON public.product_attribute_values AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.product_attribute_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY av_update_admin ON public.product_attribute_values AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;
CREATE POLICY attr_delete_admin ON public.product_attributes AS PERMISSIVE FOR DELETE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;
CREATE POLICY attr_insert_admin ON public.product_attributes AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;
CREATE POLICY attr_select_auth ON public.product_attributes AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;
CREATE POLICY attr_update_admin ON public.product_attributes AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY cat_delete_admin ON public.product_categories AS PERMISSIVE FOR DELETE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY cat_insert_admin ON public.product_categories AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY cat_select_auth ON public.product_categories AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY cat_update_admin ON public.product_categories AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.product_customization_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY pco_admin_delete ON public.product_customization_options AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.product_customization_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY pco_admin_insert ON public.product_customization_options AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

ALTER TABLE public.product_customization_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY pco_admin_update ON public.product_customization_options AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER TABLE public.product_customization_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY pco_select_authenticated ON public.product_customization_options AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_insert_admin ON public.products AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_no_delete ON public.products AS PERMISSIVE FOR DELETE TO authenticated
  USING (false);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_select_all ON public.products AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_update_admin ON public.products AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER TABLE public.qc_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY qc_inspections_delete_warehouse ON public.qc_inspections AS PERMISSIVE FOR DELETE TO authenticated
  USING (can_write_inventory());

ALTER TABLE public.qc_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY qc_inspections_insert_warehouse ON public.qc_inspections AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_write_inventory());

ALTER TABLE public.qc_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY qc_inspections_select_auth ON public.qc_inspections AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.qc_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY qc_inspections_update_warehouse ON public.qc_inspections AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_write_inventory())
  WITH CHECK (can_write_inventory());

ALTER TABLE public.reorder_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY reorder_rules_delete_admin ON public.reorder_rules AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.reorder_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY reorder_rules_insert_admin ON public.reorder_rules AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

ALTER TABLE public.reorder_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY reorder_rules_select_all ON public.reorder_rules AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.reorder_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY reorder_rules_update_admin ON public.reorder_rules AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER TABLE public.scan_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "All authenticated can read scan_queue" ON public.scan_queue AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.scan_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Warehouse+admins can insert scan_queue" ON public.scan_queue AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_write_inventory());

ALTER TABLE public.scan_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Warehouse+admins can update scan_queue" ON public.scan_queue AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_write_inventory())
  WITH CHECK (can_write_inventory());

ALTER TABLE public.scan_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "All authenticated can read scan_records" ON public.scan_records AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.scan_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Warehouse+admins can insert scan_records" ON public.scan_records AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_write_inventory());

ALTER TABLE public.scan_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Warehouse+admins can update scan_records" ON public.scan_records AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_write_inventory())
  WITH CHECK (can_write_inventory());

ALTER TABLE public.serial_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "counters read auth" ON public.serial_counters AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.serial_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY serial_numbers_delete_admin ON public.serial_numbers AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.serial_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY serial_numbers_insert_admin ON public.serial_numbers AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

ALTER TABLE public.serial_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY serial_numbers_select_all ON public.serial_numbers AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.serial_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY serial_numbers_update_admin ON public.serial_numbers AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_count_items_delete_admin ON public.stock_count_items AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_count_items_insert ON public.stock_count_items AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'sales_manager'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_count_items_select ON public.stock_count_items AS PERMISSIVE FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'sales_rep'::app_role, 'sales_manager'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_count_items_update ON public.stock_count_items AS PERMISSIVE FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'sales_manager'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_counts_delete_admin ON public.stock_counts AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_counts_insert ON public.stock_counts AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'sales_manager'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_counts_select ON public.stock_counts AS PERMISSIVE FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'sales_rep'::app_role, 'sales_manager'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_counts_update ON public.stock_counts AS PERMISSIVE FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['warehouse_operator'::app_role, 'sales_manager'::app_role, 'admin'::app_role, 'super_admin'::app_role]));

ALTER TABLE public.stock_move_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_move_lines_delete_admin ON public.stock_move_lines AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.stock_move_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_move_lines_insert_admin ON public.stock_move_lines AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

ALTER TABLE public.stock_move_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_move_lines_select_all ON public.stock_move_lines AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.stock_move_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_move_lines_update_admin ON public.stock_move_lines AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER TABLE public.stock_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_moves_delete_admin ON public.stock_moves AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.stock_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_moves_insert_admin ON public.stock_moves AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

ALTER TABLE public.stock_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_moves_select_all ON public.stock_moves AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.stock_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_moves_update_admin ON public.stock_moves AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_reservations_delete_admin ON public.stock_reservations AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_reservations_insert_scoped ON public.stock_reservations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((reserved_by = auth.uid()) AND (is_admin() OR can_write_inventory() OR has_any_role(auth.uid(), ARRAY['sales_manager'::app_role, 'sales_rep'::app_role]))));

ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_reservations_select_scoped ON public.stock_reservations AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_admin() OR can_write_inventory() OR has_any_role(auth.uid(), ARRAY['sales_manager'::app_role, 'sales_rep'::app_role, 'warehouse_operator'::app_role, 'factory_incharge'::app_role]) OR (reserved_by = auth.uid())));

ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_reservations_update_warehouse ON public.stock_reservations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_write_inventory())
  WITH CHECK (can_write_inventory());

ALTER TABLE public.transfer_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfer_lines_delete_admin ON public.transfer_lines AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.transfer_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfer_lines_insert_admin ON public.transfer_lines AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

ALTER TABLE public.transfer_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfer_lines_select_all ON public.transfer_lines AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.transfer_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfer_lines_update_admin ON public.transfer_lines AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfers_delete_admin ON public.transfers AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfers_insert_admin ON public.transfers AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfers_select_all ON public.transfers AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfers_update_admin ON public.transfers AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;
CREATE POLICY uom_delete_admin ON public.units_of_measure AS PERMISSIVE FOR DELETE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;
CREATE POLICY uom_insert_admin ON public.units_of_measure AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;
CREATE POLICY uom_select_auth ON public.units_of_measure AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;
CREATE POLICY uom_update_admin ON public.units_of_measure AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

ALTER TABLE public.warehouse_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY warehouse_locations_delete_admin ON public.warehouse_locations AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.warehouse_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY warehouse_locations_insert_admin ON public.warehouse_locations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

ALTER TABLE public.warehouse_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY warehouse_locations_select_all ON public.warehouse_locations AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.warehouse_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY warehouse_locations_update_admin ON public.warehouse_locations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY warehouses_delete_admin ON public.warehouses AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY warehouses_insert_admin ON public.warehouses AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY warehouses_select_all ON public.warehouses AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY warehouses_update_admin ON public.warehouses AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER TABLE public.write_off_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY wfi_modify_draft_role ON public.write_off_items AS PERMISSIVE FOR ALL TO authenticated
  USING (((can_write_inventory() OR is_admin()) AND (EXISTS ( SELECT 1
   FROM write_off_records r
  WHERE ((r.id = write_off_items.write_off_record_id) AND (r.status = 'draft'::text))))))
  WITH CHECK (((can_write_inventory() OR is_admin()) AND (EXISTS ( SELECT 1
   FROM write_off_records r
  WHERE ((r.id = write_off_items.write_off_record_id) AND (r.status = 'draft'::text))))));

ALTER TABLE public.write_off_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY wfi_select_inv ON public.write_off_items AS PERMISSIVE FOR SELECT TO authenticated
  USING ((can_write_inventory() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role])));

ALTER TABLE public.write_off_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY wf_delete_super ON public.write_off_records AS PERMISSIVE FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));

ALTER TABLE public.write_off_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY wf_insert_inv ON public.write_off_records AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((can_write_inventory() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role])));

ALTER TABLE public.write_off_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY wf_select_inv ON public.write_off_records AS PERMISSIVE FOR SELECT TO authenticated
  USING ((can_write_inventory() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role])));

ALTER TABLE public.write_off_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY wf_update_draft_owner_or_super ON public.write_off_records AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((status = 'draft'::text) AND ((created_by = auth.uid()) OR has_role(auth.uid(), 'super_admin'::app_role))) OR has_role(auth.uid(), 'super_admin'::app_role)));
