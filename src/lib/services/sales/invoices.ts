import { supabase } from '@/integrations/supabase/client';

const sb = supabase as any;

export type SOInvoiceType = 'regular' | 'warranty' | 'factory';

export interface InvoiceLineSummary {
  line_id: string;
  product_id: string | null;
  product: string;
  qty_ordered: number;
  qty_invoiced: number;
  qty_remaining: number;
  unit_price: number;
  gst_rate: number;
  fully_invoiced: boolean;
}

export interface SOInvoiceSummary {
  total_order_value: number;
  total_invoiced_value: number;
  balance_to_invoice: number;
  invoice_count: number;
  line_summary: InvoiceLineSummary[];
}

export interface InvoiceTypeValidation {
  valid: boolean;
  message: string;
  payment_modes_used: string[];
}

export interface LineQuantityInput {
  sales_order_line_id: string;
  quantity_to_invoice: number;
}

export async function getSOInvoiceSummary(salesOrderId: string): Promise<SOInvoiceSummary> {
  const { data, error } = await sb.rpc('get_so_invoice_summary', { p_so_id: salesOrderId });
  if (error) throw error;
  return data as SOInvoiceSummary;
}

export async function validateInvoiceType(
  salesOrderId: string,
  invoiceType: SOInvoiceType,
): Promise<InvoiceTypeValidation> {
  const { data, error } = await sb.rpc('validate_invoice_type_against_so', {
    p_so_id: salesOrderId,
    p_invoice_type: invoiceType,
  });
  if (error) throw error;
  return data as InvoiceTypeValidation;
}

export async function createPartialInvoice(params: {
  salesOrderId: string;
  invoiceType: SOInvoiceType;
  lineQuantities: LineQuantityInput[];
  paymentAccountId: string;
  overrideReason?: string | null;
}): Promise<string> {
  const { data, error } = await sb.rpc('create_partial_invoice', {
    p_so_id: params.salesOrderId,
    p_invoice_type: params.invoiceType,
    p_line_quantities: params.lineQuantities,
    p_payment_account_id: params.paymentAccountId,
    p_override_reason: params.overrideReason ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function getInvoicesForSO(salesOrderId: string) {
  const { data, error } = await sb
    .from('invoices')
    .select('id, reference, type, issue_date, status, total, is_partial, invoice_sequence_in_so, invoice_lines(id)')
    .eq('sales_order_id', salesOrderId)
    .order('invoice_sequence_in_so', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    reference: string;
    type: SOInvoiceType;
    issue_date: string;
    status: string;
    total: number;
    is_partial: boolean;
    invoice_sequence_in_so: number;
    invoice_lines: Array<{ id: string }>;
  }>;
}

export async function getInvoiceWithLines(invoiceId: string) {
  const { data, error } = await sb
    .from('invoices')
    .select('*, invoice_lines(*)')
    .eq('id', invoiceId)
    .maybeSingle();
  if (error) throw error;
  return data;
}