-- GLF inventory module - table definitions (columns + defaults)
-- Captured from the live database before the inventory reset.
-- Tag: pre-inventory-reset (a0bdb09). Verbatim catalog output.

CREATE TABLE public.adjustment_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    adjustment_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_name text NOT NULL,
    product_sku text NOT NULL,
    theoretical_qty numeric(14,3) DEFAULT 0 NOT NULL,
    counted_qty numeric(14,3) DEFAULT 0 NOT NULL,
    difference numeric(14,3) DEFAULT 0 NOT NULL,
    lot_id uuid,
    serial_numbers text[] DEFAULT '{}'::text[] NOT NULL,
    unit_cost numeric(14,2) DEFAULT 0 NOT NULL,
    value_difference numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.correction_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    correction_order_id uuid NOT NULL,
    goods_receipt_serial_id uuid NOT NULL,
    product_id uuid NOT NULL,
    serial_number text NOT NULL,
    original_qc_notes text,
    original_qc_images jsonb DEFAULT '[]'::jsonb NOT NULL,
    latest_qc_status text DEFAULT 'failed'::text NOT NULL,
    latest_qc_cycle integer DEFAULT 1 NOT NULL,
    current_status text DEFAULT 'awaiting_correction'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.correction_order_refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    correction_order_id uuid NOT NULL,
    correction_order_item_id uuid NOT NULL,
    refund_amount numeric NOT NULL,
    refund_received_date date NOT NULL,
    refund_method text,
    refund_reference text,
    refund_account_id uuid,
    notes text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.correction_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    co_number text NOT NULL,
    source_type text NOT NULL,
    source_document_id uuid,
    source_document_reference text,
    addressed_to_type text NOT NULL,
    addressed_to_id uuid,
    addressed_to_name text,
    correction_type text DEFAULT 'replace'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    notes text,
    created_by uuid,
    sent_at timestamp with time zone,
    closed_at timestamp with time zone,
    closed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.correction_qc_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    correction_order_item_id uuid NOT NULL,
    cycle_number integer NOT NULL,
    qc_status text NOT NULL,
    qc_notes text,
    qc_images jsonb DEFAULT '[]'::jsonb NOT NULL,
    qc_checked_by uuid NOT NULL,
    qc_checked_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.delivery_note_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    delivery_note_id uuid NOT NULL,
    invoice_line_id uuid,
    product_id uuid,
    product_name text,
    quantity_from_invoice_line numeric DEFAULT 0 NOT NULL,
    serial_numbers jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.delivery_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference text,
    sales_order_id uuid,
    invoice_id uuid,
    warehouse_id uuid,
    customer_id uuid,
    delivery_date timestamp with time zone,
    status text DEFAULT 'draft'::text NOT NULL,
    created_by uuid,
    qc_by uuid,
    products_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    customer_delivery_name text,
    customer_delivery_address text,
    customer_delivery_phone text,
    signature_collected boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_partial boolean DEFAULT false NOT NULL,
    dn_sequence_in_invoice integer DEFAULT 1 NOT NULL,
    customer_signature_received boolean DEFAULT false NOT NULL,
    customer_signature_date date,
    delivered_by_user_id uuid,
    dispatched_at timestamp with time zone,
    delivered_at timestamp with time zone,
    operation_type_id uuid,
    source_location_id uuid,
    dest_location_id uuid
);

CREATE TABLE public.factory_inventory_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    category text,
    unit_of_measurement text NOT NULL,
    description text,
    image_url text,
    current_stock numeric DEFAULT 0 NOT NULL,
    min_stock_level numeric DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.factory_stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    factory_inventory_item_id uuid NOT NULL,
    movement_type text NOT NULL,
    quantity numeric NOT NULL,
    related_work_order_id uuid,
    notes text,
    recorded_by uuid,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.factory_user_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    factory_id uuid NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by uuid
);

CREATE TABLE public.goods_receipt_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    goods_receipt_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_name_cached text,
    product_sku_cached text,
    expected_quantity integer DEFAULT 0 NOT NULL,
    received_quantity integer DEFAULT 0 NOT NULL,
    accepted_quantity integer DEFAULT 0 NOT NULL,
    under_correction_quantity integer DEFAULT 0 NOT NULL,
    rejected_quantity integer DEFAULT 0 NOT NULL,
    source_line_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.goods_receipt_serials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    goods_receipt_id uuid NOT NULL,
    goods_receipt_line_id uuid NOT NULL,
    product_id uuid NOT NULL,
    serial_number text NOT NULL,
    barcode_value text NOT NULL,
    qc_status text DEFAULT 'pending'::text NOT NULL,
    qc_notes text,
    qc_images jsonb DEFAULT '[]'::jsonb NOT NULL,
    qc_checked_by uuid,
    qc_checked_at timestamp with time zone,
    stock_status text DEFAULT 'pending'::text NOT NULL,
    current_warehouse_id uuid,
    current_location text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reserved_for_so_id uuid
);

CREATE TABLE public.goods_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gr_number text,
    source_type text DEFAULT 'manual'::text NOT NULL,
    source_document_id uuid,
    source_document_reference text,
    status text DEFAULT 'draft'::text NOT NULL,
    discrepancy_status text DEFAULT 'matched'::text NOT NULL,
    discrepancy_approved_by uuid,
    discrepancy_approved_at timestamp with time zone,
    discrepancy_reason text,
    labels_generated boolean DEFAULT false NOT NULL,
    labels_generated_at timestamp with time zone,
    warehouse_id uuid,
    received_by uuid,
    received_at timestamp with time zone,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    operation_type_id uuid,
    source_location_id uuid,
    dest_location_id uuid
);

CREATE TABLE public.internal_movement_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    internal_movement_id uuid NOT NULL,
    goods_receipt_serial_id uuid NOT NULL,
    product_id uuid NOT NULL,
    serial_number text NOT NULL,
    scanned_at_source boolean DEFAULT false NOT NULL,
    scanned_at_destination boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.internal_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    movement_number text NOT NULL,
    movement_type text NOT NULL,
    from_location_type text,
    from_location_id uuid,
    to_location_type text,
    to_location_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    reason text,
    notes text,
    created_by uuid,
    completed_by uuid,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    operation_type_id uuid
);

CREATE TABLE public.internal_transfer_order_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    internal_transfer_order_id uuid NOT NULL,
    sales_order_line_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_source text NOT NULL,
    quantity_expected integer NOT NULL,
    quantity_scanned integer DEFAULT 0 NOT NULL,
    line_status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.internal_transfer_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ito_number text NOT NULL,
    sales_order_id uuid NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    confirmed_by uuid,
    confirmed_at timestamp with time zone,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    operation_type_id uuid,
    source_location_id uuid,
    dest_location_id uuid
);

CREATE TABLE public.inventory_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference text NOT NULL,
    location_id uuid,
    location_name text,
    reason text DEFAULT 'count'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    notes text,
    created_by text,
    approved_by text,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.label_prints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    serial_number text NOT NULL,
    barcode_value text NOT NULL,
    label_format text DEFAULT 'standard'::text NOT NULL,
    printed_by uuid,
    printed_at timestamp with time zone DEFAULT now() NOT NULL,
    goods_receipt_id uuid,
    print_count integer DEFAULT 1 NOT NULL
);

CREATE TABLE public.lots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    name text NOT NULL,
    quantity numeric(14,3) DEFAULT 0 NOT NULL,
    manufacturing_date date,
    expiration_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.numbering_sequences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_type text NOT NULL,
    fy_label text NOT NULL,
    last_number integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.numbering_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fy_start_month integer DEFAULT 4 NOT NULL,
    fy_start_day integer DEFAULT 1 NOT NULL,
    prefix_separator text DEFAULT '-'::text NOT NULL,
    sequential_padding integer DEFAULT 4 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);

CREATE TABLE public.operation_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    operation_kind text NOT NULL,
    sequence_prefix text,
    default_source_location_id uuid,
    default_dest_location_id uuid,
    create_backorder text DEFAULT 'ask'::text,
    use_existing_lots boolean DEFAULT true,
    create_new_lots boolean DEFAULT true,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    card_color text DEFAULT 'gray'::text,
    returns_operation_type_id uuid,
    print_delivery_slip boolean DEFAULT false,
    print_product_labels boolean DEFAULT false,
    print_lot_serial_labels boolean DEFAULT false,
    mandatory_scan_product boolean DEFAULT false,
    mandatory_scan_lot_serial boolean DEFAULT false,
    allow_extra_products boolean DEFAULT true,
    barcode text,
    print_return_slip boolean DEFAULT false,
    show_reserved_lots boolean DEFAULT true,
    mandatory_scan_dest_location boolean DEFAULT false,
    allow_full_picking_validation boolean DEFAULT false,
    force_dest_all_products boolean DEFAULT false,
    sequence_fy_label text,
    sequence_current_number integer DEFAULT 0 NOT NULL,
    sequence_padding integer,
    sequence_separator text,
    owns_sequence boolean DEFAULT false NOT NULL
);

CREATE TABLE public.product_attribute_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    attribute_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.product_attribute_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attribute_id uuid NOT NULL,
    value text NOT NULL,
    extra_price numeric DEFAULT 0 NOT NULL,
    color_hex text,
    sort_order integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.product_attributes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    display_type text DEFAULT 'radio'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.product_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    parent_category_id uuid,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.product_customization_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    option_type text NOT NULL,
    option_value text NOT NULL,
    additional_price numeric DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'stockable'::text NOT NULL,
    category text DEFAULT ''::text NOT NULL,
    unit_of_measure text DEFAULT 'unit'::text NOT NULL,
    cost_method text DEFAULT 'average'::text NOT NULL,
    cost_price numeric(14,2) DEFAULT 0 NOT NULL,
    sale_price numeric(14,2) DEFAULT 0 NOT NULL,
    stock_on_hand numeric(14,3) DEFAULT 0 NOT NULL,
    reorder_level numeric(14,3) DEFAULT 0 NOT NULL,
    barcode text,
    barcodes text[] DEFAULT '{}'::text[] NOT NULL,
    track_inventory boolean DEFAULT true NOT NULL,
    track_lots boolean DEFAULT false NOT NULL,
    track_serials boolean DEFAULT false NOT NULL,
    variants jsonb DEFAULT '[]'::jsonb NOT NULL,
    default_location_id uuid,
    weight numeric(14,3),
    volume numeric(14,3),
    description text,
    image_url text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    warranty_eligible boolean DEFAULT false NOT NULL,
    factory_eligible boolean DEFAULT false NOT NULL,
    discontinued_at timestamp with time zone,
    discontinuation_reason text,
    category_id uuid,
    uom_id uuid
);

CREATE TABLE public.qc_inspections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_type text NOT NULL,
    document_id uuid NOT NULL,
    document_line_id uuid,
    serial_number text,
    product_id uuid,
    qc_status text DEFAULT 'pending'::text NOT NULL,
    qc_notes text,
    photo_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    inspected_by uuid,
    inspected_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.reorder_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    location_id uuid,
    product_name text NOT NULL,
    warehouse_name text NOT NULL,
    min_qty numeric(14,3) DEFAULT 0 NOT NULL,
    max_qty numeric(14,3) DEFAULT 0 NOT NULL,
    reorder_qty numeric(14,3) DEFAULT 0 NOT NULL,
    lead_time_days integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_triggered timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.scan_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_type text NOT NULL,
    document_id uuid NOT NULL,
    document_reference text NOT NULL,
    expected_items_count integer DEFAULT 0 NOT NULL,
    scanned_items_count integer DEFAULT 0 NOT NULL,
    scan_status text DEFAULT 'pending'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    assigned_to uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.scan_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scan_queue_id uuid NOT NULL,
    barcode text NOT NULL,
    serial_number text,
    product_id uuid,
    scanned_by uuid,
    scanned_at timestamp with time zone DEFAULT now() NOT NULL,
    scan_result text DEFAULT 'valid'::text NOT NULL,
    notes text
);

CREATE TABLE public.serial_counters (
    prefix text NOT NULL,
    last_number integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.serial_numbers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    lot_id uuid,
    location_id uuid,
    name text NOT NULL,
    status text DEFAULT 'available'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.stock_count_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stock_count_id uuid NOT NULL,
    goods_receipt_serial_id uuid NOT NULL,
    product_id uuid NOT NULL,
    serial_number text NOT NULL,
    expected_location_type text,
    expected_warehouse_id uuid,
    scanned_at timestamp with time zone,
    scanned_by uuid,
    found_location_type text,
    found_warehouse_id uuid,
    count_status text DEFAULT 'expected'::text NOT NULL,
    discrepancy_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.stock_counts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    count_number text NOT NULL,
    count_period_month integer NOT NULL,
    count_period_year integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    count_type text DEFAULT 'full'::text NOT NULL,
    warehouse_id uuid,
    started_by uuid,
    started_at timestamp with time zone DEFAULT now(),
    completed_by uuid,
    completed_at timestamp with time zone,
    reconciled_by uuid,
    reconciled_at timestamp with time zone,
    skip_reason text,
    skip_approved_by uuid,
    skip_approved_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.stock_move_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stock_move_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_name text NOT NULL,
    product_sku text NOT NULL,
    demand_qty numeric(14,3) DEFAULT 0 NOT NULL,
    reserved_qty numeric(14,3) DEFAULT 0 NOT NULL,
    done_qty numeric(14,3) DEFAULT 0 NOT NULL,
    unit_of_measure text DEFAULT 'unit'::text NOT NULL,
    lot_id uuid,
    lot_name text,
    serial_numbers text[] DEFAULT '{}'::text[] NOT NULL,
    source_location_id uuid,
    destination_location_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.stock_moves (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference text NOT NULL,
    operation_type text NOT NULL,
    source_location_id uuid,
    source_location_name text,
    destination_location_id uuid,
    destination_location_name text,
    partner_id text,
    partner_name text,
    scheduled_date timestamp with time zone DEFAULT now() NOT NULL,
    effective_date timestamp with time zone,
    state text DEFAULT 'draft'::text NOT NULL,
    source_document text,
    back_order_id uuid,
    notes text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reference_document_type text,
    reference_document_id uuid
);

CREATE TABLE public.stock_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sales_order_id uuid NOT NULL,
    order_line_id uuid,
    product_id uuid NOT NULL,
    serial_number_id uuid,
    lot_id uuid,
    quantity numeric DEFAULT 1 NOT NULL,
    status text DEFAULT 'reserved'::text NOT NULL,
    reserved_by uuid,
    reserved_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.transfer_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transfer_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_name text NOT NULL,
    demand_qty numeric(14,3) DEFAULT 0 NOT NULL,
    done_qty numeric(14,3) DEFAULT 0 NOT NULL,
    unit text DEFAULT 'unit'::text NOT NULL,
    available boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference text NOT NULL,
    from_warehouse_id uuid,
    to_warehouse_id uuid,
    contact text,
    contact_phone text,
    operation_type text,
    source_location text,
    destination_location text,
    scheduled_date timestamp with time zone DEFAULT now() NOT NULL,
    estimate_date timestamp with time zone,
    state text DEFAULT 'draft'::text NOT NULL,
    product_availability text DEFAULT 'not_available'::text NOT NULL,
    source_document text,
    back_order_of uuid,
    notes text[] DEFAULT '{}'::text[] NOT NULL,
    activities jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.units_of_measure (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    abbreviation text NOT NULL,
    uom_type text DEFAULT 'unit'::text NOT NULL,
    ratio numeric DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.warehouse_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    warehouse_id uuid NOT NULL,
    parent_location_id uuid,
    name text NOT NULL,
    code text NOT NULL,
    type text DEFAULT 'internal'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    barcode text,
    aisle text,
    shelf text,
    bin text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    removal_strategy text DEFAULT 'fifo'::text,
    cyclic_count_frequency_days integer DEFAULT 0,
    last_count_date date,
    next_count_date date,
    notes text
);

CREATE TABLE public.warehouses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    address text,
    is_active boolean DEFAULT true NOT NULL,
    default_receipt_location_id uuid,
    default_delivery_location_id uuid,
    default_internal_location_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.write_off_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    write_off_record_id uuid NOT NULL,
    goods_receipt_serial_id uuid NOT NULL,
    product_id uuid NOT NULL,
    serial_number text NOT NULL,
    unit_cost_value numeric DEFAULT 0 NOT NULL,
    item_specific_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.write_off_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wf_number text NOT NULL,
    write_off_type text NOT NULL,
    source_type text,
    source_document_id uuid,
    source_document_reference text,
    status text DEFAULT 'draft'::text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    evidence_photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_value numeric DEFAULT 0 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_at timestamp with time zone,
    cancellation_reason text
);
