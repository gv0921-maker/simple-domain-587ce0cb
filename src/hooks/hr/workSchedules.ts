import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/services/hr/workSchedules';

export const workScheduleKeys = {
  all: ['hr', 'workSchedules'] as const,
  forEmployee: (id: string) => ['hr', 'workSchedules', 'employee', id] as const,
  history: (id: string) => ['hr', 'workSchedules', 'history', id] as const,
  allEmployees: () => ['hr', 'workSchedules', 'all'] as const,
};

export const useEmployeeWorkSchedule = (employeeId: string | undefined) =>
  useQuery({
    queryKey: employeeId ? workScheduleKeys.forEmployee(employeeId) : ['noop'],
    queryFn: () => api.getEmployeeWorkSchedule(employeeId!),
    enabled: !!employeeId,
  });

export const useAllEmployeeSchedules = () =>
  useQuery({
    queryKey: workScheduleKeys.allEmployees(),
    queryFn: api.getAllEmployeeSchedules,
  });

export const useEmployeeScheduleHistory = (employeeId: string | undefined) =>
  useQuery({
    queryKey: employeeId ? workScheduleKeys.history(employeeId) : ['noop'],
    queryFn: () => api.getEmployeeScheduleHistory(employeeId!),
    enabled: !!employeeId,
  });

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: workScheduleKeys.all });
}

export function useSetEmployeeWorkSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { employeeId: string; schedule: api.ScheduleTemplate & { effective_from?: string } }) =>
      api.setEmployeeWorkSchedule(a.employeeId, a.schedule),
    onSuccess: () => invalidate(qc),
  });
}

export function useBulkUpdateSchedules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { employeeIds: string[]; template: api.ScheduleTemplate & { effective_from?: string } }) =>
      api.bulkUpdateSchedules(a.employeeIds, a.template),
    onSuccess: () => invalidate(qc),
  });
}

export function useRecalculateAttendanceMetrics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { employeeId: string; date: string }) =>
      api.recalculateAttendanceMetrics(a.employeeId, a.date),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'attendance'] }),
  });
}

export function useBulkRecalculateMetrics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pairs: Array<{ employeeId: string; date: string }>) =>
      api.bulkRecalculateMetrics(pairs),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'attendance'] }),
  });
}