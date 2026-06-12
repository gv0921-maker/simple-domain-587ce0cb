import { TrendingUp, DollarSign, Target, ShoppingBag, Plus } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { DashboardLayout, formatINR } from './_shared';
import { StatCard } from '@/components/dashboard/StatCard';
import { MiniRanking } from '@/components/dashboard/MiniRanking';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { QuickActionGrid } from '@/components/dashboard/QuickActionGrid';
import { useSalesManagerMetrics, useDashboardRole } from '@/hooks/dashboard';

export default function SalesManagerDashboard() {
  const { data: role } = useDashboardRole();
  const { data, isLoading } = useSalesManagerMetrics();

  if (role && !['super_admin','admin','sales_manager'].includes(role)) {
    return <Navigate to="/dashboards" replace />;
  }

  return (
    <DashboardLayout title="Sales Manager Dashboard">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Pipeline Value" value={data ? formatINR(data.pipelineValue) : '—'} icon={Target} loading={isLoading} viewHref="/crm" />
        <StatCard title="Conversion Rate" value={data ? `${data.conversionRate.toFixed(1)}%` : '—'} icon={TrendingUp} loading={isLoading} />
        <StatCard title="Revenue MTD" value={data ? formatINR(data.revenueMTD) : '—'} icon={DollarSign} loading={isLoading} />
        <StatCard title="Avg Deal Size" value={data ? formatINR(data.avgDealSize) : '—'} icon={ShoppingBag} loading={isLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MiniRanking
          title="Top Customers (MTD)"
          items={(data?.topCustomers ?? []).map((c) => ({ id: c.id, label: c.label, value: formatINR(c.value) }))}
        />
        <MiniRanking
          title="Top Salespeople (MTD)"
          items={(data?.topSalespeople ?? []).map((c) => ({ id: c.id, label: c.label, value: formatINR(c.value) }))}
        />
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">Recent Activity</h3>
        <ActivityFeed items={data?.recentActivities ?? []} />
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
        <QuickActionGrid actions={[
          { label: 'New Quotation', href: '/sales/quotations/new', icon: Plus, variant: 'primary' },
          { label: 'New Order', href: '/sales/orders/new', icon: Plus },
          { label: 'View Pipeline', href: '/crm', icon: Target },
        ]} />
      </div>
    </DashboardLayout>
  );
}