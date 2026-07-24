import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { MANUFACTURING_NAV } from '@/lib/navigation/manufacturing';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Filter } from 'lucide-react';
import { useWorkOrdersV2, useAssignableUsers } from '@/hooks/manufacturing/workOrders';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';
import { STAGE_LABELS, STAGE_VARIANT, type WorkOrderStage } from '@/lib/services/manufacturing/workOrders';

export default function WorkOrdersList() {
  const navigate = useNavigate();
  const { isAdmin } = useIsSuperAdmin();
  const [stage, setStage] = useState<WorkOrderStage | 'all'>('all');
  const [assignedTo, setAssignedTo] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<'all' | 'mine' | 'pending_my_approval' | 'awaiting_receipt'>('all');

  const filters = useMemo(() => {
    const f: any = {};
    if (stage !== 'all') f.stage = stage;
    if (assignedTo !== 'all') f.assignedTo = assignedTo;
    if (quickFilter === 'mine') f.mine = true;
    if (quickFilter === 'pending_my_approval') f.stage = 'pending_approval';
    if (quickFilter === 'awaiting_receipt') f.stage = 'completed';
    return f;
  }, [stage, assignedTo, quickFilter]);

  const { data: rows = [] } = useWorkOrdersV2(filters);
  const { data: users = [] } = useAssignableUsers();

  const filteredRows = rows.filter(r => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (r.wo_number || '').toLowerCase().includes(q) ||
           (r.product?.name || '').toLowerCase().includes(q);
  });

  const stats = useMemo(() => {
    const c = { draft: 0, pending: 0, in_progress: 0, awaiting_receipt: 0, completed: 0 };
    for (const r of rows) {
      if (r.current_stage === 'draft') c.draft++;
      else if (r.current_stage === 'pending_approval') c.pending++;
      else if (['placed','work_start','polishing'].includes(r.current_stage)) c.in_progress++;
      else if (r.current_stage === 'completed') c.awaiting_receipt++;
      else if (r.current_stage === 'received_at_store') c.completed++;
    }
    return c;
  }, [rows]);

  return (
    <AppLayout title="Manufacturing" subtitle="Work Orders" moduleNav={MANUFACTURING_NAV}>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Work Orders</h1>
          <Button onClick={() => navigate('/manufacturing/work-orders/new')}>
            <Plus className="h-4 w-4 mr-2" /> New Work Order
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Drafts" value={stats.draft} />
          <StatCard label="Pending Approval" value={stats.pending} />
          <StatCard label="In Progress (Factory)" value={stats.in_progress} />
          <StatCard label="Awaiting Receipt" value={stats.awaiting_receipt} />
          <StatCard label="Completed" value={stats.completed} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={quickFilter === 'all' ? 'default' : 'outline'} onClick={() => setQuickFilter('all')}>All</Button>
          <Button size="sm" variant={quickFilter === 'mine' ? 'default' : 'outline'} onClick={() => setQuickFilter('mine')}>My WOs</Button>
          {isAdmin && (
            <Button size="sm" variant={quickFilter === 'pending_my_approval' ? 'default' : 'outline'} onClick={() => setQuickFilter('pending_my_approval')}>Pending My Approval</Button>
          )}
          <Button size="sm" variant={quickFilter === 'awaiting_receipt' ? 'default' : 'outline'} onClick={() => setQuickFilter('awaiting_receipt')}>Awaiting Receipt</Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={stage} onValueChange={(v) => setStage(v as any)}>
            <SelectTrigger className="w-52"><Filter className="h-4 w-4 mr-2" /><SelectValue placeholder="Stage" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              {(Object.keys(STAGE_LABELS) as WorkOrderStage[]).map(k => (
                <SelectItem key={k} value={k}>{STAGE_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assignedTo} onValueChange={setAssignedTo}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Assigned to" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assignees</SelectItem>
              {users.map(u => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>WO #</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>ETA</TableHead>
                  <TableHead>Linked SO</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((r) => {
                  const assignee = users.find(u => u.id === r.assigned_factory_incharge_id);
                  return (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40"
                              onClick={() => navigate(`/manufacturing/work-orders/${r.id}`)}>
                      <TableCell className="font-mono text-xs">{r.wo_number}</TableCell>
                      <TableCell>{r.product?.name ?? '—'}</TableCell>
                      <TableCell className="text-right">{r.quantity}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STAGE_VARIANT[r.current_stage]}>
                          {STAGE_LABELS[r.current_stage]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{assignee?.name ?? '—'}</TableCell>
                      <TableCell className="text-sm">{r.eta_date ?? '—'}</TableCell>
                      <TableCell className="text-sm">{r.linked_sales_order?.reference ?? '—'}</TableCell>
                    </TableRow>
                  );
                })}
                {filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                      No work orders
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase text-muted-foreground tracking-wide">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}