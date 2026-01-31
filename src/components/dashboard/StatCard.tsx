import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface StatItem {
  label: string;
  value: number;
  type?: 'default' | 'late' | 'backorder';
}

interface StatCardProps {
  title: string;
  badge?: {
    label: string;
    count: number;
    variant?: 'default' | 'secondary' | 'destructive' | 'outline';
  };
  stats?: StatItem[];
  chart?: React.ReactNode;
  className?: string;
}

export function StatCard({ title, badge, stats, chart, className }: StatCardProps) {
  return (
    <Card className={cn('p-4 flex flex-col h-full animate-fade-in', className)}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <h3 className="text-sm font-semibold text-primary uppercase tracking-wide">
          {title}
        </h3>
        {badge && (
          <div className="text-sm text-muted-foreground">
            {stats?.map((stat) => (
              <div key={stat.label} className="flex justify-between gap-4">
                <span className={cn(
                  stat.type === 'late' && 'text-destructive',
                  stat.type === 'backorder' && 'text-warning'
                )}>
                  {stat.label}
                </span>
                <span className="font-medium">{stat.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Badge */}
      {badge && (
        <Badge
          variant={badge.variant || 'default'}
          className="w-fit mb-4 transition-transform duration-150 hover:scale-105"
        >
          {badge.count} {badge.label}
        </Badge>
      )}

      {/* Stats list (alternative layout) */}
      {stats && !badge && (
        <div className="space-y-1 mb-4">
          {stats.map((stat) => (
            <div key={stat.label} className="flex justify-between text-sm">
              <span className={cn(
                'text-muted-foreground',
                stat.type === 'late' && 'text-destructive',
                stat.type === 'backorder' && 'text-warning'
              )}>
                {stat.label}
              </span>
              <span className="font-medium text-foreground">{stat.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Chart area */}
      {chart && <div className="flex-1 mt-auto">{chart}</div>}
    </Card>
  );
}
