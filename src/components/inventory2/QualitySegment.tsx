/**
 * Inventory 2 — the Quality segment.
 *
 * QC as part of the operation document, not a separate thing: every unit on
 * THIS document with its condition, which named tests passed or failed, and a
 * way to run or re-run the checklist without going through a modal inside a
 * modal.
 *
 * GENERIC OVER THE DOCUMENT. It takes an operationId and nothing else. There is
 * no receipt in this file — the data comes from getDocumentQuality, which walks
 * inv_operation / inv_move_line / inv_stock_item / inv_test_result. A future
 * transfer, delivery or adjustment page renders <QualitySegment operationId>
 * and is done.
 *
 * It runs the SAME QcRunner the queue and the serial sub-list use. This adds a
 * route in; it replaces none of them.
 *
 * THE MISSING-CHECKLIST WARNING IS THE POINT
 * When the type requires QC but a unit's product has no applicable active
 * template, that is said loudly rather than rendered as an empty table or a
 * quiet pass. An unit with no checklist is not an inspected unit — it is a
 * configuration gap, and the Pass 6 lesson is that these hide unless something
 * shouts about them.
 */
import * as React from 'react';
import { AlertTriangle, Check, CircleDashed, X } from 'lucide-react';
import { Button, StatusPill, cn } from '@/design-system';
import { QcRunner } from '@/components/inventory2/QcRunner';
import { ErrorBanner } from '@/components/inventory2/formControls';
import { errorText } from '@/lib/inventory2/errorText';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/inventory2/status';
import { useDocumentQuality } from '@/hooks/inventory2/quality';
import { documentRequiresQc, type QualityUnit } from '@/lib/services/inventory2/quality';
import type { InvStockStatus } from '@/lib/services/inventory2/qc';

/** One roll-up figure. */
function Stat({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone?: 'plain' | 'amber' | 'red' | 'green';
}) {
  const colour =
    tone === 'red' ? 'text-[hsl(var(--ds-red))]'
    : tone === 'amber' ? 'text-[hsl(var(--ds-amber))]'
    : tone === 'green' ? 'text-[hsl(var(--ds-green))]'
    : 'text-[hsl(var(--ds-ink))]';
  return (
    <div className="min-w-[92px]">
      <div className={cn('text-[24px] font-bold leading-none tabular-nums', colour)}>{value}</div>
      <div className="mt-1 text-[var(--ds-fs-xs)] uppercase tracking-wide text-[hsl(var(--ds-ink-subtle))]">
        {label}
      </div>
    </div>
  );
}

/** The named tests for one unit: what passed, what failed, what is outstanding. */
function TestChips({ unit }: { unit: QualityUnit }) {
  if (unit.missingChecklist) return null;

  const latest = new Map(unit.results.filter((r) => r.is_latest).map((r) => [r.template_id, r]));

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {unit.templates.map((t) => {
        const r = latest.get(t.id);
        const state = r === undefined ? 'untested' : r.result ? 'pass' : 'fail';
        return (
          <span
            key={t.id}
            title={
              t.is_required
                ? `${t.name} — required`
                : `${t.name} — advisory, does not block the unit`
            }
            className={cn(
              'inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-[1px]',
              'text-[10px] font-semibold uppercase tracking-wide',
              state === 'pass'
                ? 'border-[hsl(var(--ds-green)/0.35)] bg-[hsl(var(--ds-green-bg))] text-[hsl(var(--ds-green))]'
                : state === 'fail'
                  ? t.is_required
                    ? 'border-[hsl(var(--ds-red)/0.35)] bg-[hsl(var(--ds-red-bg))] text-[hsl(var(--ds-red))]'
                    : 'border-[hsl(var(--ds-amber)/0.35)] bg-[hsl(var(--ds-amber-bg))] text-[hsl(var(--ds-amber))]'
                  : 'border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-surface-sunken))] text-[hsl(var(--ds-ink-subtle))]',
            )}
          >
            {state === 'pass' ? <Check className="h-3 w-3" />
              : state === 'fail' ? <X className="h-3 w-3" />
              : <CircleDashed className="h-3 w-3" />}
            {t.name}
            {!t.is_required && <span className="opacity-60">·adv</span>}
          </span>
        );
      })}
    </div>
  );
}

export interface QualitySegmentProps {
  operationId: string;
}

export function QualitySegment({ operationId }: QualitySegmentProps) {
  const { data: doc, isLoading, error } = useDocumentQuality(operationId);
  const [unit, setUnit] = React.useState<{
    id: string; serial: string; productId: string; status: InvStockStatus;
  } | null>(null);

  if (isLoading) {
    return (
      <div className="border-t border-[hsl(var(--ds-border))] p-6 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
        Loading quality…
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="border-t border-[hsl(var(--ds-border))] p-3">
        <ErrorBanner
          title="Could not load quality for this document"
          message={error ? errorText(error) : `Operation ${operationId} was not found.`}
        />
      </div>
    );
  }

  // Defensive: the page decides whether to render this segment at all, but if
  // it is reached for a type that does not require QC, say so rather than
  // implying the units were checked and passed.
  if (!documentRequiresQc(doc)) {
    return (
      <div className="border-t border-[hsl(var(--ds-border))] p-4">
        <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
          <strong>{doc.type_name}</strong> is not configured to require QC, so no inspection is
          expected for {doc.number}. Turn on <code>requires_qc</code> for this operation type if
          it should be.
        </p>
      </div>
    );
  }

  const c = doc.counts;

  return (
    <div className="border-t border-[hsl(var(--ds-border))]">
      {/* -------------------------------------------------- roll-up */}
      <div className="flex flex-wrap items-start gap-6 border-b border-[hsl(var(--ds-border))] px-3 py-3">
        <Stat label="Units" value={c.units} />
        <Stat label="Inspected" value={c.inspected} tone={c.inspected > 0 ? 'green' : 'plain'} />
        <Stat label="Awaiting" value={c.awaiting} tone={c.awaiting > 0 ? 'amber' : 'plain'} />
        <Stat label="Rejected" value={c.rejected} tone={c.rejected > 0 ? 'red' : 'plain'} />
        <div className="ml-auto max-w-[320px] text-[var(--ds-fs-xs)] leading-relaxed text-[hsl(var(--ds-ink-subtle))]">
          Only units in <strong>OK</strong> count towards available-to-sell. Quarantined units are
          on hand but held back until every required test passes.
        </div>
      </div>

      {/* ------------------------------- configuration gap, said loudly */}
      {c.missingChecklist > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-[hsl(var(--ds-amber))] bg-[hsl(var(--ds-amber-bg))] px-3 py-2.5"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--ds-amber))]" aria-hidden />
          <div className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">
            <strong>QC required but no checklist defined.</strong>{' '}
            {c.missingChecklist === 1 ? '1 unit on' : `${c.missingChecklist} units on`} {doc.number}{' '}
            {c.missingChecklist === 1 ? 'has' : 'have'} no active test template for their product,
            so there is nothing to inspect against. That is a configuration gap, not a pass — add
            templates for the product before treating these units as checked.
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ units */}
      {doc.units.length === 0 ? (
        <p className="p-6 text-center text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-subtle))]">
          No units on this document yet. Receive units first — inspection comes after they arrive.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {doc.units.map((u) => (
            <li
              key={u.stock_item_id}
              className="flex flex-wrap items-start gap-3 border-b border-[hsl(var(--ds-border))] px-3 py-2.5"
            >
              <div className="min-w-[220px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="font-mono text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
                    {u.serial}
                  </code>
                  <StatusPill tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</StatusPill>
                  {u.untouched && !u.missingChecklist && (
                    <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                      not yet inspected
                    </span>
                  )}
                </div>

                <div className="mt-0.5 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                  {u.product_name ?? '—'}
                  {u.product_sku ? ` · ${u.product_sku}` : ''}
                  {u.location_name ? ` · ${u.location_name}` : ''}
                </div>

                {u.missingChecklist ? (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-[2px] border border-[hsl(var(--ds-amber)/0.4)] bg-[hsl(var(--ds-amber-bg))] px-2 py-1 text-[var(--ds-fs-xs)] font-semibold text-[hsl(var(--ds-amber))]">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    QC required, but no checklist is defined for this product
                  </p>
                ) : (
                  <TestChips unit={u} />
                )}
              </div>

              <div className="shrink-0">
                <Button
                  size="sm"
                  variant={u.untouched ? 'primary' : 'outline'}
                  disabled={u.missingChecklist}
                  title={
                    u.missingChecklist
                      ? 'There is no active checklist for this product to inspect against.'
                      : undefined
                  }
                  onClick={() => setUnit({
                    id: u.stock_item_id,
                    serial: u.serial,
                    productId: u.product_id,
                    status: u.status,
                  })}
                >
                  {u.untouched ? 'Run QC' : 'Re-run QC'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/*
        QC is deliberately not gated on the document being editable: inspection
        happens after goods arrive, and a validated document is exactly when a
        unit is most likely to be sitting in quarantine awaiting a decision.
      */}
      {unit && (
        <QcRunner
          stockItemId={unit.id}
          productId={unit.productId}
          serial={unit.serial}
          currentStatus={unit.status}
          operationId={operationId}
          onClose={() => setUnit(null)}
        />
      )}
    </div>
  );
}
