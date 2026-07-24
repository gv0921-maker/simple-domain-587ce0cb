import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { MANUFACTURING_NAV } from '@/lib/navigation/manufacturing';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ClipboardList, Factory, TrendingUp, Clock, AlertTriangle, Plus } from 'lucide-react';
import { useWorkOrdersV2 } from '@/hooks/manufacturing/workOrders';
import {
  STAGE_LABELS,
  STAGE_VARIANT,
  IN_PRODUCTION_STAGES,
  CLOSED_STAGES,
  type WorkOrderStage,
} from '@/lib/services/manufacturing/workOrders';
import { cn } from '@/lib/utils';

// Order the pipeline card follows a work order's actual progression.
const PIPELINE_STAGES: WorkOrderStage[] = [
  'draft',
  'pending_approval',
  'approved',
  'placed',
  'work_start',
  'polishing',
  'completed',
];

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ManufacturingOverview() {
  const navigate = useNavigate();
  const { data: workOrders = [], isLoading } = useWorkOrdersV2();

  const {
    inProduction,
    awaitingApproval,
    overdue,
    open,
    stageCounts,
    maxStageCount,
  } = useMemo(() => {
    const today = todayISO();
    const open = workOrders.filter((wo) => !CLOSED_STAGES.includes(wo.current_stage));
    const inProduction = workOrders.filter((wo) =>
      IN_PRODUCTION_STAGES.includes(wo.current_stage),
    );
    const overdue = open.filter((wo) => !!wo.eta_date && wo.eta_date < today);

    const stageCounts = PIPELINE_STAGES.map((stage) => ({
      stage,
      count: workOrders.filter((wo) => wo.current_stage === stage).length,
    }));

    return {
      inProduction,
      awaitingApproval: workOrders.filter((wo) => wo.current_stage === 'pending_approval'),
      overdue,
      open,
      stageCounts,
      maxStageCount: Math.max(1, ...stageCounts.map((s) => s.count)),
    };
  }, [workOrders]);

  const stats = [
    { label: 'In Production', value: inProduction.length, icon: Factory, color: 'text-info' },
    { label: 'Awaiting Approval', value: awaitingApproval.length, icon: Clock, color: 'text-warning' },
    { label: 'Past ETA', value: overdue.length, icon: AlertTriangle, color: 'text-destructive' },
    { label: 'Open Work Orders', value: open.length, icon: TrendingUp, color: 'text-success' },
  ];

  return (
    <AppLayout title="Manufacturing" moduleNav={MANUFACTURING_NAV}>
      <div className="p-6 space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Manufacturing Overview</h1>
            <p className="text-muted-foreground">Monitor production and manage work orders</p>
          </div>
          <Button onClick={() => navigate('/manufacturing/work-orders/new')} className="shrink-0">
            <Plus className="h-4 w-4 mr-2" />
            New Work Order
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <p className="text-2xl font-bold">{isLoading ? '—' : stat.value}</p>
                  </div>
                  <stat.icon className={`h-8 w-8 ${stat.color}`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* At the factory right now */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg">In Production</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/manufacturing/work-orders')}>
                View All
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {isLoading ? (
                  <p className="text-muted-foreground text-sm">Loading…</p>
                ) : inProduction.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Nothing at the factory right now</p>
                ) : (
                  inProduction.map((wo) => {
                    const late = !!wo.eta_date && wo.eta_date < todayISO();
                    return (
                      <div
                        key={wo.id}
                        className="p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => navigate(`/manufacturing/work-orders/${wo.id}`)}
                      >
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <span className="font-medium">{wo.wo_number}</span>
                          <Badge variant="outline" className={cn('font-normal', STAGE_VARIANT[wo.current_stage])}>
                            {STAGE_LABELS[wo.current_stage]}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {wo.product?.name ?? 'Product'} · {wo.quantity} unit{wo.quantity === 1 ? '' : 's'}
                        </p>
                        {wo.eta_date && (
                          <p className={cn('text-xs mt-1', late ? 'text-destructive' : 'text-muted-foreground')}>
                            ETA {wo.eta_date}{late ? ' · past due' : ''}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {/* Where everything currently sits */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Pipeline by Stage</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stageCounts.map(({ stage, count }) => (
                  <div key={stage} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{STAGE_LABELS[stage]}</span>
                      <span className="text-sm text-muted-foreground">{count}</span>
                    </div>
                    <Progress value={(count / maxStageCount) * 100} className="h-2" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Card
            className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => navigate('/manufacturing/work-orders')}
          >
            <div className="flex flex-col items-center gap-2">
              <ClipboardList className="h-8 w-8 text-primary" />
              <span className="text-sm font-medium">Work Orders</span>
            </div>
          </Card>
          <Card
            className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => navigate('/shop-floor')}
          >
            <div className="flex flex-col items-center gap-2">
              <Factory className="h-8 w-8 text-primary" />
              <span className="text-sm font-medium">Shop Floor</span>
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
