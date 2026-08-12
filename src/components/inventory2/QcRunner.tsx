/**
 * Inventory 2 — the QC screen for one unit.
 *
 * Renders the applicable checklist (the product's templates plus any global
 * ones), collects a pass/fail per test with a value or attachment where the
 * template demands it, and submits the lot through inv_record_qc_results.
 *
 * It never writes inv_stock_item.status. The status shown after submission is
 * the one the DATABASE returned, not one computed here — the local
 * explainVerdict() only supplies the "why" sentence beside it.
 *
 * History is append-only: every attempt stays visible, and the newest result
 * per template is marked as the one that counts. A unit that failed and was
 * re-tested shows both, which is the point — the earlier failure is a fact
 * about the goods, not a mistake to be tidied away.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, Paperclip, Upload } from 'lucide-react';
import { Button, StatusPill, cn } from '@/design-system';
import { TextInput, ErrorBanner } from '@/components/inventory2/formControls';
import { errorText } from '@/lib/inventory2/errorText';
import { STATUS_LABEL, STATUS_TONE, STATUS_MEANING } from '@/lib/inventory2/status';
import {
  useQcTemplates, useQcResults, useRecordQc, useUploadQcAttachment,
} from '@/hooks/inventory2/qc';
import {
  explainVerdict, isLiveAttachment,
  type QcAttachment, type QcSubmission, type InvStockStatus,
} from '@/lib/services/inventory2/qc';

const TD = 'px-2 py-1.5 border-b border-[hsl(var(--ds-border)/0.7)] align-top';

/** What the operator has entered for one test, before submission. */
interface Draft {
  result: boolean | null;
  value: string;
  notes: string;
  attachments: QcAttachment[];
}

const EMPTY_DRAFT: Draft = { result: null, value: '', notes: '', attachments: [] };

export function QcRunner({
  stockItemId, productId, serial, currentStatus, operationId, onClose,
}: {
  stockItemId: string;
  productId: string;
  serial: string;
  currentStatus: InvStockStatus;
  operationId?: string;
  onClose: () => void;
}) {
  const { data: templates = [], isLoading: tLoading, error: tError } = useQcTemplates(productId);
  const { data: results = [], isLoading: rLoading } = useQcResults(stockItemId);
  const record = useRecordQc(stockItemId, operationId);
  const upload = useUploadQcAttachment(stockItemId);

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [uploadFailure, setUploadFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InvStockStatus | null>(null);
  const [busyTemplate, setBusyTemplate] = useState<string | null>(null);

  const draftFor = (id: string): Draft => drafts[id] ?? EMPTY_DRAFT;
  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...draftFor(id), ...patch } }));

  /** Status to explain: the freshly returned one if we just submitted. */
  const shownStatus = outcome ?? currentStatus;
  const verdict = useMemo(
    () => explainVerdict(shownStatus, templates, results),
    [shownStatus, templates, results],
  );

  const answered = templates.filter((t) => draftFor(t.id).result !== null);
  const canSubmit = answered.length > 0 && !record.isPending;

  async function attach(templateId: string, file: File) {
    setUploadFailure(null);
    setBusyTemplate(templateId);
    try {
      const a = await upload.mutateAsync(file);
      setDraft(templateId, { attachments: [...draftFor(templateId).attachments, a] });
    } catch (e) {
      setUploadFailure(errorText(e));
    } finally {
      setBusyTemplate(null);
    }
  }

  async function submit() {
    setFailure(null);
    const payload: QcSubmission[] = answered.map((t) => {
      const d = draftFor(t.id);
      return {
        template_id: t.id,
        result: d.result as boolean,
        value: d.value.trim() || null,
        notes: d.notes.trim() || null,
        attachments: d.attachments,
      };
    });
    try {
      const status = await record.mutateAsync(payload);
      setOutcome(status);
      setDrafts({});          // history now carries what was just entered
    } catch (e) {
      // Rule 5 — inv_record_qc_results names the test that blocked this.
      setFailure(errorText(e));
    }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`Quality control for ${serial}`}
      className="ds-root fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className={cn('max-h-[90vh] w-full max-w-3xl overflow-auto',
          'bg-[hsl(var(--ds-surface))] border border-[hsl(var(--ds-border))]',
          'rounded-[var(--ds-radius)] shadow-[var(--ds-shadow-pop)]')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ------------------------------------------------------- header */}
        <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--ds-border))] px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="text-[var(--ds-fs-md)] font-semibold text-[hsl(var(--ds-ink))]">
              Quality control
            </h2>
            <p className="truncate font-mono text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))]">
              {serial}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill tone={STATUS_TONE[shownStatus]}>{STATUS_LABEL[shownStatus]}</StatusPill>
            <Button size="sm" variant="subtle" onClick={onClose}>Close</Button>
          </div>
        </div>

        <div className="p-3">
          {/* ----------------------------------------------------- verdict */}
          <div
            className={cn('rounded-[var(--ds-radius)] border px-3 py-2',
              outcome
                ? 'border-[hsl(var(--ds-border-strong))] bg-[hsl(var(--ds-surface-sunken))]'
                : 'border-[hsl(var(--ds-border))]')}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
                {outcome ? 'Result of this inspection' : 'Current condition'}
              </span>
              <StatusPill tone={STATUS_TONE[shownStatus]}>{STATUS_LABEL[shownStatus]}</StatusPill>
              <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))]">
                {STATUS_MEANING[shownStatus]}
              </span>
            </div>

            {/* The "why", spelled out rather than left to be inferred. */}
            <ul className="mt-1.5 space-y-0.5 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))]">
              {verdict.failedRequired.length > 0 && (
                <li>
                  <strong className="text-[hsl(var(--ds-red))]">Required test failed:</strong>{' '}
                  {verdict.failedRequired.join(', ')}
                </li>
              )}
              {verdict.untestedRequired.length > 0 && (
                <li>
                  <strong className="text-[hsl(var(--ds-ink))]">Required, not yet tested:</strong>{' '}
                  {verdict.untestedRequired.join(', ')}
                </li>
              )}
              {verdict.failedAdvisory.length > 0 && (
                <li>
                  <strong className="text-[hsl(var(--ds-amber))]">Advisory test failed:</strong>{' '}
                  {verdict.failedAdvisory.join(', ')}
                </li>
              )}
              {verdict.requiredTotal > 0 && (
                <li>
                  {verdict.requiredPassed} of {verdict.requiredTotal} required tests passing.
                </li>
              )}
            </ul>
          </div>

          {/* ------------------------------------------ no-checklist warning */}
          {!tLoading && verdict.noChecklist && (
            <div className="mt-2 flex items-start gap-2 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-amber))] bg-[hsl(var(--ds-amber-bg))] px-3 py-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--ds-amber))]" aria-hidden />
              <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">
                <strong>This product has no quality checklist.</strong> No template is configured
                for it and none is global, so there is nothing to inspect against — recording an
                empty inspection would move the unit straight to OK and make it sellable without
                any check having happened. Configure templates for this product first.
              </p>
            </div>
          )}

          {tError && (
            <div className="mt-2">
              <ErrorBanner title="Failed to load the checklist" message={errorText(tError)} />
            </div>
          )}
          {failure && (
            <div className="mt-2">
              <ErrorBanner
                title="The database refused this inspection"
                message={failure}
                onDismiss={() => setFailure(null)}
              />
            </div>
          )}
          {uploadFailure && (
            <div className="mt-2">
              <ErrorBanner
                title="Attachment upload failed"
                message={uploadFailure}
                onDismiss={() => setUploadFailure(null)}
              />
            </div>
          )}

          {/* ---------------------------------------------------- checklist */}
          {templates.length > 0 && (
            <>
              <h3 className="mt-3 text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
                Checklist
              </h3>
              <div className="ds-scroll-x mt-1 overflow-x-auto">
                {/*
                  Explicit widths, not auto layout. An uploaded filename in the
                  Evidence cell is wide enough to starve the Test column down to
                  one character, which stacks the description vertically.
                */}
                <table className="w-full min-w-[760px] table-fixed border-collapse text-[var(--ds-fs-sm)]">
                  <colgroup>
                    <col className="w-[240px]" />
                    <col className="w-[90px]" />
                    <col className="w-[110px]" />
                    <col className="w-[110px]" />
                    <col className="w-[150px]" />
                    <col className="w-[160px]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-[hsl(var(--ds-border-strong))]">
                      {['Test', 'Required', 'Result', 'Value', 'Evidence', 'Notes'].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-semibold text-[hsl(var(--ds-ink-muted))]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((t) => {
                      const d = draftFor(t.id);
                      const prior = results.filter((r) => r.template_id === t.id && r.is_latest)[0];
                      return (
                        <tr key={t.id}>
                          <td className={TD}>
                            <div className="text-[hsl(var(--ds-ink))]">{t.name}</div>
                            {t.description && (
                              <div className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                                {t.description}
                              </div>
                            )}
                            {prior && (
                              <div className="mt-0.5 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                                Latest: {prior.result ? 'Pass' : 'Fail'} (#{prior.seq})
                              </div>
                            )}
                          </td>
                          <td className={TD}>
                            {t.is_required
                              ? <StatusPill tone="grey">Required</StatusPill>
                              : <span className="text-[hsl(var(--ds-ink-subtle))]">Advisory</span>}
                          </td>
                          <td className={TD}>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant={d.result === true ? 'primary' : 'outline'}
                                onClick={() => setDraft(t.id, { result: d.result === true ? null : true })}
                              >
                                Pass
                              </Button>
                              <Button
                                size="sm"
                                variant={d.result === false ? 'danger' : 'outline'}
                                onClick={() => setDraft(t.id, { result: d.result === false ? null : false })}
                              >
                                Fail
                              </Button>
                            </div>
                          </td>
                          <td className={TD}>
                            {t.requires_value ? (
                              <TextInput
                                aria-label={`Value for ${t.name}`}
                                className="h-[26px] w-full px-1.5 py-0"
                                value={d.value}
                                placeholder="required"
                                onChange={(e) => setDraft(t.id, { value: e.target.value })}
                              />
                            ) : (
                              <span className="text-[hsl(var(--ds-ink-subtle))]">—</span>
                            )}
                          </td>
                          <td className={TD}>
                            {t.requires_attachment ? (
                              <div className="space-y-1">
                                <label
                                  className={cn(
                                    'inline-flex cursor-pointer items-center gap-1',
                                    'rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))]',
                                    'px-2 py-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink))]',
                                    'hover:bg-[hsl(var(--ds-surface-sunken))]',
                                  )}
                                >
                                  <Upload className="h-3 w-3" aria-hidden />
                                  {busyTemplate === t.id ? 'Uploading…' : 'Upload'}
                                  <input
                                    type="file"
                                    className="sr-only"
                                    accept="image/*"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) void attach(t.id, f);
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
                                {d.attachments.map((a, i) => (
                                  <div key={i} className="flex min-w-0 items-center gap-1 text-[var(--ds-fs-xs)]">
                                    <Paperclip className="h-3 w-3 shrink-0 text-[hsl(var(--ds-ink-subtle))]" aria-hidden />
                                    <a
                                      href={a.url} target="_blank" rel="noreferrer" title={a.name}
                                      className="min-w-0 truncate text-[hsl(var(--ds-link))] hover:underline"
                                    >
                                      {a.name}
                                    </a>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[hsl(var(--ds-ink-subtle))]">—</span>
                            )}
                          </td>
                          <td className={TD}>
                            <TextInput
                              aria-label={`Notes for ${t.name}`}
                              className="h-[26px] w-full px-1.5 py-0"
                              value={d.notes}
                              onChange={(e) => setDraft(t.id, { notes: e.target.value })}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
                  {record.isPending
                    ? 'Recording…'
                    : `Record ${answered.length || ''} result${answered.length === 1 ? '' : 's'}`.trim()}
                </Button>
                <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                  Only the tests you mark are submitted. Re-testing a template adds a new result;
                  nothing is overwritten.
                </span>
              </div>
            </>
          )}

          {/* ------------------------------------------------------ history */}
          <h3 className="mt-4 text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
            Inspection history
          </h3>
          {rLoading ? (
            <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-subtle))]">Loading…</p>
          ) : results.length === 0 ? (
            <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-subtle))]">
              This unit has never been inspected.
            </p>
          ) : (
            <div className="ds-scroll-x mt-1 overflow-x-auto">
              <table className="w-full min-w-[720px] table-fixed border-collapse text-[var(--ds-fs-sm)]">
                <colgroup>
                  <col className="w-[50px]" />
                  <col className="w-[170px]" />
                  <col className="w-[90px]" />
                  <col className="w-[110px]" />
                  <col className="w-[90px]" />
                  <col className="w-[170px]" />
                  <col className="w-[130px]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-[hsl(var(--ds-border-strong))]">
                    {['#', 'Test', 'Result', 'Counts?', 'Value', 'Evidence', 'When'].map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left font-semibold text-[hsl(var(--ds-ink-muted))]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...results].sort((a, b) => b.seq - a.seq).map((r) => (
                    <tr key={r.id} className={cn(!r.is_latest && 'opacity-60')}>
                      <td className={cn(TD, 'tabular-nums')}>{r.seq}</td>
                      <td className={TD}>{r.template_name ?? '—'}</td>
                      <td className={TD}>
                        <StatusPill tone={r.result ? 'green' : 'red'}>
                          {r.result ? 'Pass' : 'Fail'}
                        </StatusPill>
                      </td>
                      <td className={TD}>
                        {r.is_latest
                          ? <StatusPill tone="blue">Current</StatusPill>
                          : <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                              Superseded
                            </span>}
                      </td>
                      <td className={TD}>{r.value ?? '—'}</td>
                      <td className={TD}>
                        {r.attachments.length === 0
                          ? <span className="text-[hsl(var(--ds-ink-subtle))]">—</span>
                          : r.attachments.map((a, i) => (
                              isLiveAttachment(a) ? (
                                <a
                                  key={i} href={a.url} target="_blank" rel="noreferrer"
                                  className="block truncate text-[var(--ds-fs-xs)] text-[hsl(var(--ds-link))] hover:underline"
                                >
                                  {a.name ?? a.url}
                                </a>
                              ) : (
                                // Seeded placeholders point at nothing. Saying so
                                // beats rendering a link that 404s as evidence.
                                <span
                                  key={i}
                                  title={`No file behind this reference: ${a.url ?? 'no url'}`}
                                  className="block truncate text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))] line-through"
                                >
                                  {a.name ?? 'attachment'} (missing)
                                </span>
                              )
                            ))}
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap text-[var(--ds-fs-xs)]')}>
                        {r.tested_at?.slice(0, 16).replace('T', ' ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
