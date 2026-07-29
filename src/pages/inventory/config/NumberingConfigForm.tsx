/**
 * Document Numbering — form view (rebuilt on the design system).
 *
 * Deliberately thin, because most of a document number is not per-sequence data:
 *
 *   Document Type / Financial Year  identity. UNIQUE (document_type, fy_label),
 *                                   and generate_document_number finds the row by
 *                                   exactly that pair — so read-only on edit,
 *                                   required on create.
 *   Prefix                          READ-ONLY always. Not a column; a hardcoded
 *                                   CASE in generate_document_number and
 *                                   preview_next_document_number.
 *   Counter (last_number)           editable but FORWARD ONLY, see below.
 *   Separator / Number length       GLOBAL, on the numbering_settings singleton.
 *                                   Editable here, but labelled as affecting
 *                                   every module's documents.
 *
 * Counter handling — why editable rather than read-only. Read-only would leave
 * the edit form with nothing to do, and advancing a counter is a legitimate
 * admin operation (skipping a spoiled print run, aligning with a pre-migration
 * sequence). Lowering one is never legitimate: generate_document_number would
 * re-issue numbers already on live documents, and no *_number column has a
 * unique constraint to catch the collision. So the field accepts only values
 * greater than or equal to the stored one, enforced both here and in
 * advanceNumberingSequence so another caller cannot bypass it.
 *
 * Writes `numbering_sequences` (counter only — the update statement never
 * mentions document_type or fy_label) and `numbering_settings` (the two format
 * fields), both through the existing numbering service.
 *
 * Route: /inventory/config/numbering/:id, where :id === 'new' creates.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import {
  useNumberingSequences,
  useNumberingSettings,
  useUpdateNumberingSettings,
  useCurrentFY,
  useCreateNumberingSequence,
  useAdvanceNumberingSequence,
} from '@/hooks/numbering';
import { DocumentHeader, DocumentFields, SectionLabel, type DocumentField } from '@/design-system';
import '@/design-system/tokens.css';
import {
  DEFAULT_PADDING,
  DEFAULT_SEPARATOR,
  KNOWN_DOCUMENT_TYPES,
  documentTypeLabel,
  formatDocumentNumber,
  hasMappedPrefix,
  prefixFor,
} from './numberingMeta';

const LIST_PATH = '/inventory/config/numbering';

const controlClass =
  'w-full rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))] ' +
  'bg-[hsl(var(--ds-surface))] px-2 py-[3px] text-[var(--ds-fs-sm)] ' +
  'text-[hsl(var(--ds-ink))] placeholder:text-[hsl(var(--ds-ink-subtle))] ' +
  'focus:border-[hsl(var(--ds-primary))] focus:outline-none';

export default function NumberingConfigForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const sequencesQuery = useNumberingSequences();
  const settingsQuery = useNumberingSettings();
  const fyQuery = useCurrentFY();
  const createMut = useCreateNumberingSequence();
  const advanceMut = useAdvanceNumberingSequence();
  const settingsMut = useUpdateNumberingSettings();

  const sequences = useMemo(() => sequencesQuery.data ?? [], [sequencesQuery.data]);
  const settings = settingsQuery.data ?? null;
  const currentFy = fyQuery.data ?? '';

  const current = useMemo(
    () => (isNew ? undefined : sequences.find((s) => s.id === id)),
    [sequences, id, isNew],
  );

  // Sequence identity + counter
  const [documentType, setDocumentType] = useState('');
  const [fyLabel, setFyLabel] = useState('');
  const [counter, setCounter] = useState(0);
  // Global format settings
  const [separator, setSeparator] = useState(DEFAULT_SEPARATOR);
  const [padding, setPadding] = useState(DEFAULT_PADDING);

  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) {
      setDocumentType('');
      setFyLabel(currentFy);
      setCounter(0);
      return;
    }
    if (current) {
      setDocumentType(current.document_type);
      setFyLabel(current.fy_label);
      setCounter(current.last_number);
    }
  }, [current, isNew, currentFy]);

  useEffect(() => {
    if (settings) {
      setSeparator(settings.prefix_separator);
      setPadding(settings.sequential_padding);
    }
  }, [settings]);

  const storedCounter = current?.last_number ?? 0;
  const counterLowered = !isNew && counter < storedCounter;

  /**
   * Preview of the *unsaved* form state. Computed client-side because that is
   * the only way to show the effect of an edit before it is written — the RPC
   * can only answer for what is already stored. Kept in sync with the SQL by
   * numberingMeta, which documents the duplication.
   */
  const preview = useMemo(
    () =>
      documentType
        ? formatDocumentNumber({
            documentType,
            fyLabel: fyLabel || currentFy,
            nextNumber: counter + 1,
            separator,
            padding,
          })
        : '—',
    [documentType, fyLabel, currentFy, counter, separator, padding],
  );

  const index = current ? sequences.findIndex((s) => s.id === current.id) : -1;
  const goToIndex = (next: number) => {
    const target = sequences[next];
    if (target) navigate(`${LIST_PATH}/${target.id}`);
  };

  const formatDirty =
    !!settings &&
    (settings.prefix_separator !== separator || settings.sequential_padding !== padding);

  const handleSave = async () => {
    setValidationError(null);

    if (isNew) {
      const type = documentType.trim();
      const fy = fyLabel.trim();
      if (!type) {
        setValidationError('Document type is required.');
        return;
      }
      if (!fy) {
        setValidationError('Financial year is required.');
        return;
      }
      if (sequences.some((s) => s.document_type === type && s.fy_label === fy)) {
        setValidationError(
          `A sequence for ${documentTypeLabel(type)} / ${fy} already exists — open that row instead.`,
        );
        return;
      }
      createMut.mutate(
        { document_type: type, fy_label: fy, last_number: Math.max(0, counter) },
        { onSuccess: (saved) => navigate(`${LIST_PATH}/${saved.id}`) },
      );
      return;
    }

    if (!current) return;

    if (counterLowered) {
      setValidationError(
        `The counter cannot go below ${storedCounter}. Numbers up to ${storedCounter} have ` +
          'already been issued, and lowering it would cause duplicate document numbers.',
      );
      return;
    }

    // Only what actually changed is written. The counter update touches
    // last_number alone; identity columns are never in the statement.
    try {
      if (counter !== storedCounter) {
        await advanceMut.mutateAsync({ id: current.id, lastNumber: counter });
      }
      if (formatDirty) {
        await settingsMut.mutateAsync({
          prefix_separator: separator,
          sequential_padding: padding,
        });
      }
    } catch {
      // Surfaced by the inline banner below and the global mutation toast.
      return;
    }
  };

  const handleDiscard = () => {
    setValidationError(null);
    if (isNew) {
      navigate(LIST_PATH);
      return;
    }
    if (current) {
      setDocumentType(current.document_type);
      setFyLabel(current.fy_label);
      setCounter(current.last_number);
    }
    if (settings) {
      setSeparator(settings.prefix_separator);
      setPadding(settings.sequential_padding);
    }
  };

  const saving = createMut.isPending || advanceMut.isPending || settingsMut.isPending;
  const saveError = createMut.error ?? advanceMut.error ?? settingsMut.error;
  const loadError = sequencesQuery.error ?? settingsQuery.error ?? fyQuery.error;
  const notFound = !isNew && !current && !sequencesQuery.isLoading && !sequencesQuery.error;

  const readOnlyValue = (text: string, note?: string) => (
    <span className="flex flex-col gap-0.5">
      <span className="text-[hsl(var(--ds-ink))]">{text}</span>
      {note && (
        <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">{note}</span>
      )}
    </span>
  );

  const identityLeft: DocumentField[] = [
    {
      key: 'documentType',
      label: 'Document Type',
      value: isNew ? (
        <select
          className={controlClass}
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value)}
          aria-label="Document Type"
        >
          <option value="">— Select —</option>
          {KNOWN_DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {documentTypeLabel(t)} ({prefixFor(t)})
            </option>
          ))}
        </select>
      ) : (
        readOnlyValue(
          documentTypeLabel(documentType),
          'Fixed — the number generator finds this row by document type and year.',
        )
      ),
    },
    {
      key: 'fyLabel',
      label: 'Financial Year',
      value: isNew ? (
        <input
          className={controlClass}
          value={fyLabel}
          onChange={(e) => setFyLabel(e.target.value)}
          placeholder={currentFy || 'e.g. 2627'}
          aria-label="Financial Year"
        />
      ) : (
        readOnlyValue(
          fyLabel,
          fyLabel === currentFy ? 'Current financial year.' : 'A past financial year.',
        )
      ),
    },
    {
      key: 'prefix',
      label: 'Prefix',
      value: readOnlyValue(
        prefixFor(documentType || 'sales_order'),
        hasMappedPrefix(documentType)
          ? 'Fixed in the database function that issues numbers — not editable here.'
          : 'Unknown document types fall back to the type name in upper case.',
      ),
    },
  ];

  const counterRight: DocumentField[] = [
    {
      key: 'counter',
      label: isNew ? 'Start From' : 'Numbers Issued',
      value: (
        <span className="flex flex-col gap-1">
          <input
            type="number"
            min={isNew ? 0 : storedCounter}
            step={1}
            className={controlClass}
            value={counter}
            onChange={(e) => setCounter(Number(e.target.value))}
            aria-label={isNew ? 'Start From' : 'Numbers Issued'}
          />
          <span
            className={
              counterLowered
                ? 'text-[var(--ds-fs-xs)] font-semibold text-[hsl(var(--ds-red))]'
                : 'text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]'
            }
          >
            {isNew
              ? 'Count already issued. Leave at 0 so the first document is number 1.'
              : counterLowered
                ? `Cannot go below ${storedCounter} — lowering this causes duplicate document numbers.`
                : `Forward only. Currently ${storedCounter} issued; raising this skips numbers.`}
          </span>
        </span>
      ),
    },
    {
      key: 'preview',
      label: 'Next Number',
      value: (
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-[15px] font-semibold text-[hsl(var(--ds-ink))]">
            {preview}
          </span>
          <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
            Preview of the current form, including unsaved changes.
          </span>
        </span>
      ),
    },
  ];

  const formatFields: DocumentField[][] = [
    [
      {
        key: 'separator',
        label: 'Separator',
        value: (
          <input
            className={controlClass}
            value={separator}
            maxLength={3}
            onChange={(e) => setSeparator(e.target.value)}
            placeholder="-"
            aria-label="Separator"
          />
        ),
      },
    ],
    [
      {
        key: 'padding',
        label: 'Number Length',
        value: (
          <input
            type="number"
            min={1}
            max={12}
            step={1}
            className={controlClass}
            value={padding}
            onChange={(e) => setPadding(Number(e.target.value))}
            aria-label="Number Length"
          />
        ),
      },
    ],
  ];

  const headerTitle = isNew
    ? 'New'
    : current
      ? `${documentTypeLabel(current.document_type)} · ${current.fy_label}`
      : '…';

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="ds-root bg-[hsl(var(--ds-canvas))] min-h-full p-4">
        <DocumentHeader
          breadcrumb={['Numbering', headerTitle]}
          title={headerTitle}
          actions={[
            {
              key: 'save',
              label: saving ? 'Saving…' : 'Save',
              variant: 'primary',
              onClick: handleSave,
            },
            { key: 'discard', label: 'Discard', variant: 'outline', onClick: handleDiscard },
            {
              key: 'new',
              label: 'New',
              variant: 'subtle',
              onClick: () => navigate(`${LIST_PATH}/new`),
            },
          ]}
          // A counter has no workflow, so the ribbon is empty by design.
          stages={[]}
          currentStage=""
          pager={
            index >= 0
              ? {
                  index: index + 1,
                  total: sequences.length,
                  onPrev: () => goToIndex(index - 1),
                  onNext: () => goToIndex(index + 1),
                }
              : undefined
          }
        />

        <div className="rounded-b-[var(--ds-radius)] border border-t-0 border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-surface))]">
          {(validationError || saveError || loadError) && (
            <div
              role="alert"
              className="mx-3 mt-3 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-red)/0.4)] bg-[hsl(var(--ds-red-bg))] px-3 py-2 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-red))]"
            >
              {validationError ??
                (saveError instanceof Error
                  ? saveError.message
                  : loadError instanceof Error
                    ? loadError.message
                    : String(saveError ?? loadError))}
            </div>
          )}

          {notFound ? (
            <p className="px-3 py-10 text-center text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-subtle))]">
              Sequence not found.
            </p>
          ) : (
            <div className="space-y-4 p-3">
              <DocumentFields columns={[identityLeft, counterRight]} className="px-0 py-0" />

              <div>
                <SectionLabel>Format — global</SectionLabel>
                <p className="mt-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                  Shared by every document in every module, not just this sequence. Changing
                  either value reformats all future numbers across Sales, Invoicing,
                  Manufacturing, Returns and Inventory. Existing documents keep the numbers
                  they were given.
                </p>
                <DocumentFields columns={formatFields} className="px-0 py-0" />
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
