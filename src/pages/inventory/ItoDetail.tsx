import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Truck } from 'lucide-react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useITODetail } from '@/hooks/inventory/internalTransfers';
import { useItoExpectedLines, useCompleteItoWithQc } from '@/hooks/inventory/workflow1';
import { ScanQCPanel } from '@/components/inventory/ScanQCPanel';
import { DocumentChatter } from '@/components/shared/DocumentChatter';
import { DocumentPipeline } from '@/components/inventory/DocumentPipeline';

export default function ItoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: detail, isLoading } = useITODetail(id);
  const { data: expected = [], isLoading: expLoading } = useItoExpectedLines(
    detail?.lines,
    detail?.ito.sales_order_id,
  );
  const complete = useCompleteItoWithQc();

  if (isLoading || !detail) {
    return (
      <AppLayout title="Internal Transfer Order" moduleNav={INVENTORY_NAV}>
        <div className="p-6">{isLoading ? 'Loading…' : 'ITO not found.'}</div>
      </AppLayout>
    );
  }

  const { ito } = detail;
  const isCompleted = ito.status === 'completed';
  const isCancelled = ito.status === 'cancelled';
  const noSerialsReserved =
    !expLoading && expected.length > 0 && expected.every(l => (l.serials?.length ?? 0) === 0);
  const partiallyReserved =
    !expLoading &&
    expected.some(l => (l.serials?.length ?? 0) > 0) &&
    expected.some(l => (l.serials?.length ?? 0) < l.expectedQty);

  const handleComplete = async () => {
    if (!id) return;
    try {
      const res = await complete.mutateAsync(id);
      toast.success(`ITO completed — ${res.moved} unit(s) moved to transit.`);
      navigate(`/sales/orders/${ito.sales_order_id}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not complete ITO');
    }
  };

  return (
    <AppLayout title="Internal Transfer Order" subtitle={ito.ito_number} moduleNav={INVENTORY_NAV}>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-semibold truncate">{ito.ito_number}</h1>
                <Badge variant="outline" className="capitalize">{ito.status}</Badge>
              </div>
              <button
                type="button"
                className="text-sm text-muted-foreground hover:underline"
                onClick={() => navigate(`/sales/orders/${ito.sales_order_id}`)}
              >
                ← Sales Order
              </button>
            </div>
          </div>
        </div>

        <DocumentPipeline kind="ito" status={ito.status} />

        {isCompleted && (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="p-4 text-sm text-emerald-800">
              This ITO is completed. Stock has been moved to the transit location and is awaiting packing / delivery.
            </CardContent>
          </Card>
        )}
        {isCancelled && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 text-sm text-destructive">This ITO was cancelled.</CardContent>
          </Card>
        )}

        {!isCompleted && !isCancelled && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4" /> Scan &amp; QC — pick to transit
              </CardTitle>
            </CardHeader>
            <CardContent>
              {expLoading ? (
                <div className="text-sm text-muted-foreground">Loading expected units…</div>
              ) : noSerialsReserved ? (
                <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">No stock reserved for this order.</div>
                    <div className="text-amber-800 mt-1">
                      Ensure goods have been received (Goods Receipt → QC pass) so serials are
                      available before scanning. If stock has been received, cancel and re-create
                      this ITO to reserve fresh serials.
                    </div>
                  </div>
                </div>
              ) : id ? (
                <>
                  {partiallyReserved && (
                    <div className="mb-3 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>Some lines don't have enough available stock reserved — those units can't be scanned until more stock is received.</span>
                    </div>
                  )}
                <ScanQCPanel
                  documentType="ito"
                  documentId={id}
                  expectedLines={expected}
                  requireQC={true}
                  requirePhotos={false}
                  onComplete={handleComplete}
                  completing={complete.isPending}
                  completeButtonLabel="Complete Transfer & Move to Transit"
                />
                </>
              ) : null}
            </CardContent>
          </Card>
        )}
        {id && <DocumentChatter recordType="ito" recordId={id} />}
      </div>
    </AppLayout>
  );
}