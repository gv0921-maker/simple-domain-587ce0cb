import { DollarSign, AlertCircle, Wallet, Receipt, Plus } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { DashboardLayout, formatINR } from './_shared';
import { StatCard } from '@/components/dashboard/StatCard';
import { TrendChart } from '@/components/dashboard/TrendChart';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { QuickActionGrid } from '@/components/dashboard/QuickActionGrid';
import { Card } from '@/components/ui/card';
import { useAccountantMetrics, useDashboardRole } from '@/hooks/dashboard';

export default function AccountantDashboard() {
  const { data: role } = useDashboardRole();
  const { data, isLoading } = useAccountantMetrics();

  if (role && !['super_admin','admin','accountant'].includes(role)) {
    return <Navigate to="/dashboards" replace />;
  }

  return (
    <DashboardLayout title="Accounting Dashboard">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="To Collect" value={data ? formatINR(data.toCollect) : '—'} icon={DollarSign} loading={isLoading} viewHref="/invoicing" />
        <StatCard title="Overdue" value={data ? formatINR(data.overdue) : '—'} icon={AlertCircle} loading={isLoading} />
        <StatCard title="Collected MTD" value={data ? formatINR(data.collectedMTD) : '—'} icon={Wallet} loading={isLoading} />
        <StatCard title="GST MTD" value={data ? formatINR(data.gstMTD) : '—'} icon={Receipt} loading={isLoading} />
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Aging Receivables</h3>
        <TrendChart data={data?.agingChart ?? []} type="bar" />
      </Card>

      <div>
        <h3 className="text-sm font-semibold mb-3">Recent Paid Invoices</h3>
        <ActivityFeed items={data?.recentPaidInvoices ?? []} />
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
        <QuickActionGrid actions={[
          { label: 'Record Payment', href: '/invoicing/payments', icon: Plus, variant: 'primary' },
          { label: 'New Invoice', href: '/invoicing/new', icon: Plus },
        ]} />
      </div>
    </DashboardLayout>
  );
}