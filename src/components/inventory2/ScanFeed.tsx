/**
 * Inventory 2 — the scan feed: what happened to each scan, newest first.
 *
 * Every scan carries its own state because the bay has no other record. A unit
 * that failed must stay on screen with the database's own words attached and a
 * retry the operator can press; it must never quietly disappear, and it must
 * never be summarised (CLAUDE.md Rule 5).
 *
 * `duplicate` is its own tone on purpose. inv_receive_serial returns success
 * for a re-scan of a serial already on the move, so a second scan of the same
 * unit is neither an error nor a new unit — telling the operator "received"
 * twice would be a lie, and showing red would send them hunting for a fault
 * that isn't there.
 */
import * as React from 'react';
import { AlertTriangle, Check, Copy, Info, Loader2, RotateCw, X } from 'lucide-react';
import { cn } from '@/design-system';

export type ScanPhase = 'pending' | 'confirmed' | 'duplicate' | 'failed' | 'info';

export interface ScanEvent {
  id: string;
  code: string;
  phase: ScanPhase;
  message: string;
  at: number;
  /** Present when the scan can be retried — a failed commit against a line. */
  retry?: { moveId: string; serial: string; cost: number };
}

const TONE: Record<ScanPhase, { row: string; chip: string; label: string }> = {
  pending: {
    row: 'border-[hsl(var(--ds-border-strong))] bg-[hsl(var(--ds-surface))]',
    chip: 'bg-[hsl(var(--ds-surface-sunken))] text-[hsl(var(--ds-ink-muted))]',
    label: 'Sending',
  },
  confirmed: {
    row: 'border-[hsl(var(--ds-green)/0.45)] bg-[hsl(var(--ds-green-bg))]',
    chip: 'bg-[hsl(var(--ds-green))] text-white',
    label: 'Received',
  },
  duplicate: {
    row: 'border-[hsl(var(--ds-amber)/0.45)] bg-[hsl(var(--ds-amber-bg))]',
    chip: 'bg-[hsl(var(--ds-amber))] text-white',
    label: 'Already scanned',
  },
  failed: {
    row: 'border-[hsl(var(--ds-red))] bg-[hsl(var(--ds-red-bg))]',
    chip: 'bg-[hsl(var(--ds-red))] text-white',
    label: 'Failed',
  },
  info: {
    row: 'border-[hsl(var(--ds-border-strong))] bg-[hsl(var(--ds-surface-sunken))]',
    chip: 'bg-[hsl(var(--ds-ink-muted))] text-white',
    label: 'Note',
  },
};

function PhaseIcon({ phase }: { phase: ScanPhase }) {
  const cls = 'h-4 w-4 shrink-0';
  if (phase === 'pending') return <Loader2 className={cn(cls, 'animate-spin')} aria-hidden />;
  if (phase === 'confirmed') return <Check className={cls} aria-hidden />;
  if (phase === 'duplicate') return <Copy className={cls} aria-hidden />;
  if (phase === 'failed') return <AlertTriangle className={cls} aria-hidden />;
  return <Info className={cls} aria-hidden />;
}

export interface ScanFeedProps {
  events: ScanEvent[];
  /**
   * `serial` is what the operator has in the box — the original value when they
   * have not touched it, the corrected one when they have. A foreign or
   * mistyped serial is usually a near miss, so the value stays editable rather
   * than making them re-scan a label that may not be there any more.
   */
  onRetry: (event: ScanEvent, serial: string) => void;
  onDismiss: (id: string) => void;
  /**
   * The chip on a confirmed row. Defaults to "Received", which is only true on
   * a receipt — a transfer passes "Moved". The caller supplies it from the scan
   * adapter's `unitCommittedVerb` rather than this component testing the kind.
   */
  confirmedLabel?: string;
}

/** Failed row: the database's sentence, plus the value kept for correction. */
function FailedActions({
  event, onRetry,
}: {
  event: ScanEvent;
  onRetry: (event: ScanEvent, serial: string) => void;
}) {
  const [serial, setSerial] = React.useState(event.retry?.serial ?? event.code);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        value={serial}
        onChange={(e) => setSerial(e.target.value)}
        aria-label={`Correct the serial for ${event.code}`}
        className={cn(
          'h-9 min-w-[180px] flex-1 rounded-[var(--ds-radius)] border px-2',
          'border-[hsl(var(--ds-red))] bg-[hsl(var(--ds-surface))]',
          'font-mono text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]',
          'outline-none focus:ring-1 focus:ring-[hsl(var(--ds-red))]',
        )}
      />
      <button
        type="button"
        onClick={() => onRetry(event, serial.trim())}
        disabled={!serial.trim()}
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--ds-radius)] px-3',
          'bg-[hsl(var(--ds-red))] text-[var(--ds-fs-sm)] font-semibold text-white',
          'hover:opacity-90 disabled:opacity-40',
        )}
      >
        <RotateCw className="h-4 w-4" />
        Retry
      </button>
    </div>
  );
}

export function ScanFeed({
  events, onRetry, onDismiss, confirmedLabel = 'Received',
}: ScanFeedProps) {
  const failedCount = events.filter((e) => e.phase === 'failed').length;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
          This session
        </h2>
        {failedCount > 0 && (
          <span className="rounded-[var(--ds-radius-pill)] bg-[hsl(var(--ds-red))] px-2 py-[2px] text-[var(--ds-fs-xs)] font-bold text-white">
            {failedCount} failed
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {events.length === 0 ? (
          <p className="py-6 text-center text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-subtle))]">
            No scans yet. Scan a product barcode to pick a line, then scan each unit's serial.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {events.map((e) => {
              const tone = TONE[e.phase];
              return (
                <li
                  key={e.id}
                  className={cn('rounded-[var(--ds-radius)] border px-2.5 py-2', tone.row)}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 rounded-[var(--ds-radius-pill)] px-2 py-[2px]',
                        'text-[var(--ds-fs-xs)] font-bold uppercase tracking-wide',
                        tone.chip,
                      )}
                    >
                      <PhaseIcon phase={e.phase} />
                      {e.phase === 'confirmed' ? confirmedLabel : tone.label}
                    </span>
                    <code className="min-w-0 flex-1 truncate font-mono text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
                      {e.code}
                    </code>
                    {e.phase === 'failed' && (
                      <button
                        type="button"
                        onClick={() => onDismiss(e.id)}
                        aria-label={`Dismiss failed scan ${e.code}`}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--ds-radius)] text-[hsl(var(--ds-ink-muted))] hover:bg-black/5"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* The database's own sentence, unedited. */}
                  <p className="mt-1 whitespace-pre-wrap text-[var(--ds-fs-sm)] leading-snug text-[hsl(var(--ds-ink))]">
                    {e.message}
                  </p>

                  {e.phase === 'failed' && e.retry && (
                    <FailedActions event={e} onRetry={onRetry} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
