import { Package, ClipboardCheck, AlertTriangle, Truck, Plus, ArrowRightLeft } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { DashboardLayout } from './_shared';
import { StatCard } from '@/components/dashboard/StatCard';
import { AlertList } from '@/components/dashboard/AlertList';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { QuickActionGrid } from '@/components/dashboard/QuickActionGrid';
import { useWarehouseMetrics, useDashboardRole } from '@/hooks/dashboard';

export default function WarehouseDashboard() {
  const { data: role } = useDashboardRole();
  const { data, isLoading } = useWarehouseMetrics();

  if (role && !['super_admin','admin','warehouse_operator'].includes(role)) {
    return <Navigate to="/dashboards" replace />;
  }

  return (
    <DashboardLayout title="Warehouse Dashboard">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Pending Picks" value={data?.pendingPicks ?? '—'} icon={Package} loading={isLoading} viewHref="/inventory/operations" />
        <StatCard title="Pending QC" value={data?.pendingQC ?? '—'} icon={ClipboardCheck} loading={isLoading} />
        <StatCard title="Low Stock" value={data?.lowStockCount ?? '—'} icon={AlertTriangle} loading={isLoading} viewHref="/inventory/products" />
        <StatCard title="Today's Deliveries" value={data?.todaysDeliveries ?? '—'} icon={Truck} loading={isLoading} />
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">Low Stock Alerts</h3>
        <AlertList
          items={(data?.lowStockItems ?? []).map((p) => ({
            id: p.id, level: 'warning' as const,
            title: p.label, description: `On hand: ${p.value}`,
            actionLabel: 'Reorder', actionHref: '/inventory/reorder-rules',
          }))}
          emptyMessage="No low-stock items"
        />
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">Recent Stock Movements</h3>
        <ActivityFeed items={data?.recentMovements ?? []} />
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
        <QuickActionGrid actions={[
          { label: 'Goods Receipt', href: '/inventory/operations', icon: Plus, variant: 'primary' },
          { label: 'Stock Transfer', href: '/inventory/internal-movements/new', icon: ArrowRightLeft },
          { label: 'Adjustment', href: '/inventory/adjustments', icon: Plus },
        ]} />
      </div>
    </DashboardLayout>
  );
}