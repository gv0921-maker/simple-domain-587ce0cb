import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useDashboardRole } from '@/hooks/dashboard';
import { getDefaultDashboardForRole } from '@/lib/navigation/dashboards';
import { Skeleton } from '@/components/ui/skeleton';
import { AppLayout } from '@/components/layout/AppLayout';

export default function DashboardsHome() {
  const { data: role, isLoading } = useDashboardRole();
  const navigate = useNavigate();

  useEffect(() => {
    if (role) navigate(getDefaultDashboardForRole(role), { replace: true });
  }, [role, navigate]);

  if (isLoading || !role) {
    return (
      <AppLayout title="Dashboards">
        <div className="p-6 space-y-4 max-w-3xl">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1,2,3,4].map((i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      </AppLayout>
    );
  }
  return <Navigate to={getDefaultDashboardForRole(role)} replace />;
}