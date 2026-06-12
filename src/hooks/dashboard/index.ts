import { useQuery } from '@tanstack/react-query';
import {
  getDashboardRole,
  getSuperAdminMetrics,
  getSalesManagerMetrics,
  getSalesRepMetrics,
  getWarehouseOperatorMetrics,
  getAccountantMetrics,
  getHRManagerMetrics,
  getEmployeeMetrics,
} from '@/lib/services/dashboard/api';

const common = { staleTime: 60_000, gcTime: 5 * 60_000 };

export function useDashboardRole() {
  return useQuery({ queryKey: ['dashboard', 'role'], queryFn: getDashboardRole, ...common });
}
export function useSuperAdminMetrics(enabled = true) {
  return useQuery({ queryKey: ['dashboard', 'super_admin'], queryFn: getSuperAdminMetrics, enabled, ...common });
}
export function useSalesManagerMetrics(enabled = true) {
  return useQuery({ queryKey: ['dashboard', 'sales_manager'], queryFn: getSalesManagerMetrics, enabled, ...common });
}
export function useSalesRepMetrics(userId: string | undefined) {
  return useQuery({
    queryKey: ['dashboard', 'sales_rep', userId],
    queryFn: () => getSalesRepMetrics(userId!),
    enabled: !!userId,
    ...common,
  });
}
export function useWarehouseMetrics(enabled = true) {
  return useQuery({ queryKey: ['dashboard', 'warehouse'], queryFn: getWarehouseOperatorMetrics, enabled, ...common });
}
export function useAccountantMetrics(enabled = true) {
  return useQuery({ queryKey: ['dashboard', 'accountant'], queryFn: getAccountantMetrics, enabled, ...common });
}
export function useHRManagerMetrics(enabled = true) {
  return useQuery({ queryKey: ['dashboard', 'hr'], queryFn: getHRManagerMetrics, enabled, ...common });
}
export function useEmployeeMetrics(userId: string | undefined) {
  return useQuery({
    queryKey: ['dashboard', 'employee', userId],
    queryFn: () => getEmployeeMetrics(userId!),
    enabled: !!userId,
    ...common,
  });
}