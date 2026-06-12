import { AppLayout } from '@/components/layout/AppLayout';
import { useDashboardRole } from '@/hooks/dashboard';
import { getDashboardsNavForRole } from '@/lib/navigation/dashboards';
import type { DashboardRole } from '@/lib/services/dashboard/api';
import type { ReactNode } from 'react';

export function formatINR(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function DashboardLayout({ title, children }: { title: string; children: ReactNode }) {
  const { data: role = 'unknown' as DashboardRole } = useDashboardRole();
  const nav = getDashboardsNavForRole(role);
  return (
    <AppLayout title={title} moduleNav={nav.map((n) => ({ label: n.label, href: n.href }))}>
      <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto w-full">{children}</div>
    </AppLayout>
  );
}