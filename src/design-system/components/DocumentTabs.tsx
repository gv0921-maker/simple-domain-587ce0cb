/**
 * DocumentTabs — the notebook tab strip on an Odoo form.
 *
 * Underline-style active tab in maroon. Uncontrolled by default; pass
 * `value` + `onValueChange` to control it.
 */
import * as React from 'react';
import { cn } from '../lib/cn';

export interface DocumentTab {
  key: string;
  label: string;
  /** Optional small count badge, e.g. line count. */
  badge?: number | string;
  content: React.ReactNode;
}

export function DocumentTabs({
  tabs,
  value,
  defaultValue,
  onValueChange,
  className,
}: {
  tabs: DocumentTab[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (key: string) => void;
  className?: string;
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? tabs[0]?.key);
  const active = value ?? internal;

  const select = (k: string) => {
    if (value === undefined) setInternal(k);
    onValueChange?.(k);
  };

  const activeTab = tabs.find((t) => t.key === active);

  return (
    <div className={cn('bg-[hsl(var(--ds-surface))]', className)}>
      <div
        role="tablist"
        aria-label="Document sections"
        className="ds-scroll-x flex gap-0 border-b border-[hsl(var(--ds-border))] px-3"
      >
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => select(t.key)}
              className={cn(
                'relative -mb-px flex items-center gap-1.5 whitespace-nowrap px-3 py-2',
                'text-[var(--ds-fs-sm)] font-medium transition-colors',
                isActive
                  ? 'text-[hsl(var(--ds-primary))]'
                  : 'text-[hsl(var(--ds-ink-muted))] hover:text-[hsl(var(--ds-ink))]',
              )}
            >
              {t.label}
              {t.badge !== undefined && (
                <span
                  className={cn(
                    'rounded-[var(--ds-radius-pill)] px-1.5 text-[10px] font-semibold leading-[15px]',
                    isActive
                      ? 'bg-[hsl(var(--ds-primary)/0.12)] text-[hsl(var(--ds-primary))]'
                      : 'bg-[hsl(var(--ds-surface-sunken))] text-[hsl(var(--ds-ink-subtle))]',
                  )}
                >
                  {t.badge}
                </span>
              )}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-[2px] bg-[hsl(var(--ds-primary))]"
                />
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="p-3">
        {activeTab?.content}
      </div>
    </div>
  );
}
