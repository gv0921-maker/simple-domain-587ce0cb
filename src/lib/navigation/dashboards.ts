import type { DashboardRole } from '@/lib/services/dashboard/api';

export interface DashboardNavItem {
  label: string;
  href: string;
  roles: DashboardRole[];
}

export const DASHBOARDS_NAV: DashboardNavItem[] = [
  { label: 'My Dashboard', href: '/dashboards', roles: ['super_admin', 'admin', 'sales_manager', 'sales_rep', 'warehouse_operator', 'pos_operator', 'accountant', 'hr_manager', 'employee', 'unknown'] },
  { label: 'Admin', href: '/dashboards/admin', roles: ['super_admin', 'admin'] },
  { label: 'Sales Manager', href: '/dashboards/sales-manager', roles: ['super_admin', 'admin', 'sales_manager'] },
  { label: 'Sales Rep', href: '/dashboards/sales-rep', roles: ['super_admin', 'admin', 'sales_manager', 'sales_rep'] },
  { label: 'Warehouse', href: '/dashboards/warehouse', roles: ['super_admin', 'admin', 'warehouse_operator'] },
  { label: 'Accounting', href: '/dashboards/accountant', roles: ['super_admin', 'admin', 'accountant'] },
  { label: 'HR', href: '/dashboards/hr', roles: ['super_admin', 'admin', 'hr_manager'] },
  { label: 'Me', href: '/dashboards/me', roles: ['super_admin', 'admin', 'sales_manager', 'sales_rep', 'warehouse_operator', 'pos_operator', 'accountant', 'hr_manager', 'employee'] },
];

export function getDashboardsNavForRole(role: DashboardRole) {
  return DASHBOARDS_NAV.filter((i) => i.roles.includes(role));
}

export function getDefaultDashboardForRole(role: DashboardRole): string {
  switch (role) {
    case 'super_admin':
    case 'admin': return '/dashboards/admin';
    case 'sales_manager': return '/dashboards/sales-manager';
    case 'sales_rep': return '/dashboards/sales-rep';
    case 'warehouse_operator': return '/dashboards/warehouse';
    case 'accountant': return '/dashboards/accountant';
    case 'hr_manager': return '/dashboards/hr';
    case 'employee':
    case 'pos_operator':
    default: return '/dashboards/me';
  }
}