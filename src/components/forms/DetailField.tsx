import { cn } from '@/lib/utils';

interface DetailFieldProps {
  label: string;
  value: React.ReactNode;
  className?: string;
  highlight?: boolean;
  isLink?: boolean;
  onClick?: () => void;
}

export function DetailField({ label, value, className, highlight, isLink, onClick }: DetailFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="text-sm text-muted-foreground">{label}</span>
      {isLink || onClick ? (
        <button
          onClick={onClick}
          className={cn(
            'text-sm text-left transition-colors',
            highlight ? 'text-destructive font-medium' : 'text-info hover:underline'
          )}
        >
          {value}
        </button>
      ) : (
        <span className={cn(
          'text-sm',
          highlight ? 'text-destructive font-medium' : 'text-foreground'
        )}>
          {value}
        </span>
      )}
    </div>
  );
}

interface DetailGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

export function DetailGrid({ children, columns = 2, className }: DetailGridProps) {
  return (
    <div className={cn(
      'grid gap-x-8 gap-y-4',
      columns === 2 && 'grid-cols-1 md:grid-cols-2',
      columns === 3 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
      columns === 4 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
      className
    )}>
      {children}
    </div>
  );
}
