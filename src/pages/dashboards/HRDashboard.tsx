import { Users, UserMinus, ClipboardList, CalendarCheck, Plus, Cake, FileText } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { DashboardLayout } from './_shared';
import { StatCard } from '@/components/dashboard/StatCard';
import { MiniRanking } from '@/components/dashboard/MiniRanking';
import { QuickActionGrid } from '@/components/dashboard/QuickActionGrid';
import { useHRManagerMetrics, useDashboardRole } from '@/hooks/dashboard';

export default function HRDashboard() {
  const { data: role } = useDashboardRole();
  const { data, isLoading } = useHRManagerMetrics();

  if (role && !['super_admin','admin','hr_manager'].includes(role)) {
    return <Navigate to="/dashboards" replace />;
  }

  return (
    <DashboardLayout title="HR Dashboard">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Active Employees" value={data?.activeEmployees ?? '—'} icon={Users} loading={isLoading} viewHref="/employees/directory" />
        <StatCard title="On Leave Today" value={data?.onLeaveToday ?? '—'} icon={UserMinus} loading={isLoading} viewHref="/employees/leave" />
        <StatCard title="Pending Leaves" value={data?.pendingLeaveApprovals ?? '—'} icon={ClipboardList} loading={isLoading} viewHref="/leave/admin/requests" />
        <StatCard title="Attendance Today" value={data?.attendanceToday ?? '—'} icon={CalendarCheck} loading={isLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MiniRanking
          title="Upcoming Birthdays"
          items={(data?.upcomingBirthdays ?? []).map((b) => ({ id: b.id, label: b.label, subtitle: b.subtitle, value: b.value }))}
        />
        <MiniRanking
          title="Expiring Contracts (30 days)"
          items={(data?.expiringContracts ?? []).map((c) => ({ id: c.id, label: c.label, value: c.value }))}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Pending Appraisals" value={data?.pendingAppraisals ?? '—'} icon={FileText} loading={isLoading} viewHref="/appraisals" />
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
        <QuickActionGrid actions={[
          { label: 'Add Employee', href: '/employees/new', icon: Plus, variant: 'primary' },
          { label: 'Approve Leaves', href: '/leave/admin/requests', icon: ClipboardList },
          { label: 'Run Payroll', href: '/payroll/periods', icon: Cake },
        ]} />
      </div>
    </DashboardLayout>
  );
}