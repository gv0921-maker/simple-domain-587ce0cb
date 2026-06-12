import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from 'lucide-react';
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
  // Extended (dashboard) props
  icon?: LucideIcon;
  value?: string | number;
  trend?: { direction: 'up' | 'down'; value: string };
  viewHref?: string;
  loading?: boolean;
}

export function StatCard({
  title,
  badge,
  stats,
  chart,
  className,
  icon: Icon,
  value,
  trend,
  viewHref,
  loading,
}: StatCardProps) {
  if (loading) {
    return (
      <Card className={cn('p-4 flex flex-col h-full', className)}>
        <Skeleton className="h-4 w-24 mb-3" />
        <Skeleton className="h-8 w-32 mb-2" />
        <Skeleton className="h-3 w-16" />
      </Card>
    );
  }

  // Simple KPI variant
  if (value !== undefined && !stats && !badge) {
    return (
      <Card className={cn('p-4 flex flex-col h-full animate-fade-in', className)}>
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {title}
          </h3>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="text-2xl font-semibold text-foreground">{value}</div>
        <div className="mt-2 flex items-center justify-between">
          {trend ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs font-medium',
                trend.direction === 'up' ? 'text-emerald-600' : 'text-destructive'
              )}
            >
              {trend.direction === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {trend.value}
            </span>
          ) : <span />}
          {viewHref && (
            <Link to={viewHref} className="text-xs text-primary hover:underline">
              View
            </Link>
          )}
        </div>
      </Card>
    );
  }

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
