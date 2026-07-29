import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/services/numbering/api';

export const numberingKeys = {
  all: ['numbering'] as const,
  settings: () => [...numberingKeys.all, 'settings'] as const,
  fy: () => [...numberingKeys.all, 'fy'] as const,
  preview: (type: string) => [...numberingKeys.all, 'preview', type] as const,
  sequences: () => [...numberingKeys.all, 'sequences'] as const,
};

export function useCurrentFY() {
  return useQuery({ queryKey: numberingKeys.fy(), queryFn: api.getCurrentFY });
}

export function useNumberingSettings() {
  return useQuery({ queryKey: numberingKeys.settings(), queryFn: api.getNumberingSettings });
}

export function useUpdateNumberingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updateNumberingSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: numberingKeys.all });
    },
  });
}

export function usePreviewNextNumber(type: api.DocumentType | string, enabled = true) {
  return useQuery({
    queryKey: numberingKeys.preview(type),
    queryFn: () => api.previewNextNumber(type),
    enabled,
    staleTime: 10_000,
  });
}

export function useNumberingSequences() {
  return useQuery({ queryKey: numberingKeys.sequences(), queryFn: api.listNumberingSequences });
}

/** Invalidates previews too — a counter change moves every next-number preview. */
export function useCreateNumberingSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createNumberingSequence,
    onSuccess: () => qc.invalidateQueries({ queryKey: numberingKeys.all }),
  });
}

export function useAdvanceNumberingSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lastNumber }: { id: string; lastNumber: number }) =>
      api.advanceNumberingSequence(id, lastNumber),
    onSuccess: () => qc.invalidateQueries({ queryKey: numberingKeys.all }),
  });
}

export { api as numberingApi };