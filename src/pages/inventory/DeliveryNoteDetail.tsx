import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ActivityChatter } from '@/components/shared/ActivityChatter';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useDeliveryNote } from '@/hooks/inventory/deliveryNotes';
import { Checkbox } from '@/components/ui/checkbox';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ArrowLeft, Printer, Lock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { ScanQCPanel } from '@/components/inventory/ScanQCPanel';
import { useCanCreateDeliveryForSO, useCompleteDeliveryWithQc } from '@/hooks/inventory/workflow1';
import { DocumentPipeline } from '@/components/inventory/DocumentPipeline';

const statusVariant: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  confirmed: 'bg-primary/15 text-primary',
  delivered: 'bg-success text-success-foreground',
};

export default function DeliveryNoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: note, isLoading } = useDeliveryNote(id);
  const complete = useCompleteDeliveryWithQc();
  const [signature, setSignature] = useState(false);
  const { data: gate } = useCanCreateDeliveryForSO(note?.salesOrderId ?? undefined);

  if (isLoading || !note) {
    return (
      <AppLayout title="Delivery Notes" moduleNav={INVENTORY_NAV}>
        <div className="p-6">{isLoading ? 'Loading…' : 'Delivery note not found.'}</div>
      </AppLayout>
    );
  }

  const handleComplete = async () => {
    try {
      const res = await complete.mutateAsync({ dnId: note.id, signatureReceived: signature });
      toast.success(res.soClosed
        ? `Delivery complete — ${res.delivered} unit(s) handed off. Sales order closed.`
        : `Delivery complete — ${res.delivered} unit(s) handed off.`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to complete delivery');
    }
  };

  // Expected lines from products_json (each product's serials become expected units)
  const expectedLines = note.productsJson.map((p, idx) => ({
    lineId: `${p.product_id}-${idx}`,
    productId: p.product_id,
    productName: p.product_name,
    expectedQty: p.serial_numbers.length || p.quantity,
    serials: p.serial_numbers,
  }));

  return (
    <AppLayout title="Delivery Notes" subtitle={note.reference} moduleNav={INVENTORY_NAV}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate('/inventory/delivery-notes')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-semibold truncate">{note.reference}</h1>
                <Badge className={statusVariant[note.status] ?? ''}>{note.status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Created {format(parseISO(note.createdAt), 'MMM d, yyyy HH:mm')}
                {note.deliveryDate && ` · Delivered ${format(parseISO(note.deliveryDate), 'MMM d, yyyy HH:mm')}`}
              </p>
              {note.salesOrderId && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => navigate(`/sales/orders/${note.salesOrderId}`)}
                >
                  ← Sales Order
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" onClick={() => window.open(`/print/delivery_note/${note.id}`, '_blank')}>
              <Printer className="h-4 w-4 mr-2" /> Print
            </Button>
          </div>
        </div>

        <DocumentPipeline kind="delivery_note" status={note.status} />

        {/* Payment gate */}
        {note.status !== 'delivered' && gate && !gate.allowed && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="p-4 flex items-start gap-3 text-sm text-amber-900">
              <Lock className="h-4 w-4 mt-0.5" />
              <div>
                <div className="font-medium">Delivery locked</div>
                <div>{gate.message}</div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Scan + QC engine */}
        {note.status !== 'delivered' && gate?.allowed && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Scan &amp; QC — handoff to customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={signature} onCheckedChange={(v) => setSignature(!!v)} />
                Customer signature received (today)
              </label>
              <ScanQCPanel
                documentType="delivery_note"
                documentId={note.id}
                expectedLines={expectedLines}
                requireQC={true}
                requirePhotos={true}
                onComplete={handleComplete}
                completing={complete.isPending}
                completeButtonLabel="Complete Delivery"
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="bg-primary text-primary-foreground rounded-t-lg">
            <CardTitle className="text-xl">GLF — Delivery Note</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 grid grid-cols-2 gap-6 text-sm">
            <div>
              <div className="font-medium text-muted-foreground">Reference</div>
              <div>{note.reference}</div>
            </div>
            <div>
              <div className="font-medium text-muted-foreground">Delivery Date</div>
              <div>{note.deliveryDate ? format(parseISO(note.deliveryDate), 'MMM d, yyyy') : '—'}</div>
            </div>
            <div>
              <div className="font-medium text-muted-foreground">Created By</div>
              <div className="font-mono text-xs">{note.createdBy ?? '—'}</div>
            </div>
            <div>
              <div className="font-medium text-muted-foreground">QC By</div>
              <div className="font-mono text-xs">{note.qcBy ?? '—'}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Customer Details</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="font-medium">{note.customerDeliveryName || '—'}</div>
            <div className="text-muted-foreground whitespace-pre-line">
              {note.customerDeliveryAddress || '—'}
            </div>
            {note.customerDeliveryPhone && (
              <div className="text-muted-foreground">Phone: {note.customerDeliveryPhone}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Products</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Serial Numbers</TableHead>
                  <TableHead>Location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {note.productsJson.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      No products
                    </TableCell>
                  </TableRow>
                )}
                {note.productsJson.map((p, idx) => (
                  <TableRow key={`${p.product_id}-${idx}`}>
                    <TableCell className="font-medium">{p.product_name}</TableCell>
                    <TableCell className="text-right">{p.quantity}</TableCell>
                    <TableCell>{p.unit}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.serial_numbers.length ? p.serial_numbers.join(', ') : '—'}
                    </TableCell>
                    <TableCell>{p.warehouse_location || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <ActivityChatter recordType="delivery_note" recordId={note.id} />
      </div>
    </AppLayout>
  );
}