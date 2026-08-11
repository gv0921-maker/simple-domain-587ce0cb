/**
 * Inventory 2 — form controls.
 *
 * The design system ships display primitives (Button, StatusPill, DocumentFields)
 * but no inputs, so these are built directly on the `--ds-*` tokens to sit in
 * the same visual language as the read-only page. Scoped to Inventory 2; they
 * are not exported into the design system and nothing outside /inventory2 uses
 * them.
 *
 * `LockedValue` is the one that carries a rule rather than a style: when an
 * operation type sets locks_destination, the destination is shown read-only
 * with a lock affordance and never hidden. Hiding it was the old module's
 * mistake — staff could not see where goods were going.
 */
import * as React from 'react';
import { Lock } from 'lucide-react';
import { cn } from '@/design-system';

const CONTROL = cn(
  'w-full rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))]',
  'bg-[hsl(var(--ds-surface))] px-2 py-1.5 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]',
  'outline-none transition-colors',
  'focus:border-[hsl(var(--ds-primary))] focus:ring-1 focus:ring-[hsl(var(--ds-primary))]',
  'disabled:cursor-not-allowed disabled:bg-[hsl(var(--ds-surface-sunken))] disabled:text-[hsl(var(--ds-ink-muted))]',
);

export function Field({
  label, hint, required, htmlFor, children,
}: {
  label: string;
  hint?: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(120px,150px)_minmax(0,1fr)] items-start gap-3 py-1.5">
      <label
        htmlFor={htmlFor}
        className="pt-1.5 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]"
      >
        {label}
        {required && <span className="ml-0.5 text-[hsl(var(--ds-red))]">*</span>}
      </label>
      <div className="min-w-0">
        {children}
        {hint && (
          <p className="mt-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">{hint}</p>
        )}
      </div>
    </div>
  );
}

export const TextInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...rest }, ref) => (
  <input ref={ref} className={cn(CONTROL, className)} {...rest} />
));
TextInput.displayName = 'TextInput';

export const TextArea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...rest }, ref) => (
  <textarea ref={ref} rows={3} className={cn(CONTROL, 'resize-y', className)} {...rest} />
));
TextArea.displayName = 'TextArea';

export const SelectInput = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...rest }, ref) => (
  <select ref={ref} className={cn(CONTROL, className)} {...rest}>
    {children}
  </select>
));
SelectInput.displayName = 'SelectInput';

/**
 * A value the user may see but not change, with the reason attached.
 * Used for a destination locked by its operation type.
 */
export function LockedValue({ value, reason }: { value: React.ReactNode; reason: string }) {
  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 rounded-[var(--ds-radius)]',
          'border border-dashed border-[hsl(var(--ds-border-strong))]',
          'bg-[hsl(var(--ds-surface-sunken))] px-2 py-1.5',
          'text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]',
        )}
      >
        <Lock className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--ds-ink-subtle))]" aria-hidden />
        <span className="min-w-0 truncate">{value}</span>
        <span className="ml-auto shrink-0 text-[var(--ds-fs-xs)] uppercase tracking-wide text-[hsl(var(--ds-ink-subtle))]">
          Locked
        </span>
      </div>
      <p className="mt-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">{reason}</p>
    </div>
  );
}

/**
 * Verbatim error surface (Rule 5). Renders the database's own words — these
 * RPCs raise sentences written to be read by staff, and paraphrasing them
 * throws away the instruction they carry.
 */
export function ErrorBanner({
  title, message, onDismiss,
}: {
  title: string;
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-[var(--ds-radius)] border border-[hsl(var(--ds-red))]',
        'bg-[hsl(var(--ds-red-bg))] px-3 py-2',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-red))]">{title}</p>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))] hover:underline"
          >
            Dismiss
          </button>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">
        {message}
      </p>
    </div>
  );
}
