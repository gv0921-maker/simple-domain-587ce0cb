/**
 * Shared primitives for the design system.
 *
 * Every colour here reads from the `--ds-*` tokens defined once in
 * tokens.css. No component hard-codes a hex value.
 */
import * as React from 'react';
import { cn } from '../lib/cn';

/* ------------------------------------------------------------------ Button */

type ButtonVariant = 'primary' | 'outline' | 'subtle' | 'link' | 'danger';
type ButtonSize = 'sm' | 'md';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Optional leading icon element (e.g. a lucide icon). */
  icon?: React.ReactNode;
}

const buttonBase =
  'inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap ' +
  'transition-colors duration-100 disabled:opacity-50 disabled:pointer-events-none ' +
  'rounded-[var(--ds-radius)] border';

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-[26px] px-2 text-[var(--ds-fs-xs)]',
  md: 'h-[30px] px-3 text-[var(--ds-fs-sm)]',
};

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-[hsl(var(--ds-primary))] text-[hsl(var(--ds-primary-fg))] border-[hsl(var(--ds-primary))] ' +
    'hover:bg-[hsl(var(--ds-primary-hover))] hover:border-[hsl(var(--ds-primary-hover))] ' +
    'active:bg-[hsl(var(--ds-primary-active))]',
  outline:
    'bg-[hsl(var(--ds-surface))] text-[hsl(var(--ds-ink))] border-[hsl(var(--ds-border-strong))] ' +
    'hover:bg-[hsl(var(--ds-surface-alt))] hover:border-[hsl(var(--ds-primary))] ' +
    'hover:text-[hsl(var(--ds-primary))]',
  subtle:
    'bg-transparent text-[hsl(var(--ds-ink-muted))] border-transparent ' +
    'hover:bg-[hsl(var(--ds-surface-sunken))] hover:text-[hsl(var(--ds-ink))]',
  link:
    'bg-transparent border-transparent px-0 text-[hsl(var(--ds-link))] ' +
    'hover:text-[hsl(var(--ds-link-hover))] hover:underline underline-offset-2',
  danger:
    'bg-transparent text-[hsl(var(--ds-red))] border-[hsl(var(--ds-red)/0.4)] ' +
    'hover:bg-[hsl(var(--ds-red-bg))]',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'outline', size = 'md', icon, className, children, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(buttonBase, buttonSizes[size], buttonVariants[variant], className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

/* -------------------------------------------------------------------- Card */

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Colour token name for the signature Odoo left border, e.g. 'primary'. */
  accent?: 'primary' | 'blue' | 'green' | 'amber' | 'none';
}

const accentMap: Record<NonNullable<CardProps['accent']>, string> = {
  primary: 'hsl(var(--ds-primary))',
  blue: 'hsl(var(--ds-blue))',
  green: 'hsl(var(--ds-green))',
  amber: 'hsl(var(--ds-amber))',
  none: 'transparent',
};

export function Card({ accent = 'none', className, style, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'bg-[hsl(var(--ds-surface))] border border-[hsl(var(--ds-border))]',
        'rounded-[var(--ds-radius)] shadow-[var(--ds-shadow-card)]',
        className,
      )}
      style={{
        ...(accent !== 'none'
          ? { borderLeft: `3px solid ${accentMap[accent]}` }
          : null),
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- StatusPill */

export type StatusTone = 'grey' | 'amber' | 'green' | 'blue' | 'red';

const pillTones: Record<StatusTone, string> = {
  grey: 'bg-[hsl(var(--ds-grey-bg))] text-[hsl(var(--ds-grey))]',
  amber: 'bg-[hsl(var(--ds-amber-bg))] text-[hsl(var(--ds-amber))]',
  green: 'bg-[hsl(var(--ds-green-bg))] text-[hsl(var(--ds-green))]',
  blue: 'bg-[hsl(var(--ds-blue-bg))] text-[hsl(var(--ds-blue))]',
  red: 'bg-[hsl(var(--ds-red-bg))] text-[hsl(var(--ds-red))]',
};

export function StatusPill({
  tone = 'grey',
  children,
  className,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--ds-radius-pill)] px-2 py-[1px]',
        'text-[var(--ds-fs-xs)] font-semibold leading-[16px] whitespace-nowrap',
        pillTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- FilterChip */

export function FilterChip({
  label,
  value,
  onRemove,
}: {
  label?: string;
  value: string;
  onRemove?: () => void;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--ds-radius)] pl-2 pr-1 py-[2px]',
        'text-[var(--ds-fs-xs)] leading-[18px]',
        'bg-[hsl(var(--ds-primary)/0.08)] text-[hsl(var(--ds-primary))]',
        'border border-[hsl(var(--ds-primary)/0.25)]',
      )}
    >
      {label && <span className="font-semibold">{label}:</span>}
      <span>{value}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove filter ${label ? `${label}: ` : ''}${value}`}
          className={cn(
            'ml-0.5 grid h-[14px] w-[14px] place-items-center rounded-full',
            'hover:bg-[hsl(var(--ds-primary)/0.18)]',
          )}
        >
          <svg viewBox="0 0 10 10" className="h-[7px] w-[7px]" aria-hidden="true">
            <path
              d="M1 1 L9 9 M9 1 L1 9"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ Avatar */

const avatarPalette = [
  'hsl(var(--ds-primary))',
  'hsl(var(--ds-blue))',
  'hsl(var(--ds-green))',
  'hsl(var(--ds-amber))',
  'hsl(215 20% 45%)',
];

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({
  name,
  size = 20,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  // Stable colour per name so the same person is the same colour everywhere.
  const idx = React.useMemo(() => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % avatarPalette.length;
  }, [name]);

  return (
    <span
      title={name}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold text-white select-none',
        className,
      )}
      style={{
        width: size,
        height: size,
        background: avatarPalette[idx],
        fontSize: Math.max(8, Math.round(size * 0.42)),
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

/* ------------------------------------------------------------ StatusRibbon */

export interface RibbonStage {
  key: string;
  label: string;
}

/**
 * The Odoo statusbar: connected chevrons, right-aligned, current stage in
 * maroon. Chevron geometry is clip-path so it stays crisp at any zoom.
 */
export function StatusRibbon({
  stages,
  current,
  onStageClick,
  className,
}: {
  stages: RibbonStage[];
  current: string;
  onStageClick?: (key: string) => void;
  className?: string;
}) {
  const currentIdx = stages.findIndex((s) => s.key === current);

  return (
    <div
      className={cn('flex items-stretch', className)}
      role="group"
      aria-label="Document status"
    >
      {stages.map((stage, i) => {
        const isCurrent = i === currentIdx;
        const isPast = i < currentIdx;
        const isFirst = i === 0;

        return (
          <button
            key={stage.key}
            type="button"
            onClick={onStageClick ? () => onStageClick(stage.key) : undefined}
            aria-current={isCurrent ? 'step' : undefined}
            className={cn(
              'relative h-[26px] pr-3 text-[var(--ds-fs-xs)] font-semibold uppercase tracking-wide',
              'transition-colors duration-100',
              isFirst ? 'pl-3' : 'pl-5 -ml-[10px]',
              isCurrent
                ? 'bg-[hsl(var(--ds-primary))] text-[hsl(var(--ds-primary-fg))] z-[3]'
                : isPast
                  ? 'bg-[hsl(var(--ds-surface-sunken))] text-[hsl(var(--ds-ink-muted))] z-[2]'
                  : 'bg-[hsl(var(--ds-surface-alt))] text-[hsl(var(--ds-ink-subtle))] z-[1]',
              onStageClick && !isCurrent && 'hover:brightness-95 cursor-pointer',
              !onStageClick && 'cursor-default',
            )}
            style={{
              clipPath: isFirst
                ? 'polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%)'
                : 'polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%, 9px 50%)',
            }}
          >
            {stage.label}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- SectionLabel */

/** Small caps label used to title preview sections and card groups. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[var(--ds-fs-xs)] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--ds-ink-subtle))]">
      {children}
    </div>
  );
}
