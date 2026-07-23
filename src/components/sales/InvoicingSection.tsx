import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Receipt, FileText, AlertTriangle, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  useSOInvoiceSummary, useInvoicesForSO, useValidateInvoiceType, useCreatePartialInvoice,
} from '@/hooks/sales/invoices';
import { getPaymentAccounts } from '@/lib/services/sales/payments';
import type { SOInvoiceType } from '@/lib/services/sales/invoices';

const fmtINR = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

const TYPE_LABEL: Record<SOInvoiceType, string> = {
  regular: 'Regular Bill', warranty: 'Warranty Bill', factory: 'Factory Bill',
};

function useCurrentRoles() {
  return useQuery({
    queryKey: ['current-user-roles'],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return [] as string[];
      const { data } = await supabase.from('user_roles' as any).select('role').eq('user_id', uid);
      return (((data ?? []) as unknown) as Array<{ role: string }>).map((r) => r.role);
    },
  });
}

interface Props {
  salesOrderId: string;
  salesOrderStatus: string;
}

export function InvoicingSection({ salesOrderId, salesOrderStatus }: Props) {
  const navigate = useNavigate();
  const { data: roles = [] } = useCurrentRoles();
  const isAdmin = roles.includes('admin') || roles.includes('super_admin');
  const isSalesRep = roles.includes('sales_rep') || roles.includes('sales_manager') || isAdmin;

  const { data: summary } = useSOInvoiceSummary(salesOrderId);
  const { data: invoices = [] } = useInvoicesForSO(salesOrderId);

  const eligible = ['ready_to_invoice', 'invoicing', 'invoiced', 'fulfilling'].includes(salesOrderStatus);
  if (!eligible) return null;

  const total = summary?.total_order_value ?? 0;
  const invoiced = summary?.total_invoiced_value ?? 0;
  const balance = summary?.balance_to_invoice ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((invoiced / total) * 100)) : 0;

  const [open, setOpen] = useState(false);

  // Allow FulfillmentSection (on the same SO page) to open the Create Invoice
  // dialog without navigating away to a non-existent invoice route.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { salesOrderId?: string } | undefined;
      if (!detail?.salesOrderId || detail.salesOrderId === salesOrderId) {
        if (balance <= 0) {
          toast.info('This sales order is already fully invoiced.');
          return;
        }
        setOpen(true);
      }
    };
    window.addEventListener('so:open-create-invoice', handler as EventListener);
    return () => window.removeEventListener('so:open-create-invoice', handler as EventListener);
  }, [salesOrderId, balance]);

  return (
    <Card id="so-invoicing-section">
      <CardHeader className="pb-3 p-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4" /> Invoicing
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total Order" value={fmtINR(total)} />
          <Stat label="Invoiced" value={`${fmtINR(invoiced)} (${pct}%)`} />
          <Stat label="Balance" value={fmtINR(balance)} />
          <Stat label="Invoices" value={String(summary?.invoice_count ?? 0)} />
        </div>
        <Progress value={pct} />

        {balance > 0 && isSalesRep && (
          <Button onClick={() => setOpen(true)} className="w-full md:w-auto">
            <FileText className="h-4 w-4 mr-2" /> Create Invoice
          </Button>
        )}

        {invoices.length > 0 && (
          <div className="overflow-x-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Lines</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/invoicing/invoices/${inv.id}`)}
                  >
                    <TableCell className="font-medium">
                      {inv.reference}
                      {inv.is_partial && (
                        <Badge variant="outline" className="ml-2">Partial #{inv.invoice_sequence_in_so}</Badge>
                      )}
                    </TableCell>
                    <TableCell>{inv.issue_date}</TableCell>
                    <TableCell>{TYPE_LABEL[inv.type] ?? inv.type}</TableCell>
                    <TableCell className="text-right">{fmtINR(Number(inv.total))}</TableCell>
                    <TableCell>{inv.invoice_lines?.length ?? 0} of {summary?.line_summary.length ?? 0}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`/print/invoice/${inv.id}`, '_blank');
                        }}
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {open && (
          <CreateInvoiceDialog
            salesOrderId={salesOrderId}
            onClose={() => setOpen(false)}
            isAdmin={isAdmin}
          />
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

function CreateInvoiceDialog({
  salesOrderId, onClose, isAdmin,
}: { salesOrderId: string; onClose: () => void; isAdmin: boolean }) {
  const navigate = useNavigate();
  const { data: summary } = useSOInvoiceSummary(salesOrderId);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [type, setType] = useState<SOInvoiceType>('regular');
  const { data: validation } = useValidateInvoiceType(salesOrderId, type);
  const [overrideReason, setOverrideReason] = useState('');
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [paymentAccountId, setPaymentAccountId] = useState('');

  const { data: accounts = [] } = useQuery({
    queryKey: ['payment-accounts-active'],
    queryFn: () => getPaymentAccounts(true),
  });

  const createMut = useCreatePartialInvoice(salesOrderId);

  const lines = summary?.line_summary ?? [];
  const remainingLines = lines.filter((l) => l.qty_remaining > 0);

  // Initialize qty defaults
  useMemo(() => {
    const next: Record<string, number> = {};
    for (const l of remainingLines) next[l.line_id] = Number(l.qty_remaining);
    setQtys(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.invoice_count]);

  const previewSubtotal = remainingLines.reduce((s, l) => {
    const q = qtys[l.line_id] ?? 0;
    return s + q * Number(l.unit_price);
  }, 0);
  const previewTax = remainingLines.reduce((s, l) => {
    const q = qtys[l.line_id] ?? 0;
    return s + (q * Number(l.unit_price) * Number(l.gst_rate)) / 100;
  }, 0);
  const previewTotal = previewSubtotal + previewTax;

  const validOK = validation?.valid ?? true;
  const canProceedStep1 = validOK || (isAdmin && overrideReason.trim().length > 3);
  const canProceedStep2 = Object.values(qtys).some((q) => q > 0);
  const canSubmit = canProceedStep2 && !!paymentAccountId;

  const handleSubmit = async () => {
    try {
      const lineQuantities = Object.entries(qtys)
        .filter(([, q]) => q > 0)
        .map(([sales_order_line_id, q]) => ({ sales_order_line_id, quantity_to_invoice: q }));
      const invoiceId = await createMut.mutateAsync({
        invoiceType: type,
        lineQuantities,
        paymentAccountId,
        overrideReason: validOK ? null : overrideReason,
      });
      toast.success('Invoice created');
      onClose();
      window.open(`/print/invoice/${invoiceId}`, '_blank');
      navigate(`/invoicing/invoices/${invoiceId}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to create invoice');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create Invoice — Step {step} of 3</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <Label>Invoice Type</Label>
            <RadioGroup value={type} onValueChange={(v) => setType(v as SOInvoiceType)}>
              {(['regular', 'warranty', 'factory'] as SOInvoiceType[]).map((t) => (
                <div key={t} className="flex items-center gap-2 border rounded-md p-3">
                  <RadioGroupItem value={t} id={`type-${t}`} />
                  <Label htmlFor={`type-${t}`} className="cursor-pointer">{TYPE_LABEL[t]}</Label>
                </div>
              ))}
            </RadioGroup>
            {validation && (
              <div className={`text-sm flex items-start gap-2 p-3 rounded-md ${
                validation.valid
                  ? 'bg-success/10 text-success'
                  : 'bg-destructive/10 text-destructive'
              }`}>
                {!validation.valid && <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
                <span>{validation.message}</span>
              </div>
            )}
            {!validOK && isAdmin && (
              <div className="space-y-1">
                <Label>Admin Override Reason</Label>
                <Textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Required to bypass validation"
                  rows={2}
                />
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Invoiced</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="text-right w-32">Qty to invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remainingLines.map((l) => (
                  <TableRow key={l.line_id}>
                    <TableCell>{l.product}</TableCell>
                    <TableCell className="text-right">{l.qty_ordered}</TableCell>
                    <TableCell className="text-right">{l.qty_invoiced}</TableCell>
                    <TableCell className="text-right">{l.qty_remaining}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        max={l.qty_remaining}
                        value={qtys[l.line_id] ?? 0}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(Number(l.qty_remaining), Number(e.target.value) || 0));
                          setQtys((p) => ({ ...p, [l.line_id]: v }));
                        }}
                        className="h-8 text-right"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="text-right text-sm">
              <div>Subtotal: <span className="font-medium">{fmtINR(previewSubtotal)}</span></div>
              <div>Tax: <span className="font-medium">{fmtINR(previewTax)}</span></div>
              <div className="text-base font-semibold">Total: {fmtINR(previewTotal)}</div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Payment Account</Label>
              <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                <SelectTrigger><SelectValue placeholder="Select payment account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.account_name} ({a.account_type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="border rounded-md p-3 text-sm space-y-1">
              <div className="font-medium">{TYPE_LABEL[type]}</div>
              <div>Subtotal: {fmtINR(previewSubtotal)}</div>
              <div>Tax: {fmtINR(previewTax)}</div>
              <div className="font-semibold">Total: {fmtINR(previewTotal)}</div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}>
              Back
            </Button>
          )}
          {step < 3 && (
            <Button
              onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
              disabled={(step === 1 && !canProceedStep1) || (step === 2 && !canProceedStep2)}
            >
              Next
            </Button>
          )}
          {step === 3 && (
            <Button onClick={handleSubmit} disabled={!canSubmit || createMut.isPending}>
              {createMut.isPending ? 'Generating…' : 'Generate Invoice'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}