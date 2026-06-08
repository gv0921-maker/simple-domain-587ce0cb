import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// Portal access is gated by a per-customer `portal_token` and resolved
// through SECURITY DEFINER RPCs. Anyone with the link can view & accept the
// quote — there is no second auth factor by design.

export default function CustomerPortalQuotation() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const token = searchParams.get('token') || '';

  const quotationQ = useQuery({
    queryKey: ['portal', 'quotation', token, id],
    enabled: !!token && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('portal_get_quotation' as any, {
        _token: token, _id: id!,
      });
      if (error) throw error;
      return data as any;
    },
  });

  const statusMut = useMutation({
    mutationFn: async (status: 'accepted' | 'cancelled') => {
      const { data, error } = await supabase.rpc('portal_update_quotation_status' as any, {
        _token: token, _id: id!, _status: status,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', 'quotation', token, id] });
      qc.invalidateQueries({ queryKey: ['portal', 'quotations', token] });
    },
  });

  const quotation = quotationQ.data;

  if (!token || (!quotationQ.isLoading && !quotation)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">Quotation not found or access denied.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!quotation) {
    return <div className="min-h-screen p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  const handleAccept = async () => {
    try {
      await statusMut.mutateAsync('accepted');
      toast({ title: 'Quotation accepted!' });
    } catch (e: any) {
      toast({ title: 'Could not accept', description: e?.message, variant: 'destructive' });
    }
  };

  const handleReject = async () => {
    try {
      await statusMut.mutateAsync('cancelled');
      toast({ title: 'Quotation declined' });
    } catch (e: any) {
      toast({ title: 'Could not decline', description: e?.message, variant: 'destructive' });
    }
  };

  const lines: any[] = quotation.quotation_lines ?? [];
  const discountAmount = Number(quotation.discount_amount ?? 0);
  const taxAmount = Number(quotation.tax_amount ?? 0);
  const subtotal = Number(quotation.subtotal ?? 0);
  const total = Number(quotation.total ?? 0);

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/portal?token=${token}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">{quotation.reference}</h1>
            <p className="text-sm text-muted-foreground">Quotation for {quotation.customer_name}</p>
          </div>
          <Badge variant="outline" className="capitalize ml-auto">{quotation.status}</Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">Date:</span> {quotation.date}</div>
            <div><span className="text-muted-foreground">Valid Until:</span> {quotation.valid_until ?? quotation.expiry_date ?? '—'}</div>
            <div><span className="text-muted-foreground">Payment Terms:</span> {quotation.payment_terms || '—'}</div>
            <div><span className="text-muted-foreground">Currency:</span> {quotation.currency}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Line Items</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line: any) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium">{line.product_name ?? line.description ?? '—'}</TableCell>
                    <TableCell className="text-right">{Number(line.quantity ?? 0)}</TableCell>
                    <TableCell className="text-right">₹{Number(line.unit_price ?? 0).toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-right font-semibold">₹{Number(line.subtotal ?? line.total ?? 0).toLocaleString('en-IN')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Separator className="my-4" />
            <div className="space-y-2 text-sm ml-auto w-64">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>₹{subtotal.toLocaleString('en-IN')}</span></div>
              {discountAmount > 0 && <div className="flex justify-between text-success"><span>Discount</span><span>-₹{discountAmount.toLocaleString('en-IN')}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>₹{taxAmount.toLocaleString('en-IN')}</span></div>
              <Separator />
              <div className="flex justify-between font-bold text-lg"><span>Total</span><span>₹{total.toLocaleString('en-IN')}</span></div>
            </div>
          </CardContent>
        </Card>

        {quotation.status === 'sent' && (
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={handleReject} disabled={statusMut.isPending}>
              <XCircle className="h-4 w-4 mr-2" /> Decline
            </Button>
            <Button onClick={handleAccept} disabled={statusMut.isPending}>
              <CheckCircle className="h-4 w-4 mr-2" /> Accept Quotation
            </Button>
          </div>
        )}

        {quotation.notes && (
          <Card>
            <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
            <CardContent><p className="text-sm whitespace-pre-wrap">{quotation.notes}</p></CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}