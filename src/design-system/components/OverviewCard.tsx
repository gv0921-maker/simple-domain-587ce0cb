/**
 * OverviewCard — the Odoo Inventory "Overview" tile.
 *
 * Layout: coloured left border, title row with cog affordance, a large
 * primary action button on the left, a stats column on the right, and a
 * clickable bar chart across the bottom.
 */
import * as React from 'react';
import { cn } from '../lib/cn';
import { Card, Button } from './primitives';
import { BarChart, type Bar } from './BarChart';

export interface OverviewStat {
  key: string;
  label: string;
  value: number | string;
  /** Renders the number in red — for Late / overdue rows. */
  alert?: boolean;
  onClick?: () => void;
}

export interface OverviewCardProps {
  title: string;
  subtitle?: string;
  actionLabel: string;
  onAction?: () => void;
  stats: OverviewStat[];
  bars: Bar[];
  accent?: 'primary' | 'blue' | 'green' | 'amber';
  onBarClick?: (filterKey: string) => void;
  /** Slot for the CogMenu. */
  menu?: React.ReactNode;
  className?: string;
}

export function OverviewCard({
  title,
  subtitle,
  actionLabel,
  onAction,
  stats,
  bars,
  accent = 'primary',
  onBarClick,
  menu,
  className,
}: OverviewCardProps) {
  return (
    <Card accent={accent} className={cn('flex flex-col p-3', className)}>
      {/* header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold leading-tight text-[hsl(var(--ds-ink))]">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 truncate text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
              {subtitle}
            </p>
          )}
        </div>
        {menu}
      </div>

      {/* action + stats */}
      <div className="flex items-start justify-between gap-4">
        <Button
          variant="primary"
          onClick={onAction}
          className="h-auto min-h-[38px] whitespace-normal px-3 py-1.5 text-left text-[13px] leading-snug"
        >
          {actionLabel}
        </Button>

        <dl className="min-w-0 shrink-0 space-y-[3px] text-right">
          {stats.map((s) => {
            const Row = (
              <>
                <dt className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                  {s.label}
                </dt>
                <dd
                  className={cn(
                    'ml-3 min-w-[24px] text-[var(--ds-fs-sm)] font-semibold tabular-nums',
                    s.alert
                      ? 'text-[hsl(var(--ds-red))]'
                      : 'text-[hsl(var(--ds-ink))]',
                  )}
                >
                  {s.value}
                </dd>
              </>
            );

            return s.onClick ? (
              <button
                key={s.key}
                type="button"
                onClick={s.onClick}
                className="flex w-full items-baseline justify-end rounded-[2px] px-1 -mx-1 hover:bg-[hsl(var(--ds-surface-sunken))]"
              >
                {Row}
              </button>
            ) : (
              <div key={s.key} className="flex items-baseline justify-end px-1 -mx-1">
                {Row}
              </div>
            );
          })}
        </dl>
      </div>

      {/* chart */}
      <div className="mt-3 border-t border-[hsl(var(--ds-border))] pt-2.5">
        <BarChart bars={bars} onBarClick={onBarClick} />
      </div>
    </Card>
  );
}

/* --------------------------------------------------------- OverviewGrid */

export function OverviewGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-3 bg-[hsl(var(--ds-canvas))]',
        'grid-cols-1 md:grid-cols-2',
        className,
      )}
    >
      {children}
    </div>
  );
}
