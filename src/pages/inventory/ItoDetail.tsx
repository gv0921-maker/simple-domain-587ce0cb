import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useITODetail } from '@/hooks/inventory/internalTransfers';
import { useItoExpectedLines, useCompleteItoWithQc } from '@/hooks/inventory/workflow1';
import { ScanQCPanel } from '@/components/inventory/ScanQCPanel';

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
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold">{ito.ito_number}</h1>
                <Badge variant="outline" className="capitalize">{ito.status}</Badge>
              </div>
              <button
                type="button"
                className="text-sm text-muted-foreground hover:underline"
                onClick={() => navigate(`/sales/orders/${ito.sales_order_id}`)}
              >
                Sales Order · view
              </button>
            </div>
          </div>
        </div>

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
              ) : id ? (
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
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}