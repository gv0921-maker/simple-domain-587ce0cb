/**
 * DocumentHeader — the signature Odoo form header.
 *
 * Rows, top to bottom:
 *   1. breadcrumb (left)              +  record pager (right)
 *   2. action buttons (left) + segmented toggle (centre) + cog
 *   3. document title                 +  status ribbon (right-aligned)
 *
 * Collapses to a stacked layout below `md`.
 */
import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button, StatusRibbon, type RibbonStage } from './primitives';
import { CogMenu } from './CogMenu';

export interface HeaderAction {
  key: string;
  label: string;
  variant?: 'primary' | 'outline' | 'subtle' | 'danger';
  onClick?: () => void;
}

export interface SegmentOption {
  key: string;
  label: string;
}

export interface DocumentHeaderProps {
  breadcrumb: string[];
  /** Last breadcrumb entry is rendered as the current record reference. */
  title: string;
  actions?: HeaderAction[];
  segments?: SegmentOption[];
  activeSegment?: string;
  onSegmentChange?: (key: string) => void;
  stages: RibbonStage[];
  currentStage: string;
  pager?: { index: number; total: number; onPrev?: () => void; onNext?: () => void };
  className?: string;
}

export function DocumentHeader({
  breadcrumb,
  title,
  actions = [],
  segments,
  activeSegment,
  onSegmentChange,
  stages,
  currentStage,
  pager,
  className,
}: DocumentHeaderProps) {
  return (
    <div
      className={cn(
        'bg-[hsl(var(--ds-surface))] border border-[hsl(var(--ds-border))]',
        'rounded-t-[var(--ds-radius)] px-3 pt-2 pb-3',
        className,
      )}
    >
      {/* row 1 — breadcrumb + pager */}
      <div className="flex items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex items-center gap-1 text-[var(--ds-fs-xs)]">
            {breadcrumb.map((crumb, i) => {
              const last = i === breadcrumb.length - 1;
              return (
                <li key={crumb} className="flex items-center gap-1 min-w-0">
                  {i > 0 && (
                    <span className="text-[hsl(var(--ds-ink-subtle))]" aria-hidden="true">
                      /
                    </span>
                  )}
                  <span
                    className={cn(
                      'truncate',
                      last
                        ? 'font-semibold text-[hsl(var(--ds-ink))]'
                        : 'text-[hsl(var(--ds-link))] hover:underline cursor-pointer',
                    )}
                    aria-current={last ? 'page' : undefined}
                  >
                    {crumb}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>

        {pager && (
          <div className="flex shrink-0 items-center gap-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))]">
            <span className="tabular-nums">
              {pager.index} / {pager.total}
            </span>
            <div className="flex">
              <button
                type="button"
                onClick={pager.onPrev}
                aria-label="Previous record"
                className="grid h-[20px] w-[18px] place-items-center rounded-l-[2px] border border-[hsl(var(--ds-border))] hover:bg-[hsl(var(--ds-surface-sunken))]"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={pager.onNext}
                aria-label="Next record"
                className="grid h-[20px] w-[18px] place-items-center rounded-r-[2px] border border-l-0 border-[hsl(var(--ds-border))] hover:bg-[hsl(var(--ds-surface-sunken))]"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* row 2 — actions / segmented toggle / cog */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {actions.map((a) => (
            <Button
              key={a.key}
              size="sm"
              variant={a.variant ?? 'outline'}
              onClick={a.onClick}
            >
              {a.label}
            </Button>
          ))}
        </div>

        {segments && segments.length > 0 && (
          <div
            role="tablist"
            aria-label="View mode"
            className="mx-auto flex overflow-hidden rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))]"
          >
            {segments.map((s, i) => {
              const active = s.key === activeSegment;
              return (
                <button
                  key={s.key}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => onSegmentChange?.(s.key)}
                  className={cn(
                    'h-[26px] px-3 text-[var(--ds-fs-xs)] font-medium transition-colors',
                    i > 0 && 'border-l border-[hsl(var(--ds-border-strong))]',
                    active
                      ? 'bg-[hsl(var(--ds-primary))] text-[hsl(var(--ds-primary-fg))]'
                      : 'bg-[hsl(var(--ds-surface))] text-[hsl(var(--ds-ink-muted))] hover:bg-[hsl(var(--ds-surface-alt))]',
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="ml-auto">
          <CogMenu />
        </div>
      </div>

      {/* row 3 — title + status ribbon */}
      <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h1 className="text-[20px] font-semibold leading-tight text-[hsl(var(--ds-ink))]">
          {title}
        </h1>
        <div className="ds-scroll-x -mx-1 px-1 md:ml-auto md:overflow-visible">
          <StatusRibbon stages={stages} current={currentStage} className="justify-start md:justify-end" />
        </div>
      </div>
    </div>
  );
}
