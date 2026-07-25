import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DetailField, DetailGrid } from '@/components/forms/DetailField';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useStockMove } from '@/hooks/inventory';
import { useLocationsQuery } from '@/hooks/inventory/useLocations';
import { format, parseISO } from 'date-fns';

const OP_LABEL: Record<string, string> = {
  receipt: 'Receipt',
  delivery: 'Delivery',
  internal: 'Internal Transfer',
  adjustment: 'Adjustment',
  production: 'Production',
  return: 'Return',
};

const STATE_CLASS: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  waiting: 'bg-amber-50 text-amber-700 border border-amber-200',
  confirmed: 'bg-blue-50 text-blue-700 border border-blue-200',
  assigned: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  done: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  cancelled: 'bg-red-50 text-red-700 border border-red-200',
};

export default function StockMoveDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: move, isLoading } = useStockMove(id);
  const { data: locations = [] } = useLocationsQuery();

  // Some producers (the ITO and write-off RPCs) store only the location id and
  // leave the *_name column null, so resolve names from the id here rather than
  // trusting the denormalised name. Falls back to the stored name, then a dash.
  const locName = useMemo(() => {
    const byId = new Map(locations.map((l) => [l.id, l.name]));
    return (locId?: string, stored?: string) =>
      (locId && byId.get(locId)) || stored || '—';
  }, [locations]);

  if (isLoading) {
    return (
      <AppLayout title="Stock Moves" moduleNav={INVENTORY_NAV}>
        <div className="p-6 text-muted-foreground">Loading…</div>
      </AppLayout>
    );
  }
  if (!move) {
    return (
      <AppLayout title="Stock Moves" moduleNav={INVENTORY_NAV}>
        <div className="p-6">
          <Button variant="ghost" size="sm" onClick={() => navigate('/inventory/stock-moves')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Stock Moves
          </Button>
          <p className="mt-4 text-muted-foreground">Stock move not found.</p>
        </div>
      </AppLayout>
    );
  }

  const source = locName(move.sourceLocationId, move.sourceLocationName);
  const dest = locName(move.destinationLocationId, move.destinationLocationName);

  return (
    <AppLayout title="Stock Moves" subtitle={move.reference} moduleNav={INVENTORY_NAV}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/inventory/stock-moves')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-semibold truncate">{move.reference}</h1>
              <Badge variant="outline" className={STATE_CLASS[move.state] ?? ''}>{move.state}</Badge>
              <Badge variant="secondary">{OP_LABEL[move.operationType] ?? move.operationType}</Badge>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Movement</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 text-sm mb-4">
              <span className="font-medium">{source}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-medium">{dest}</span>
            </div>
            <DetailGrid columns={2}>
              <DetailField label="Scheduled" value={move.scheduledDate ? format(parseISO(move.scheduledDate), 'dd MMM yyyy, h:mm a') : '—'} />
              <DetailField label="Effective" value={move.effectiveDate ? format(parseISO(move.effectiveDate), 'dd MMM yyyy, h:mm a') : '—'} />
              <DetailField label="Source Document" value={move.sourceDocument || '—'} />
              <DetailField label="Partner" value={move.partnerName || '—'} />
            </DetailGrid>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Lines</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Done</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Serials</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {move.lines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                        No lines on this move.
                      </TableCell>
                    </TableRow>
                  ) : (
                    move.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>
                          <div className="font-medium">{l.productName}</div>
                          {l.productSku && <div className="text-xs text-muted-foreground">{l.productSku}</div>}
                        </TableCell>
                        <TableCell className="text-right">{l.doneQty}</TableCell>
                        <TableCell>{l.unitOfMeasure}</TableCell>
                        <TableCell>
                          {l.serialNumbers && l.serialNumbers.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {l.serialNumbers.map((s) => (
                                <Badge key={s} variant="outline" className="font-mono text-[11px]">{s}</Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
