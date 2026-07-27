/**
 * BarcodeStatusScreen — TERMINAL state for a scan session.
 *
 * Not the working screen: this is what the operator sees when there is
 * nothing left to do (already validated, blocked, or finished). The working
 * screen is BarcodeScanList.
 *
 * Dark navy, high contrast, oversized touch targets: used at arm's length on
 * a warehouse device, so it breaks from the light enterprise language on
 * purpose rather than by accident.
 *
 * Rendered here inside a fixed-height frame for preview. In real use it would
 * be the full viewport.
 */
import * as React from 'react';
import { ScanLine, Settings, ChevronLeft, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '../lib/cn';

export type ScanTone = 'warning' | 'success' | 'info';

type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;

const toneMap: Record<ScanTone, { icon: IconComponent; color: string }> = {
  warning: { icon: AlertTriangle, color: 'hsl(var(--ds-amber))' },
  success: { icon: CheckCircle2, color: 'hsl(145 60% 55%)' },
  info: { icon: Info, color: 'hsl(var(--ds-blue))' },
};

export function BarcodeStatusScreen({
  reference,
  person,
  message,
  hint,
  tone = 'warning',
  /** Preview convenience: constrains height instead of filling the viewport. */
  framed = true,
  className,
}: {
  reference: string;
  person: string;
  message: string;
  hint?: string;
  tone?: ScanTone;
  framed?: boolean;
  className?: string;
}) {
  const { icon: Icon, color } = toneMap[tone];

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden text-[hsl(var(--ds-navy-fg))]',
        framed ? 'h-[420px] rounded-[var(--ds-radius)]' : 'min-h-screen',
        className,
      )}
      style={{ background: 'hsl(var(--ds-navy))' }}
    >
      {/* top bar */}
      <div
        className="flex items-center gap-2 px-3 py-2.5"
        style={{ background: 'hsl(var(--ds-navy-soft))' }}
      >
        <button
          type="button"
          aria-label="Back"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--ds-radius)] hover:bg-white/10"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-tight">{reference}</div>
          <div className="truncate text-[var(--ds-fs-xs)] text-white/60">{person}</div>
        </div>

        <button
          type="button"
          aria-label="Scan"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--ds-radius)] hover:bg-white/10"
        >
          <ScanLine className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Settings"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--ds-radius)] hover:bg-white/10"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>

      {/* centred status */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <Icon className="h-14 w-14" style={{ color }} strokeWidth={1.6} />
        <p className="text-[18px] font-semibold leading-snug">{message}</p>
        {hint && <p className="max-w-[42ch] text-[var(--ds-fs-sm)] text-white/55">{hint}</p>}
      </div>

      {/* scan affordance */}
      <div className="px-4 pb-5">
        <div
          className={cn(
            'flex items-center justify-center gap-2 rounded-[var(--ds-radius)]',
            'border border-dashed border-white/25 py-3 text-[var(--ds-fs-sm)] text-white/50',
          )}
        >
          <ScanLine className="h-4 w-4" />
          Scan a barcode to continue
        </div>
      </div>
    </div>
  );
}
