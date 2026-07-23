import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Truck, PackageSearch, ScanLine, Receipt, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  useITOsForSO, useITODetail, useSuggestITO, useCreateITO, useSOReadyToInvoice,
} from '@/hooks/inventory/internalTransfers';
import type { ITOSuggestionLine, ProductSource, ITOLineStatus } from '@/lib/services/inventory/internalTransfers';
import { logFieldChange } from '@/lib/services/activityLog';
import { useFactoryProgressForSO } from '@/hooks/shopfloor';
import { useVendorOrdersForSO } from '@/hooks/vendor-orders';
import { VO_STATUS_LABEL } from '@/lib/services/vendor-orders';

// Resolve real source + destination location names for each product on an ITO.
// Source  = warehouse_locations.name of the serials reserved for this SO
//           (or 'Multiple' if serials span >1 location).
// Destination = the transit location of the source warehouse.
function useItoLineLocations(salesOrderId: string, productIds: string[]) {
  const key = ['ito-line-locations', salesOrderId, [...productIds].sort().join(',')];
  return useQuery({
    queryKey: key,
    enabled: !!salesOrderId && productIds.length > 0,
    queryFn: async () => {
      const sb = supabase as any;
      const { data: serials } = await sb
        .from('goods_receipt_serials')
        .select('product_id, current_location, current_warehouse_id')
        .eq('reserved_for_so_id', salesOrderId)
        .in('product_id', productIds);
      const rows = (serials ?? []) as Array<{
        product_id: string; current_location: string | null; current_warehouse_id: string | null;
      }>;
      const locIds = Array.from(new Set(rows.map(r => r.current_location).filter((x): x is string => !!x)));
      const whIds = Array.from(new Set(rows.map(r => r.current_warehouse_id).filter((x): x is string => !!x)));
      const [{ data: locs }, { data: transit }] = await Promise.all([
        locIds.length > 0
          ? sb.from('warehouse_locations').select('id, name, warehouse_id').in('id', locIds)
          : Promise.resolve({ data: [] }),
        whIds.length > 0
          ? sb
              .from('warehouse_locations')
              .select('id, name, warehouse_id')
              .in('warehouse_id', whIds)
              .eq('type', 'transit')
              .eq('is_active', true)
          : Promise.resolve({ data: [] }),
      ]);
      const locById = new Map<string, { name: string; warehouse_id: string }>();
      ((locs ?? []) as any[]).forEach(l => locById.set(l.id, { name: l.name, warehouse_id: l.warehouse_id }));
      const transitByWh = new Map<string, string>();
      ((transit ?? []) as any[]).forEach(t => transitByWh.set(t.warehouse_id, t.name));

      const out = new Map<string, { source: string; destination: string }>();
      for (const pid of productIds) {
        const productRows = rows.filter(r => r.product_id === pid);
        const locNames = Array.from(
          new Set(productRows.map(r => (r.current_location ? locById.get(r.current_location)?.name : null))
            .filter((x): x is string => !!x)),
        );
        const whs = Array.from(new Set(productRows.map(r => r.current_warehouse_id).filter((x): x is string => !!x)));
        const source =
          locNames.length === 0 ? '—'
          : locNames.length === 1 ? locNames[0]
          : 'Multiple locations';
        const transitNames = Array.from(new Set(whs.map(w => transitByWh.get(w)).filter((x): x is string => !!x)));
        const destination =
          transitNames.length === 0 ? 'Transit (not configured)'
          : transitNames.length === 1 ? transitNames[0]
          : 'Transit (multiple)';
        out.set(pid, { source, destination });
      }
      return out;
    },
  });
}

interface Props {
  salesOrderId: string;
  salesOrderStatus: string;
  salesOrderCreatedBy: string | null | undefined;
}

const SOURCE_LABEL: Record<ProductSource, string> = {
  display: 'Display', warehouse: 'Warehouse', vendor: 'Vendor', factory: 'Factory',
};
const SOURCE_BADGE: Record<ProductSource, string> = {
  display: 'bg-blue-50 text-blue-700 border-blue-200',
  warehouse: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  vendor: 'bg-amber-50 text-amber-700 border-amber-200',
  factory: 'bg-purple-50 text-purple-700 border-purple-200',
};
const LINE_STATUS_BADGE: Record<ITOLineStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  scanning: 'bg-blue-50 text-blue-700 border border-blue-200',
  completed: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  blocked: 'bg-amber-50 text-amber-700 border border-amber-200',
};

function useCurrentRoles() {
  return useQuery({
    queryKey: ['current-user-roles'],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return [] as string[];
      const { data } = await supabase
        .from('user_roles' as any).select('role').eq('user_id', uid);
      return (((data ?? []) as unknown) as Array<{ role: string }>).map((r) => r.role);
    },
  });
}

export function FulfillmentSection({ salesOrderId, salesOrderStatus, salesOrderCreatedBy }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: roles = [] } = useCurrentRoles();

  const isAdmin = roles.includes('admin') || roles.includes('super_admin');
  const isWarehouse = roles.includes('warehouse_operator');
  const isCreator = !!user && !!salesOrderCreatedBy && user.id === salesOrderCreatedBy;
  const canConfirm = isCreator || isWarehouse || isAdmin;

  const { data: itos = [] } = useITOsForSO(salesOrderId);
  const activeITO = useMemo(() => itos.find((i) => i.status !== 'cancelled') ?? null, [itos]);
  const { data: itoDetail } = useITODetail(activeITO?.id);
  const { data: readyToInvoice } = useSOReadyToInvoice(salesOrderId);
  const { data: factoryWOs = [] } = useFactoryProgressForSO(salesOrderId);
  const { data: vendorOrders = [] } = useVendorOrdersForSO(salesOrderId);

  const suggestMut = useSuggestITO();
  const createMut = useCreateITO();

  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<ITOSuggestionLine[]>([]);
  const previewProductIds = useMemo(() => preview.map(p => p.product_id), [preview]);
  const itoProductIds = useMemo(
    () => (itoDetail?.lines ?? []).map(l => l.product_id),
    [itoDetail?.lines],
  );
  const productIdsForLocations = useMemo(
    () => Array.from(new Set([...previewProductIds, ...itoProductIds])),
    [previewProductIds, itoProductIds],
  );
  const { data: locationMap } = useItoLineLocations(salesOrderId, productIdsForLocations);

  const openSuggest = async () => {
    try {
      const lines = await suggestMut.mutateAsync(salesOrderId);
      setPreview(lines);
      setPreviewOpen(true);
    } catch (e) {
      toast({ title: 'Could not suggest ITO', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const confirmITO = async () => {
    if (!canConfirm) {
      toast({ title: 'Not authorised', description: 'Only the SO creator, warehouse, or admin can confirm.', variant: 'destructive' });
      return;
    }
    try {
      const itoId = await createMut.mutateAsync(salesOrderId);
      const detail = await (await import('@/lib/services/inventory/internalTransfers')).getITOById(itoId);
      const itoNumber = detail?.ito.ito_number ?? itoId;
      toast({ title: 'ITO created', description: `${itoNumber} added to scan queue.` });
      setPreviewOpen(false);
      try {
        await logFieldChange('sales_order', salesOrderId, 'ito', null, itoNumber);
      } catch { /* best effort */ }
    } catch (e) {
      toast({ title: 'Failed to create ITO', description: (e as Error).message, variant: 'destructive' });
    }
  };

  // 1) Draft / awaiting advance
  if (salesOrderStatus === 'draft' || salesOrderStatus === 'awaiting_advance' || salesOrderStatus === 'estimate') {
    return (
      <Card>
        <CardHeader className="pb-3 p-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-4 w-4" /> Fulfillment
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 text-sm text-muted-foreground">
          Confirm the order and meet the advance requirement to begin fulfillment.
        </CardContent>
      </Card>
    );
  }

  // 2) Confirmed, no ITO yet
  if (!activeITO && (salesOrderStatus === 'confirmed' || salesOrderStatus === 'fulfilling')) {
    return (
      <>
        <Card>
          <CardHeader className="pb-3 p-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Truck className="h-4 w-4" /> Fulfillment
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <p className="text-sm text-muted-foreground">
              No Internal Transfer Order yet. Suggest one to preview the lines, then confirm to begin scanning.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={openSuggest} disabled={suggestMut.isPending}>
                <PackageSearch className="h-4 w-4 mr-2" />
                {suggestMut.isPending ? 'Loading…' : 'Suggest Internal Transfer Order'}
              </Button>
              {canConfirm && (
                <Button size="sm" onClick={confirmITO} disabled={createMut.isPending}>
                  {createMut.isPending ? 'Creating…' : 'Confirm ITO'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Suggested Internal Transfer Order</DialogTitle>
              <DialogDescription>Review the lines below. Blocked lines are awaiting vendor or factory receipt.</DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Source → Destination</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((l) => (
                    <TableRow key={l.sales_order_line_id}>
                      <TableCell className="font-medium">{l.product_name ?? l.product_id}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <div className="text-sm">
                            <span className="font-medium">{locationMap?.get(l.product_id)?.source ?? '—'}</span>
                            <span className="mx-1 text-muted-foreground">→</span>
                            <span className="text-muted-foreground">{locationMap?.get(l.product_id)?.destination ?? 'Transit'}</span>
                          </div>
                          <Badge variant="outline" className={`${SOURCE_BADGE[l.product_source]} w-fit text-[10px] px-1.5 py-0`}>
                            {SOURCE_LABEL[l.product_source]}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{l.quantity}</TableCell>
                      <TableCell>
                        {l.blocked ? (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                            <AlertTriangle className="h-3 w-3 mr-1" /> Awaiting receipt
                          </Badge>
                        ) : (
                          <Badge variant="outline">Ready to scan</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {preview.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No lines</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreviewOpen(false)}>Cancel</Button>
              <Button onClick={confirmITO} disabled={!canConfirm || createMut.isPending}>
                {createMut.isPending ? 'Confirming…' : 'Confirm ITO'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // 3) Has ITO — fulfilling / completed views
  if (activeITO) {
    const lines = itoDetail?.lines ?? [];
    const totalExpected = lines.reduce((s, l) => s + l.quantity_expected, 0);
    const totalScanned = lines.reduce((s, l) => s + l.quantity_scanned, 0);
    const pct = totalExpected > 0 ? Math.min(100, Math.round((totalScanned / totalExpected) * 100)) : 0;
    const isCompleted = activeITO.status === 'completed';

    return (
      <Card>
        <CardHeader className="pb-3 p-4">
          <CardTitle className="text-base flex items-center gap-2 justify-between">
            <span className="flex items-center gap-2"><Truck className="h-4 w-4" /> Fulfillment</span>
            <Badge variant="outline" className="text-xs capitalize">{activeITO.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          {factoryWOs.length > 0 && (
            <div className="border rounded-md p-3 space-y-2 bg-purple-50/40">
              <div className="text-xs font-medium text-purple-900">Factory Progress</div>
              {factoryWOs.map((w) => (
                <div key={w.id} className="flex items-center justify-between text-sm">
                  <span className="font-mono">{w.wo_number}</span>
                  <Badge variant="outline" className="capitalize">{w.current_stage.replace('_', ' ')}</Badge>
                </div>
              ))}
            </div>
          )}
          {vendorOrders.length > 0 && (
            <div className="border rounded-md p-3 space-y-2 bg-amber-50/40">
              <div className="text-xs font-medium text-amber-900">Vendor Orders</div>
              {vendorOrders.map((v) => (
                <button
                  key={v.id}
                  onClick={() => navigate(`/vendor-orders/${v.id}`)}
                  className="w-full flex items-center justify-between text-sm hover:underline"
                >
                  <span className="font-mono">{v.vo_number}</span>
                  <span className="text-xs text-muted-foreground">{v.vendor?.name ?? ''}</span>
                  <Badge variant="outline" className="capitalize">{VO_STATUS_LABEL[v.status]}</Badge>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-medium">{activeITO.ito_number}</div>
              <div className="text-muted-foreground">{totalScanned} of {totalExpected} scanned</div>
            </div>
            <div className="flex gap-2">
              {!isCompleted && (
                <Button size="sm" onClick={() => navigate(`/inventory/ito/${activeITO.id}`)}>
                  <ScanLine className="h-4 w-4 mr-2" /> Open ITO — Scan &amp; QC
                </Button>
              )}
              {readyToInvoice && (
                <Button
                  size="sm"
                  onClick={() => {
                    // Trigger the InvoicingSection's Create Invoice dialog on this same page.
                    // Never navigate to a non-existent invoice — creation happens via the
                    // create_partial_invoice RPC and only then do we route to the invoice.
                    window.dispatchEvent(
                      new CustomEvent('so:open-create-invoice', { detail: { salesOrderId } }),
                    );
                    document
                      .getElementById('so-invoicing-section')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <Receipt className="h-4 w-4 mr-2" /> Generate Invoice
                </Button>
              )}
            </div>
          </div>
          <Progress value={pct} className="h-2" />

          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Source → Destination</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Scanned</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.product_id.slice(0, 8)}…</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="text-sm">
                          <span className="font-medium">{locationMap?.get(l.product_id)?.source ?? '—'}</span>
                          <span className="mx-1 text-muted-foreground">→</span>
                          <span className="text-muted-foreground">{locationMap?.get(l.product_id)?.destination ?? 'Transit'}</span>
                        </div>
                        <Badge variant="outline" className={`${SOURCE_BADGE[l.product_source]} w-fit text-[10px] px-1.5 py-0`}>
                          {SOURCE_LABEL[l.product_source]}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{l.quantity_expected}</TableCell>
                    <TableCell className="text-right">{l.quantity_scanned}</TableCell>
                    <TableCell>
                      {l.line_status === 'blocked' ? (
                        <Badge variant="outline" className={LINE_STATUS_BADGE.blocked}>
                          {l.product_source === 'vendor' ? 'Vendor Order pending' : 'Work Order pending'}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className={LINE_STATUS_BADGE[l.line_status]}>
                          {l.line_status}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {lines.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No ITO lines</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {isCompleted && (
            <div className="text-sm text-emerald-700 font-medium">ITO Completed ✓</div>
          )}
        </CardContent>
      </Card>
    );
  }

  return null;
}