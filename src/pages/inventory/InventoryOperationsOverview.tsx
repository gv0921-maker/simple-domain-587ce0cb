import { Link, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Settings } from 'lucide-react';
import { useOperationTypes } from '@/hooks/inventory/config';
import { useOperationTypeCounts } from '@/hooks/inventory/useOperationTypeCounts';
import type { OperationKind, OperationType } from '@/lib/services/inventory/operationTypes';

const COLOR_MAP: Record<string, { bar: string; badge: string }> = {
  gray:   { bar: 'bg-muted-foreground/30',  badge: 'bg-muted text-muted-foreground' },
  blue:   { bar: 'bg-blue-500',   badge: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
  green:  { bar: 'bg-green-500',  badge: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300' },
  amber:  { bar: 'bg-amber-500',  badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  red:    { bar: 'bg-red-500',    badge: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  purple: { bar: 'bg-purple-500', badge: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300' },
  teal:   { bar: 'bg-teal-500',   badge: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300' },
};

const LIST_ROUTE: Record<OperationKind, string> = {
  receipt: '/inventory/goods-receipts',
  delivery: '/inventory/delivery-notes',
  internal_transfer: '/inventory/internal-movements',
  manufacturing: '/manufacturing/work-orders',
};
const NEW_ROUTE: Record<OperationKind, string> = {
  receipt: '/inventory/goods-receipts/new',
  delivery: '/inventory/delivery-notes',
  internal_transfer: '/inventory/internal-movements/new',
  manufacturing: '/manufacturing/work-orders/new',
};

export default function InventoryOperationsOverview() {
  const { data: types = [], isLoading } = useOperationTypes();
  const { data: counts } = useOperationTypeCounts();
  const navigate = useNavigate();

  const active = types.filter((t) => t.isActive);

  const countsFor = (t: OperationType) => {
    const bucket = counts?.[t.operationKind];
    return bucket?.get(t.id) ?? { draft: 0, waiting: 0, completed: 0, late: 0, total: 0, operationTypeId: t.id };
  };

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Operations</h1>
            <p className="text-muted-foreground">One card per operation type — click through to view or create.</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/inventory/setup/operation-types"><Settings className="h-4 w-4 mr-2" /> Configure Types</Link>
          </Button>
        </div>

        {isLoading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : active.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground mb-4">No operation types yet.</p>
            <Button asChild><Link to="/inventory/setup/operation-types"><Plus className="h-4 w-4 mr-2" /> Create one</Link></Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {active.map((t) => {
              const c = countsFor(t);
              const color = COLOR_MAP[t.cardColor ?? 'gray'] ?? COLOR_MAP.gray;
              return (
                <Card key={t.id} className="overflow-hidden">
                  <div className={`h-1.5 ${color.bar}`} />
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-semibold text-foreground">{t.name}</div>
                        {t.sequencePrefix && (
                          <span className={`inline-block mt-1 text-[10px] font-mono px-1.5 py-0.5 rounded ${color.badge}`}>{t.sequencePrefix}</span>
                        )}
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-y-1 text-sm">
                      <dt className="text-muted-foreground">To Process</dt>
                      <dd className="text-right font-medium">{c.draft + c.waiting}</dd>
                      <dt className="text-muted-foreground">Completed</dt>
                      <dd className="text-right font-medium">{c.completed}</dd>
                      {c.late > 0 && (<>
                        <dt className="text-destructive">Late</dt>
                        <dd className="text-right font-medium text-destructive">{c.late}</dd>
                      </>)}
                    </dl>
                    <div className="flex gap-2 pt-2 border-t">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 gap-1"
                        onClick={() => navigate(`${NEW_ROUTE[t.operationKind]}?operation_type_id=${t.id}`)}
                      >
                        <Plus className="h-3.5 w-3.5" /> New
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="flex-1"
                        onClick={() => navigate(`${LIST_ROUTE[t.operationKind]}?operation_type_id=${t.id}`)}
                      >
                        View All
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
