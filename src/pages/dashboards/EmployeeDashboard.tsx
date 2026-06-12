import { Briefcase, Coffee, Clock, MessageSquare, FileText, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DashboardLayout, formatINR } from './_shared';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QuickActionGrid } from '@/components/dashboard/QuickActionGrid';
import { useEmployeeMetrics } from '@/hooks/dashboard';
import { useAuth } from '@/contexts/AuthContext';

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useEmployeeMetrics(user?.id);
  const active = data?.activeSession;

  return (
    <DashboardLayout title="My Dashboard">
      {/* Prominent Clock In/Out card */}
      <Card className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 border-l-4 border-l-primary">
        <div className="flex items-center gap-3 flex-1">
          {active
            ? (active.type === 'work'
                ? <Briefcase className="h-10 w-10 text-emerald-600" />
                : <Coffee className="h-10 w-10 text-amber-600" />)
            : <Clock className="h-10 w-10 text-muted-foreground" />}
          <div>
            <p className="text-lg font-semibold">
              {isLoading ? 'Loading…'
                : active ? (active.type === 'work' ? 'Currently Working' : 'On Break')
                : 'Not Clocked In'}
            </p>
            {active && (
              <p className="text-sm text-muted-foreground">
                Since {new Date(active.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        </div>
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link to="/attendance/clock-in">{active ? 'Clock Out' : 'Clock In'}</Link>
        </Button>
      </Card>

      {/* Leave balances */}
      <div>
        <h3 className="text-sm font-semibold mb-3">My Leave Balance</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {(data?.leaveBalances ?? []).map((b) => (
            <Card key={b.id} className="p-4">
              <p className="text-xs text-muted-foreground">{b.label}</p>
              <p className="text-xl font-semibold">{b.value}</p>
            </Card>
          ))}
          {!isLoading && !(data?.leaveBalances?.length) && (
            <Card className="p-4 text-sm text-muted-foreground col-span-full">No leave balances</Card>
          )}
        </div>
      </div>

      {/* Latest payslip */}
      <Card className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">Latest Payslip</p>
            {data?.latestPayslip ? (
              <p className="text-xs text-muted-foreground">
                {data.latestPayslip.payslip_number} · Net {formatINR(data.latestPayslip.net_pay)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">No payslips yet</p>
            )}
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/payroll/my-payslips">View</Link>
        </Button>
      </Card>

      {/* Mentions */}
      <Card className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageSquare className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">Unread Mentions</p>
            <p className="text-xs text-muted-foreground">{data?.pendingMentions ?? 0} unread chat notifications</p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/chat/mentions">Open</Link>
        </Button>
      </Card>

      <div>
        <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
        <QuickActionGrid actions={[
          { label: 'Apply Leave', href: '/leave/apply', icon: Plus, variant: 'primary' },
          { label: 'Chat', href: '/chat', icon: MessageSquare },
          { label: 'My Payslips', href: '/payroll/my-payslips', icon: FileText },
        ]} />
      </div>
    </DashboardLayout>
  );
}