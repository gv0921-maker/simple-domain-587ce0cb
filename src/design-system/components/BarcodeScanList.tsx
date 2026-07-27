/**
 * BarcodeScanList — the operator's working scan screen.
 *
 * Split theme on purpose: dark navy chrome (header + scan prompt + validate
 * bar) frames a LIGHT list body. The dark chrome is what the operator's eye
 * locks onto at arm's length; the list itself needs the contrast of paper
 * because it is read closely, line by line, while scanning.
 *
 * Counter design: the scanned number is large and the "/ total Units" is
 * small, so an operator can read progress at a glance without parsing a
 * fraction. A line that is complete turns green; over-scanned turns red.
 *
 * Presentation only — `onScanLine` / `onValidate` are plain callbacks.
 */
import * as React from 'react';
import { ChevronLeft, ScanLine, Settings, Pencil, Plus, ImageOff } from 'lucide-react';
import { cn } from '../lib/cn';

export interface ScanTag {
  key: string;
  label: string;
  /** `link` renders teal, `muted` renders grey. Default `muted`. */
  tone?: 'link' | 'muted' | 'warn';
}

export interface ScanLineItem {
  id: string;
  /** Bold product code, e.g. "GLF-TBL-1800-TK". */
  code: string;
  description: string;
  tags?: ScanTag[];
  /** Optional "Partners/Vendors" style link under the tags. */
  partnerLabel?: string;
  /** Image URL; falls back to a placeholder tile when absent. */
  thumbnailUrl?: string;
  scanned: number;
  total: number;
  unit?: string;
  /** Quick-add step for the +N button. Defaults to the remaining quantity. */
  quickAdd?: number;
}

const tagTone: Record<NonNullable<ScanTag['tone']>, string> = {
  link: 'bg-[hsl(var(--ds-link)/0.10)] text-[hsl(var(--ds-link))] border-[hsl(var(--ds-link)/0.25)]',
  muted:
    'bg-[hsl(var(--ds-surface-sunken))] text-[hsl(var(--ds-ink-muted))] border-[hsl(var(--ds-border))]',
  warn: 'bg-[hsl(var(--ds-amber-bg))] text-[hsl(var(--ds-amber))] border-[hsl(var(--ds-amber)/0.3)]',
};

function LineCounter({ scanned, total, unit = 'Units' }: { scanned: number; total: number; unit?: string }) {
  const complete = scanned >= total && total > 0;
  const over = scanned > total;

  return (
    <div className="flex shrink-0 items-baseline gap-1 tabular-nums">
      <span
        className={cn(
          'text-[22px] font-bold leading-none',
          over
            ? 'text-[hsl(var(--ds-red))]'
            : complete
              ? 'text-[hsl(var(--ds-green))]'
              : 'text-[hsl(var(--ds-ink))]',
        )}
      >
        {scanned}
      </span>
      <span className="text-[var(--ds-fs-xs)] font-medium text-[hsl(var(--ds-ink-subtle))]">
        / {total} {unit}
      </span>
    </div>
  );
}

export interface BarcodeScanListProps {
  reference: string;
  person?: string;
  lines: ScanLineItem[];
  onBack?: () => void;
  onOpenSettings?: () => void;
  onScanPrompt?: () => void;
  onEditLine?: (id: string) => void;
  onQuickAdd?: (id: string, amount: number) => void;
  onValidate?: () => void;
  /** Preview convenience: constrains height instead of filling the viewport. */
  framed?: boolean;
  className?: string;
}

export function BarcodeScanList({
  reference,
  person,
  lines,
  onBack,
  onOpenSettings,
  onScanPrompt,
  onEditLine,
  onQuickAdd,
  onValidate,
  framed = true,
  className,
}: BarcodeScanListProps) {
  const done = lines.filter((l) => l.scanned >= l.total).length;

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden',
        framed ? 'h-[560px] rounded-[var(--ds-radius)]' : 'min-h-screen',
        className,
      )}
      style={{ background: 'hsl(var(--ds-navy))' }}
    >
      {/* ---- dark header ---- */}
      <div
        className="flex shrink-0 items-center gap-2 px-2.5 py-2.5 text-[hsl(var(--ds-navy-fg))]"
        style={{ background: 'hsl(var(--ds-navy-soft))' }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--ds-radius)] hover:bg-white/10"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold leading-tight">{reference}</div>
          {person && (
            <div className="truncate text-[var(--ds-fs-xs)] leading-tight text-white/55">
              {person}
            </div>
          )}
        </div>

        <span className="shrink-0 rounded-[var(--ds-radius-pill)] bg-white/10 px-2 py-[2px] text-[var(--ds-fs-xs)] font-semibold tabular-nums text-white/80">
          {done}/{lines.length}
        </span>
        <button
          type="button"
          aria-label="Scan"
          onClick={onScanPrompt}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--ds-radius)] hover:bg-white/10"
        >
          <ScanLine className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Settings"
          onClick={onOpenSettings}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--ds-radius)] hover:bg-white/10"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>

      {/* ---- scan prompt strip ---- */}
      <button
        type="button"
        onClick={onScanPrompt}
        className={cn(
          'flex shrink-0 items-center justify-center gap-2 px-3 py-2.5',
          'text-[var(--ds-fs-sm)] font-medium text-white/70',
          'border-y border-white/10 hover:bg-white/5',
        )}
        style={{ background: 'hsl(var(--ds-navy))' }}
      >
        <ScanLine className="h-4 w-4" />
        Scan a product
      </button>

      {/* ---- light list body ---- */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--ds-surface))]">
        <ul className="m-0 list-none p-0">
          {lines.map((l) => {
            const remaining = Math.max(0, l.total - l.scanned);
            const step = l.quickAdd ?? (remaining || 1);
            const complete = l.scanned >= l.total && l.total > 0;

            return (
              <li
                key={l.id}
                className={cn(
                  'flex gap-2.5 border-b border-[hsl(var(--ds-border))] px-3 py-2.5',
                  complete && 'bg-[hsl(var(--ds-green-bg)/0.45)]',
                )}
              >
                {/* left: code, description, tags */}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[var(--ds-fs-base)] font-bold text-[hsl(var(--ds-ink))]">
                    {l.code}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[var(--ds-fs-sm)] leading-snug text-[hsl(var(--ds-ink-muted))]">
                    {l.description}
                  </div>

                  {l.tags && l.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {l.tags.map((t) => (
                        <span
                          key={t.key}
                          className={cn(
                            'inline-flex items-center rounded-[2px] border px-1.5 py-[1px]',
                            'text-[10px] font-semibold uppercase tracking-wide',
                            tagTone[t.tone ?? 'muted'],
                          )}
                        >
                          {t.label}
                        </span>
                      ))}
                    </div>
                  )}

                  {l.partnerLabel && (
                    <button
                      type="button"
                      className="mt-1.5 block text-left text-[var(--ds-fs-xs)] font-medium text-[hsl(var(--ds-link))] hover:underline"
                    >
                      {l.partnerLabel}
                    </button>
                  )}
                </div>

                {/* right: thumbnail, edit, counter, quick-add */}
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <div className="flex items-center gap-1.5">
                    {l.thumbnailUrl ? (
                      <img
                        src={l.thumbnailUrl}
                        alt=""
                        className="h-10 w-10 rounded-[2px] border border-[hsl(var(--ds-border))] object-cover"
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="grid h-10 w-10 place-items-center rounded-[2px] border border-dashed border-[hsl(var(--ds-border))] text-[hsl(var(--ds-ink-subtle))]"
                      >
                        <ImageOff className="h-4 w-4" />
                      </div>
                    )}
                    <button
                      type="button"
                      aria-label={`Edit ${l.code}`}
                      onClick={() => onEditLine?.(l.id)}
                      className={cn(
                        'grid h-8 w-8 place-items-center rounded-[var(--ds-radius)]',
                        'border border-[hsl(var(--ds-border-strong))] text-[hsl(var(--ds-ink-muted))]',
                        'hover:bg-[hsl(var(--ds-surface-sunken))] hover:text-[hsl(var(--ds-ink))]',
                      )}
                    >
                      <Pencil className="h-[15px] w-[15px]" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <LineCounter scanned={l.scanned} total={l.total} unit={l.unit} />
                    <button
                      type="button"
                      disabled={remaining === 0}
                      onClick={() => onQuickAdd?.(l.id, step)}
                      aria-label={`Add ${step} to ${l.code}`}
                      className={cn(
                        'inline-flex h-8 min-w-[42px] items-center justify-center gap-0.5 rounded-[var(--ds-radius)]',
                        'border text-[var(--ds-fs-sm)] font-bold tabular-nums transition-colors',
                        remaining === 0
                          ? 'cursor-not-allowed border-[hsl(var(--ds-border))] text-[hsl(var(--ds-ink-subtle))] opacity-50'
                          : cn(
                              'border-[hsl(var(--ds-primary))] bg-[hsl(var(--ds-primary)/0.08)]',
                              'text-[hsl(var(--ds-primary))] hover:bg-[hsl(var(--ds-primary))] hover:text-[hsl(var(--ds-primary-fg))]',
                            ),
                      )}
                    >
                      <Plus className="h-3 w-3" />
                      {step}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ---- pinned validate ---- */}
      <div className="shrink-0 p-2" style={{ background: 'hsl(var(--ds-navy))' }}>
        <button
          type="button"
          onClick={onValidate}
          className={cn(
            'w-full rounded-[var(--ds-radius)] py-3 text-[15px] font-semibold',
            'bg-[hsl(var(--ds-primary))] text-[hsl(var(--ds-primary-fg))]',
            'hover:bg-[hsl(var(--ds-primary-hover))] active:bg-[hsl(var(--ds-primary-active))]',
          )}
        >
          Validate
        </button>
      </div>
    </div>
  );
}
