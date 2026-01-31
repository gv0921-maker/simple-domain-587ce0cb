import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Star, MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FormHeaderProps {
  title: string;
  subtitle?: string;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  pagination?: {
    current: number;
    total: number;
    onPrevious: () => void;
    onNext: () => void;
  };
  actions?: React.ReactNode;
  className?: string;
}

export function FormHeader({
  title,
  subtitle,
  isFavorite,
  onToggleFavorite,
  pagination,
  actions,
  className,
}: FormHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-4 px-6 bg-card border-b border-border', className)}>
      <div className="flex items-center gap-3 min-w-0">
        {onToggleFavorite && (
          <button
            onClick={onToggleFavorite}
            className="text-muted-foreground hover:text-warning transition-colors"
          >
            <Star className={cn('h-5 w-5', isFavorite && 'fill-warning text-warning')} />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground truncate">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {actions}
        
        {pagination && (
          <div className="flex items-center gap-1 ml-4 pl-4 border-l border-border">
            <span className="text-sm text-muted-foreground mr-2">
              {pagination.current} / {pagination.total}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={pagination.onPrevious}
              disabled={pagination.current <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={pagination.onNext}
              disabled={pagination.current >= pagination.total}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
