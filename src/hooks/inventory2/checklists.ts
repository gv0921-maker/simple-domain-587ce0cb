/**
 * Inventory 2 — QC checklist configuration hooks. Pass 11.
 *
 * Error policy (Rule 5): nothing catches. Callers render the message inline.
 *
 * Invalidation deliberately reaches the QC and document-quality caches too. A
 * product's "no checklist is defined" warning is derived from these rows, so
 * adding a template must clear that warning without a reload — otherwise the
 * person who just fixed the problem is still looking at the complaint.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as checklists from '@/lib/services/inventory2/checklists';
import { inv2Keys } from './receipts';

export const inv2ChecklistKeys = {
  all: ['inv2', 'checklists'] as const,
  list: (productId?: string) => [...inv2ChecklistKeys.all, 'list', productId ?? 'all'] as const,
  productOptions: () => [...inv2ChecklistKeys.all, 'productOptions'] as const,
};

export const useInv2Checklists = (productId?: string) =>
  useQuery({
    queryKey: inv2ChecklistKeys.list(productId),
    queryFn: () => checklists.listChecklists(productId),
  });

/**
 * Scale of a required check, fetched only when a warning is actually pending —
 * a global check counts every unit in the system, so this is not something to
 * run on every keystroke.
 */
export const useRequiredCheckImpact = (productId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: [...inv2ChecklistKeys.all, 'impact', productId ?? 'global'],
    queryFn: () => checklists.requiredCheckImpact(productId),
    enabled,
  });

export const useInv2ChecklistProducts = () =>
  useQuery({
    queryKey: inv2ChecklistKeys.productOptions(),
    queryFn: checklists.listChecklistProductOptions,
  });

function useChecklistInvalidation() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: inv2ChecklistKeys.all });
    // The Quality segment's missingChecklist flag and the QC runner's checklist
    // both read these rows. Both live under the inv2 receipt/QC keys.
    void qc.invalidateQueries({ queryKey: inv2Keys.all });
    void qc.invalidateQueries({ queryKey: ['inv2', 'qc'] });
  };
}

export function useCreateChecklist() {
  const invalidate = useChecklistInvalidation();
  return useMutation({
    mutationFn: (input: checklists.ChecklistInput) => checklists.createChecklist(input),
    onSuccess: invalidate,
  });
}

export function useUpdateChecklist() {
  const invalidate = useChecklistInvalidation();
  return useMutation({
    mutationFn: (v: { id: string; patch: Parameters<typeof checklists.updateChecklist>[1] }) =>
      checklists.updateChecklist(v.id, v.patch),
    onSuccess: invalidate,
  });
}

export function useSetChecklistActive() {
  const invalidate = useChecklistInvalidation();
  return useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) =>
      checklists.setChecklistActive(v.id, v.isActive),
    onSuccess: invalidate,
  });
}
