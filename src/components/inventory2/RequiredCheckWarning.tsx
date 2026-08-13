/**
 * Inventory 2 — the confirmation shown before a REQUIRED check goes live.
 *
 * Shared by every path that can put a required check into the applicable set:
 * creating one, promoting an advisory one, un-archiving one from the edit form,
 * and the Restore button on the config list. Same wording everywhere, because
 * the consequence is the same everywhere.
 *
 * WHAT IT IS WARNING ABOUT. inv_record_qc_results re-derives a unit's status
 * against the ENTIRE applicable checklist, not just the results being
 * submitted. A new required check raises `v_required` for every applicable unit
 * without raising `v_req_passed`, so an already-inspected unit becomes
 * incomplete and drops to 'quarantined'.
 *
 * THE DELAY IS THE POINT. Nothing changes when the check is saved. The status
 * is only rewritten the NEXT TIME QC is recorded for that unit, which may be
 * days later and triggered by someone who had nothing to do with this change.
 * That gap is what makes it surprising, so the copy leads with it.
 *
 * This warns and asks; it never blocks, and no RPC is changed. The
 * re-derivation is correct behaviour — a new mandatory check genuinely does
 * mean earlier inspections were incomplete.
 */
import { Button, StatusPill, cn } from '@/design-system';
import { AlertTriangle } from 'lucide-react';
import type { RequiredCheckImpact } from '@/lib/services/inventory2/checklists';

export interface RequiredCheckWarningProps {
  /** NULL scope means global — every unit in the system. */
  isGlobal: boolean;
  productName?: string | null;
  impact: RequiredCheckImpact | undefined;
  loading: boolean;
  /** What the user is about to do, e.g. "Add check" or "Restore". */
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RequiredCheckWarning({
  isGlobal, productName, impact, loading, confirmLabel, busy, onConfirm, onCancel,
}: RequiredCheckWarningProps) {
  const scope = isGlobal
    ? 'every product in the system'
    : (productName ?? 'this product');

  return (
    <div
      className={cn(
        'rounded-[var(--ds-radius)] border border-[hsl(var(--ds-amber)/0.5)]',
        'bg-[hsl(var(--ds-amber-bg))] p-3',
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--ds-amber))]" />
        <div className="min-w-0">
          <p className="text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-amber))]">
            This required check applies to units that have already been inspected
          </p>

          <p className="mt-1 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">
            It applies to {scope}. Every unit already inspected now has one
            unanswered required check, which makes its inspection incomplete.
          </p>

          {/* The delay is the part people miss, so it gets its own line. */}
          <p className="mt-1.5 text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
            Nothing changes right now. Those units keep their current status until
            the next time QC is recorded against them — and at that moment they
            will drop from OK to Quarantined.
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {loading ? (
              <span className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
                Counting affected units…
              </span>
            ) : (
              <>
                <StatusPill tone="grey">
                  {impact?.applicable ?? 0} unit{impact?.applicable === 1 ? '' : 's'} affected
                </StatusPill>
                <StatusPill tone="green">
                  {impact?.currentlyOk ?? 0} currently OK
                </StatusPill>
                <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                  — the OK ones are the ones that will visibly drop.
                </span>
              </>
            )}
          </div>

          <p className="mt-2 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
            This is intended behaviour, not a fault: a new mandatory check does mean earlier
            inspections were incomplete. Re-run QC on the affected units to clear them.
          </p>

          <div className="mt-3 flex items-center gap-2">
            <Button variant="primary" onClick={onConfirm} disabled={busy || loading}>
              {busy ? 'Saving…' : confirmLabel}
            </Button>
            <Button variant="subtle" onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
