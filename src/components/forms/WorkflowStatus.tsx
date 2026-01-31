import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

export interface WorkflowStep {
  id: string;
  label: string;
  status: 'completed' | 'current' | 'upcoming';
}

interface WorkflowStatusProps {
  steps: WorkflowStep[];
  onStepClick?: (stepId: string) => void;
}

export function WorkflowStatus({ steps, onStepClick }: WorkflowStatusProps) {
  return (
    <div className="flex items-center gap-1">
      {steps.map((step, index) => (
        <div key={step.id} className="flex items-center">
          <button
            onClick={() => onStepClick?.(step.id)}
            disabled={step.status === 'upcoming'}
            className={cn(
              'px-4 py-1.5 text-sm font-medium transition-all duration-200 relative',
              'first:rounded-l-md last:rounded-r-md',
              step.status === 'completed' && 'bg-muted text-muted-foreground hover:bg-muted/80',
              step.status === 'current' && 'bg-primary text-primary-foreground shadow-sm',
              step.status === 'upcoming' && 'bg-secondary text-muted-foreground cursor-not-allowed',
              onStepClick && step.status !== 'upcoming' && 'hover:scale-105'
            )}
          >
            <span className="flex items-center gap-1.5">
              {step.status === 'completed' && <Check className="h-3 w-3" />}
              {step.label}
            </span>
          </button>
          {index < steps.length - 1 && (
            <div className={cn(
              'w-0 h-0 border-y-[12px] border-y-transparent border-l-[8px] -ml-px z-10',
              step.status === 'completed' && 'border-l-muted',
              step.status === 'current' && 'border-l-primary',
              step.status === 'upcoming' && 'border-l-secondary'
            )} />
          )}
        </div>
      ))}
    </div>
  );
}
