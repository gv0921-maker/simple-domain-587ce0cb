import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useCorrectionOrders } from '@/hooks/inventory/correctionOrders';
import type { COStatus, COSourceType } from '@/lib/services/inventory/correctionOrders';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { format, parseISO } from 'date-fns';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-primary/15 text-primary',
  in_progress: 'bg-accent text-accent-foreground',
  completed: 'bg-success/15 text-success-foreground',
  closed: 'bg-success/15 text-success-foreground',
  cancelled: 'bg-destructive/15 text-destructive',
};

export default function CorrectionOrdersList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<COStatus | 'all'>('all');
  const [sourceType, setSourceType] = useState<COSourceType | 'all'>('all');
  const [search, setSearch] = useState('');

  const { data: rows = [], isLoading } = useCorrectionOrders({
    status: status === 'all' ? undefined : status,
    sourceType: sourceType === 'all' ? undefined : sourceType,
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.co_number.toLowerCase().includes(q) ||
      (r.addressed_to_name ?? '').toLowerCase().includes(q) ||
      (r.source_document_reference ?? '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { draft: 0, sent: 0, in_progress: 0, closed: 0 };
    rows.forEach(r => { if (c[r.status] != null) c[r.status] += 1; });
    return c;
  }, [rows]);

  return (
    <AppLayout title="Correction Orders" moduleNav={INVENTORY_NAV}>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Correction Orders</h1>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(['draft', 'sent', 'in_progress', 'closed'] as const).map(s => (
            <Card key={s}>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">{s.replace('_', ' ')}</div>
                <div className="text-2xl font-semibold">{counts[s] ?? 0}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 items-end">
          <div className="w-56">
            <label className="text-xs text-muted-foreground">Search</label>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="" />
          </div>
          <div className="w-44">
            <label className="text-xs text-muted-foreground">Status</label>
            <Select value={status} onValueChange={v => setStatus(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {(['draft', 'sent', 'in_progress', 'completed', 'closed', 'cancelled'] as COStatus[]).map(s => (
                  <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44">
            <label className="text-xs text-muted-foreground">Source</label>
            <Select value={sourceType} onValueChange={v => setSourceType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="goods_receipt">Goods Receipt</SelectItem>
                <SelectItem value="return">Return</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CO Number</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Addressed To</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No correction orders</TableCell></TableRow>
                ) : filtered.map(r => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/inventory/correction-orders/${r.id}`)}>
                    <TableCell className="font-medium">{r.co_number}</TableCell>
                    <TableCell>{r.source_document_reference ?? '—'}</TableCell>
                    <TableCell>{r.addressed_to_name ?? '—'} <span className="text-xs text-muted-foreground">({r.addressed_to_type})</span></TableCell>
                    <TableCell className="capitalize">{r.correction_type}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_STYLES[r.status] ?? ''}>{r.status.replace('_', ' ')}</Badge>
                    </TableCell>
                    <TableCell>{format(parseISO(r.created_at), 'dd MMM yyyy')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}