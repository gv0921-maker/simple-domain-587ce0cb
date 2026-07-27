/**
 * Tiny clickable bar chart — inline SVG, no chart library.
 *
 * recharts IS already a dependency, but it renders a full responsive
 * container + tooltip layer for what is here a 5-bar sparkline inside a
 * dashboard card. Hand-rolled SVG is ~40 lines, gives exact control over the
 * click target, and adds nothing to the bundle.
 */
import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Bars are coloured by time bucket, not by brand. `late` reads red, `soon`
 * amber, `later` green — so urgency is legible at a glance without a legend.
 * The maroon accent stays reserved for UI chrome (buttons, ribbon, links).
 */
export type BarTone = 'late' | 'soon' | 'later' | 'primary';

export interface Bar {
  /** Value passed back to onBarClick — the filter this bar represents. */
  key: string;
  label: string;
  value: number;
  tone?: BarTone;
}

const toneFill: Record<BarTone, string> = {
  late: 'hsl(var(--ds-bar-late))',
  soon: 'hsl(var(--ds-bar-soon))',
  later: 'hsl(var(--ds-bar-later))',
  primary: 'hsl(var(--ds-primary))',
};

/**
 * Default bucket→tone mapping, applied when a bar omits an explicit `tone`.
 * Keyed on the bar's filter key so callers get semantic colour for free.
 */
const bucketTone: Record<string, BarTone> = {
  late: 'late',
  today: 'soon',
  week: 'soon',
  next: 'later',
  later: 'later',
};

export function toneForBar(b: Bar): BarTone {
  return b.tone ?? bucketTone[b.key] ?? 'primary';
}

export function BarChart({
  bars,
  height = 56,
  onBarClick,
  className,
}: {
  bars: Bar[];
  height?: number;
  onBarClick?: (filterKey: string) => void;
  className?: string;
}) {
  const [hovered, setHovered] = React.useState<string | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.value));

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {bars.map((b) => {
          const pct = (b.value / max) * 100;
          const isHot = hovered === b.key;
          const interactive = Boolean(onBarClick);

          return (
            <button
              key={b.key}
              type="button"
              disabled={!interactive}
              onClick={interactive ? () => onBarClick!(b.key) : undefined}
              onMouseEnter={() => setHovered(b.key)}
              onMouseLeave={() => setHovered(null)}
              title={interactive ? `${b.label}: ${b.value} — click to filter` : `${b.label}: ${b.value}`}
              aria-label={`${b.label}: ${b.value}${interactive ? '. Click to filter the list.' : ''}`}
              className={cn(
                'group relative flex flex-1 flex-col justify-end',
                interactive && 'cursor-pointer',
              )}
              style={{ height }}
            >
              {/* value caption, revealed on hover */}
              <span
                className={cn(
                  'absolute -top-0.5 left-1/2 -translate-x-1/2 text-[10px] font-semibold',
                  'text-[hsl(var(--ds-ink-muted))] transition-opacity duration-100',
                  isHot ? 'opacity-100' : 'opacity-0',
                )}
              >
                {b.value}
              </span>
              <span
                className="w-full rounded-t-[2px] transition-all duration-100"
                style={{
                  height: `${Math.max(6, pct)}%`,
                  background: toneFill[toneForBar(b)],
                  opacity: hovered && !isHot ? 0.45 : 1,
                }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5">
        {bars.map((b) => (
          <div
            key={b.key}
            className="flex-1 truncate text-center text-[10px] text-[hsl(var(--ds-ink-subtle))]"
            title={b.label}
          >
            {b.label}
          </div>
        ))}
      </div>
    </div>
  );
}
