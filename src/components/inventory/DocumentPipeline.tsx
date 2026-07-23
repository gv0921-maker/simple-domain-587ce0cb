import { WorkflowStatus, type WorkflowStep } from '@/components/forms/WorkflowStatus';

export type DocKind = 'goods_receipt' | 'ito' | 'delivery_note' | 'correction_order';

const STAGES: Record<DocKind, string[]> = {
  goods_receipt: ['draft', 'in_progress', 'completed'],
  ito: ['draft', 'in_progress', 'completed'],
  delivery_note: ['draft', 'confirmed', 'delivered'],
  correction_order: ['draft', 'sent', 'in_progress', 'completed', 'closed'],
};

const LABELS: Record<string, string> = {
  draft: 'Draft',
  in_progress: 'In QC',
  confirmed: 'Ready',
  completed: 'Completed',
  delivered: 'Delivered',
  sent: 'Sent',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

// Map arbitrary DB statuses onto our canonical stage keys.
function canonical(kind: DocKind, status: string): string {
  const s = (status || '').toLowerCase();
  if (kind === 'goods_receipt') {
    if (['pending', 'pending_qc', 'in_progress', 'receiving'].includes(s)) return 'in_progress';
    if (['completed', 'done'].includes(s)) return 'completed';
    return 'draft';
  }
  if (kind === 'ito') {
    if (['completed', 'done'].includes(s)) return 'completed';
    if (['in_transit', 'partly_completed', 'in_progress', 'pending', 'scanning'].includes(s))
      return 'in_progress';
    return 'draft';
  }
  if (kind === 'delivery_note') {
    if (['delivered', 'done'].includes(s)) return 'delivered';
    if (['confirmed', 'ready', 'waiting', 'pending'].includes(s)) return 'confirmed';
    return 'draft';
  }
  // correction_order
  if (['closed'].includes(s)) return 'closed';
  if (['completed'].includes(s)) return 'completed';
  if (['in_progress'].includes(s)) return 'in_progress';
  if (['sent'].includes(s)) return 'sent';
  return 'draft';
}

interface Props {
  kind: DocKind;
  status: string;
}

export function DocumentPipeline({ kind, status }: Props) {
  const stages = STAGES[kind];
  const isCancelled = (status || '').toLowerCase() === 'cancelled';
  const current = canonical(kind, status);
  const currentIdx = stages.indexOf(current);

  const steps: WorkflowStep[] = stages.map((s, i) => ({
    id: s,
    label: LABELS[s] ?? s,
    status:
      isCancelled ? 'upcoming'
      : i < currentIdx ? 'completed'
      : i === currentIdx ? 'current'
      : 'upcoming',
  }));

  return (
    <div className="w-full overflow-x-auto">
      <WorkflowStatus steps={steps} />
      {isCancelled && (
        <div className="mt-2 text-xs text-destructive font-medium">Cancelled</div>
      )}
    </div>
  );
}

export default DocumentPipeline;