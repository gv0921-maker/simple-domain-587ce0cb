import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as engine from '@/lib/services/inventory/qcEngine';

export const qcEngineKeys = {
  all: ['qc-engine'] as const,
  doc: (t: engine.QCDocumentType, id: string) => ['qc-engine', t, id] as const,
};

export function useQCInspections(t: engine.QCDocumentType, id: string | undefined) {
  return useQuery({
    queryKey: id ? qcEngineKeys.doc(t, id) : ['noop'],
    queryFn: () => engine.getQCInspections(t, id!),
    enabled: !!id,
  });
}

export function useRecordScan(t: engine.QCDocumentType, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<engine.RecordScanInput, 'documentType' | 'documentId'>) =>
      engine.recordScan({ ...input, documentType: t, documentId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qcEngineKeys.doc(t, documentId) }),
  });
}

export function useRecordQCResult(t: engine.QCDocumentType, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { inspectionId: string; status: 'pass' | 'fail'; notes?: string }) =>
      engine.recordQCResult(args.inspectionId, args.status, args.notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: qcEngineKeys.doc(t, documentId) }),
  });
}

export function useUploadQCPhoto(t: engine.QCDocumentType, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { inspection: engine.QCInspection; file: File }) =>
      engine.uploadQCPhoto(args.inspection, args.file),
    onSuccess: () => qc.invalidateQueries({ queryKey: qcEngineKeys.doc(t, documentId) }),
  });
}

export function useRemoveQCPhoto(t: engine.QCDocumentType, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { inspection: engine.QCInspection; url: string }) =>
      engine.removeQCPhoto(args.inspection, args.url),
    onSuccess: () => qc.invalidateQueries({ queryKey: qcEngineKeys.doc(t, documentId) }),
  });
}