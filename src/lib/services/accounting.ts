// Accounting service layer.
import { supabase } from '@/integrations/supabase/client';
import type { Invoice, InvoiceLine, Payment } from '@/lib/data/accounting';

export * from '@/lib/data/accounting';

function mapInvoice(row: any): Invoice {
  const lines: InvoiceLine[] = (row.invoice_lines ?? []).map((l: any) => ({
    id: l.id,
    productId: l.product_id ?? '',
    productName: l.description ?? '',
    quantity: Number(l.quantity) || 0,
    unitPrice: Number(l.unit_price) || 0,
    taxRate: Number(l.tax_rate) || 0,
    subtotal: Number(l.subtotal) || 0,
  }));
  const total = Number(row.total) || 0;
  const paid = Number(row.paid_amount) || 0;
  return {
    id: row.id,
    number: row.reference ?? '',
    customerId: row.customer_id ?? '',
    customerName: '',
    date: row.issue_date ?? '',
    dueDate: row.due_date ?? '',
    status: (row.status === 'sent' ? 'draft' : row.status) as Invoice['status'],
    lines,
    subtotal: Number(row.subtotal) || 0,
    tax: Number(row.tax_amount) || 0,
    total,
    amountPaid: paid,
    amountDue: total - paid,
  };
}

function mapPayment(row: any): Payment {
  const methodMap: Record<string, Payment['method']> = {
    cash: 'cash',
    bank_transfer: 'bank_transfer',
    cheque: 'check',
    card: 'card',
  };
  return {
    id: row.id,
    name: row.reference ?? row.id.slice(0, 8),
    date: row.payment_date ?? '',
    type: 'inbound',
    partnerId: row.customer_id ?? '',
    partnerName: '',
    amount: Number(row.amount) || 0,
    method: methodMap[row.method] ?? 'cash',
    status: 'posted',
    reference: row.reference ?? undefined,
  };
}

export async function getInvoices(): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, invoice_lines(*)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapInvoice);
}

export async function getInvoice(id: string): Promise<Invoice | undefined> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, invoice_lines(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapInvoice(data) : undefined;
}

export async function createInvoice(input: Omit<Invoice, 'id' | 'number'>): Promise<Invoice> {
  const reference = `INV/${new Date().getFullYear()}/${Date.now().toString().slice(-6)}`;
  const { data: inv, error } = await supabase
    .from('invoices')
    .insert({
      reference,
      customer_id: input.customerId && /^[0-9a-f-]{36}$/i.test(input.customerId) ? input.customerId : null,
      type: 'regular',
      issue_date: input.date || new Date().toISOString().slice(0, 10),
      due_date: input.dueDate || null,
      status: input.status === 'paid' ? 'paid' : input.status === 'overdue' ? 'overdue' : input.status === 'cancelled' ? 'cancelled' : 'draft',
      subtotal: input.subtotal,
      tax_amount: input.tax,
      total: input.total,
      paid_amount: input.amountPaid,
    })
    .select()
    .single();
  if (error) throw error;

  if (input.lines.length) {
    const linesInsert = input.lines.map((l) => ({
      invoice_id: inv.id,
      product_id: l.productId && /^[0-9a-f-]{36}$/i.test(l.productId) ? l.productId : null,
      description: l.productName,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      tax_rate: l.taxRate,
      subtotal: l.subtotal,
    }));
    const { error: lineErr } = await supabase.from('invoice_lines').insert(linesInsert);
    if (lineErr) throw lineErr;
  }

  return (await getInvoice(inv.id))!;
}

export async function updateInvoice(id: string, data: Partial<Invoice>): Promise<Invoice | undefined> {
  const patch: {
    status?: string;
    paid_amount?: number;
    subtotal?: number;
    tax_amount?: number;
    total?: number;
    issue_date?: string;
    due_date?: string;
  } = {};
  if (data.status !== undefined) patch.status = data.status;
  if (data.amountPaid !== undefined) patch.paid_amount = data.amountPaid;
  if (data.subtotal !== undefined) patch.subtotal = data.subtotal;
  if (data.tax !== undefined) patch.tax_amount = data.tax;
  if (data.total !== undefined) patch.total = data.total;
  if (data.date !== undefined) patch.issue_date = data.date;
  if (data.dueDate !== undefined) patch.due_date = data.dueDate;
  const { error } = await supabase.from('invoices').update(patch).eq('id', id);
  if (error) throw error;
  return await getInvoice(id);
}

export async function deleteInvoice(id: string): Promise<void> {
  const { error } = await supabase.from('invoices').delete().eq('id', id);
  if (error) throw error;
}

export async function getPayments(): Promise<Payment[]> {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .order('payment_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapPayment);
}

export async function createPayment(input: Omit<Payment, 'id' | 'name'>): Promise<Payment> {
  const reverseMethod: Record<string, string> = {
    cash: 'cash',
    bank_transfer: 'bank_transfer',
    check: 'cheque',
    card: 'card',
  };
  const { data, error } = await supabase
    .from('payments')
    .insert({
      customer_id: input.partnerId && /^[0-9a-f-]{36}$/i.test(input.partnerId) ? input.partnerId : null,
      amount: input.amount,
      payment_date: input.date || new Date().toISOString().slice(0, 10),
      method: reverseMethod[input.method] ?? 'cash',
      reference: input.reference ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapPayment(data);
}