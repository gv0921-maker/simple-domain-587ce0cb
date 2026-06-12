import { FileText, ShoppingCart, Users, Clock, Plus } from 'lucide-react';
import { DashboardLayout } from './_shared';
import { StatCard } from '@/components/dashboard/StatCard';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { QuickActionGrid } from '@/components/dashboard/QuickActionGrid';
import { useSalesRepMetrics } from '@/hooks/dashboard';
import { useAuth } from '@/contexts/AuthContext';

export default function SalesRepDashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useSalesRepMetrics(user?.id);

  return (
    <DashboardLayout title="My Sales Dashboard">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="My Quotations" value={data?.myQuotations ?? '—'} icon={FileText} loading={isLoading} viewHref="/sales/quotations" />
        <StatCard title="My Orders MTD" value={data?.myOrdersMTD ?? '—'} icon={ShoppingCart} loading={isLoading} viewHref="/sales/orders" />
        <StatCard title="My Customers" value={data?.myCustomers ?? '—'} icon={Users} loading={isLoading} viewHref="/crm/contacts" />
        <StatCard title="Follow-ups Due" value={data?.followUpsDue ?? '—'} icon={Clock} loading={isLoading} />
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
          { label: 'Add Contact', href: '/crm/contacts/new', icon: Plus },
        ]} />
      </div>
    </DashboardLayout>
  );
}