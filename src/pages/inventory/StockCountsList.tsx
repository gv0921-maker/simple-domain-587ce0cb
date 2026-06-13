import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, Plus } from 'lucide-react';
import { INVENTORY_NAV } from '@/lib/navigation';
import { MONTH_LABELS, STATUS_LABELS, type StockCount, type StockCountStatus } from '@/lib/services/inventory/stockCounts';
import { useStockCounts, useCreateStockCount, useRequestCountSkip } from '@/hooks/inventory/stockCounts';
import { useToast } from '@/hooks/use-toast';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';
import { format, parseISO } from 'date-fns';

const STATUS_STYLES: Record<StockCountStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  in_progress: 'bg-warning/20 text-warning border-warning',
  completed: 'bg-primary/10 text-primary border-primary/30',
  reconciled: 'bg-success/20 text-success border-success',
  skipped: 'bg-destructive/10 text-destructive border-destructive/30',
};

export default function StockCountsList() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAdmin: isSuper } = useIsSuperAdmin();
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  const day = new Date().getDate();
  const { data: counts = [] } = useStockCounts({ year });
  const createMut = useCreateStockCount();
  const skipMut = useRequestCountSkip();
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [skipTarget, setSkipTarget] = useState<{ month: number; year: number } | null>(null);

  const monthMap = useMemo(() => {
    const m = new Map<number, StockCount>();
    counts.filter((c) => c.count_period_year === year).forEach((c) => m.set(c.count_period_month, c));
    return m;
  }, [counts, year]);

  const currentCount = monthMap.get(month);
  const overdue = !currentCount && day >= 25;

  const handleCreate = async (m: number) => {
    try {
      const id = await createMut.mutateAsync({ month: m, year });
      navigate(`/inventory/stock-counts/${id}`);
    } catch (e: any) {
      toast({ title: 'Could not create count', description: e.message, variant: 'destructive' });
    }
  };

  const handleSkip = async () => {
    if (!skipTarget || !skipReason.trim()) return;
    try {
      const res = await skipMut.mutateAsync({ ...skipTarget, reason: skipReason.trim() });
      toast({
        title: res.approved ? 'Count skipped' : 'Skip approval requested',
        description: res.approved ? 'Marked as skipped' : 'A super admin must approve this request',
      });
      setSkipOpen(false);
      setSkipReason('');
      setSkipTarget(null);
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="p-6 space-y-6">
        {overdue && (
          <Card className="border-warning bg-warning/10">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-warning mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold">Monthly stock count overdue</div>
                <div className="text-sm text-muted-foreground">
                  Count for {MONTH_LABELS[month - 1]} {year} has not been started. Begin the count now or request a skip approval.
                </div>
              </div>
              <Button size="sm" onClick={() => handleCreate(month)}>Start Count</Button>
              <Button size="sm" variant="outline" onClick={() => { setSkipTarget({ month, year }); setSkipOpen(true); }}>
                Request Skip
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">{year} — Monthly Counts</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {MONTH_LABELS.map((label, idx) => {
                const m = idx + 1;
                const sc = monthMap.get(m);
                return (
                  <button
                    key={m}
                    onClick={() => sc ? navigate(`/inventory/stock-counts/${sc.id}`) : handleCreate(m)}
                    className="border border-border rounded-md p-3 text-left hover:bg-muted/50"
                  >
                    <div className="text-sm font-semibold">{label}</div>
                    {sc ? (
                      <Badge className={`${STATUS_STYLES[sc.status]} mt-2 text-[10px]`}>{STATUS_LABELS[sc.status]}</Badge>
                    ) : (
                      <Badge variant="outline" className="mt-2 text-[10px]">Not Started</Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">All Counts ({year})</CardTitle>
            <Button size="sm" onClick={() => handleCreate(month)} className="gap-2">
              <Plus className="h-4 w-4" />New Count
            </Button>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Count #</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {counts.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No counts yet</TableCell></TableRow>
              ) : counts.map((c) => (
                <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/inventory/stock-counts/${c.id}`)}>
                  <TableCell className="font-medium text-primary">{c.count_number}</TableCell>
                  <TableCell>{MONTH_LABELS[c.count_period_month - 1]} {c.count_period_year}</TableCell>
                  <TableCell><Badge className={STATUS_STYLES[c.status]}>{STATUS_LABELS[c.status]}</Badge></TableCell>
                  <TableCell className="text-sm">{c.started_at ? format(parseISO(c.started_at), 'dd MMM, HH:mm') : '—'}</TableCell>
                  <TableCell className="text-sm">{c.completed_at ? format(parseISO(c.completed_at), 'dd MMM, HH:mm') : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Dialog open={skipOpen} onOpenChange={setSkipOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {isSuper ? 'Skip Count' : 'Request Skip Approval'} — {skipTarget ? `${MONTH_LABELS[skipTarget.month - 1]} ${skipTarget.year}` : ''}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <label className="font-medium">Reason</label>
              <Textarea value={skipReason} onChange={(e) => setSkipReason(e.target.value)} placeholder="" rows={4} />
              {!isSuper && (
                <p className="text-xs text-muted-foreground">A super admin must approve this request.</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSkipOpen(false)}>Cancel</Button>
              <Button onClick={handleSkip} disabled={!skipReason.trim() || skipMut.isPending}>
                {isSuper ? 'Skip Count' : 'Request Approval'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}