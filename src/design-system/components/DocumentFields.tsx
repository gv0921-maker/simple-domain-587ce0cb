/**
 * DocumentFields — the two-column key/value block on an Odoo form.
 *
 * Bold label on the left, value on the right, with the whole thing splitting
 * into two side-by-side groups on wide screens and one column on mobile.
 * Values can be plain text, a link, or any node (pill, avatar, etc).
 */
import * as React from 'react';
import { cn } from '../lib/cn';

export interface DocumentField {
  key: string;
  label: string;
  value: React.ReactNode;
  /** Renders the value in the teal link colour. */
  link?: boolean;
  /** Dims the value — for empty/placeholder fields. */
  muted?: boolean;
}

export function DocumentFields({
  columns,
  className,
}: {
  /** One array per visual column. Pass a single array for a one-column form. */
  columns: DocumentField[][];
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-x-10 gap-y-0 px-3 py-3',
        columns.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1',
        className,
      )}
    >
      {columns.map((col, ci) => (
        <dl key={ci} className="m-0">
          {col.map((f) => (
            <div
              key={f.key}
              className="flex items-baseline gap-3 py-[5px] border-b border-dashed border-[hsl(var(--ds-border)/0.7)] last:border-b-0"
            >
              <dt className="w-[38%] shrink-0 text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink-muted))]">
                {f.label}
              </dt>
              <dd
                className={cn(
                  'm-0 min-w-0 flex-1 text-[var(--ds-fs-sm)]',
                  f.link && 'text-[hsl(var(--ds-link))] hover:underline cursor-pointer',
                  f.muted && 'text-[hsl(var(--ds-ink-subtle))] italic',
                  !f.link && !f.muted && 'text-[hsl(var(--ds-ink))]',
                )}
              >
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      ))}
    </div>
  );
}
