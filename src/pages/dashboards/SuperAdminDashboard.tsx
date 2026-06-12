import { DollarSign, ShoppingCart, FileText, Wallet, AlertTriangle, Users, Package, Factory } from 'lucide-react';
import { DashboardLayout, formatINR } from './_shared';
import { StatCard } from '@/components/dashboard/StatCard';
import { TrendChart } from '@/components/dashboard/TrendChart';
import { AlertList } from '@/components/dashboard/AlertList';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { Card } from '@/components/ui/card';
import { useSuperAdminMetrics } from '@/hooks/dashboard';
import { useDashboardRole } from '@/hooks/dashboard';
import { Navigate } from 'react-router-dom';

export default function SuperAdminDashboard() {
  const { data: role } = useDashboardRole();
  const { data, isLoading } = useSuperAdminMetrics();

  if (role && role !== 'super_admin' && role !== 'admin') {
    return <Navigate to="/dashboards" replace />;
  }

  return (
    <DashboardLayout title="Admin Dashboard">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Revenue MTD" value={data ? formatINR(data.revenueMTD) : '—'} icon={DollarSign} loading={isLoading} />
        <StatCard title="Active Orders" value={data?.activeOrders ?? '—'} icon={ShoppingCart} viewHref="/sales/orders" loading={isLoading} />
        <StatCard title="Pending Invoices" value={data?.pendingInvoices ?? '—'} icon={FileText} viewHref="/invoicing" loading={isLoading} />
        <StatCard title="Cash Position" value={data ? formatINR(data.cashPosition) : '—'} icon={Wallet} loading={isLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Revenue — last 6 months</h3>
          <TrendChart data={data?.revenueTrend ?? []} type="bar" />
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Order Status</h3>
          <TrendChart data={data?.orderStatusBreakdown ?? []} type="bar" color="hsl(var(--accent-foreground))" />
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Customers" value={data?.totalCustomers ?? '—'} icon={Users} loading={isLoading} />
        <StatCard title="Employees" value={data?.totalEmployees ?? '—'} icon={Users} loading={isLoading} />
        <StatCard title="Active MOs" value={data?.activeMOs ?? '—'} icon={Factory} loading={isLoading} />
        <StatCard title="Pending QC" value={data?.pendingQC ?? '—'} icon={Package} loading={isLoading} />
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Alerts</h3>
        <AlertList
          items={[
            ...(data && data.lowStockCount > 0 ? [{ id: 'low-stock', level: 'warning' as const, title: `${data.lowStockCount} low-stock items`, actionLabel: 'View', actionHref: '/inventory/products' }] : []),
            ...(data && data.pendingInvoices > 0 ? [{ id: 'pending-inv', level: 'info' as const, title: `${data.pendingInvoices} pending invoices`, actionLabel: 'View', actionHref: '/invoicing' }] : []),
            ...(data && data.pendingQC > 0 ? [{ id: 'pending-qc', level: 'info' as const, title: `${data.pendingQC} QC pending`, actionLabel: 'View', actionHref: '/inventory/operations' }] : []),
          ]}
          emptyMessage="No active alerts"
        />
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">Recent Activity</h3>
        <ActivityFeed items={[]} emptyMessage="No recent activity" />
      </div>
    </DashboardLayout>
  );
}