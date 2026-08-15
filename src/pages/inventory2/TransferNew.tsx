/**
 * Inventory 2 — new internal transfer. Route: /inventory2/transfers/new
 *
 * Creates the document only. Lines and units come after, on the detail page and
 * at the bay — matching the receipt form, and matching Odoo, where a picking is
 * saved first and populated second.
 *
 * ── THE OPERATION TYPE IS THE ROUTE ───────────────────────────────────────
 * "Godown → Showroom" and "Showroom → Packing" are separate operation types,
 * not one type with two location pickers. So the type is chosen first and both
 * ends follow from it. When a type locks an end, that end is the type's answer
 * and the form says so rather than offering a choice that would be discarded.
 *
 * ── NEITHER END IS EVER HIDDEN ────────────────────────────────────────────
 * Locked or not, source and destination are both on screen. This is the same
 * rule the receipt form follows for its destination, for the same reason: the
 * old module hid the destination, which is how goods ended up in places nobody
 * could see from the document. A transfer has TWO such ends, so it has twice
 * the opportunity to make that mistake.
 *
 * `locks_source` is honoured here for the first time anywhere in the codebase.
 * It has existed on inv_operation_type since Step 2 and been read by nothing.
 *
 * The client values are still SENT when the type locks an end — the database
 * decides, and reports back `client_source_ignored` / `client_destination_ignored`
 * so the next screen can say we overrode the user rather than quietly showing
 * something else.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY2_NAV } from '@/lib/navigation';
import { DocumentHeader, Button, type RibbonStage, type HeaderAction } from '@/design-system';
import '@/design-system/tokens.css';
import {
  Field, TextInput, TextArea, SelectInput, LockedValue, ErrorBanner,
} from '@/components/inventory2/formControls';
import { errorText } from '@/lib/inventory2/errorText';
import {
  useInv2TransferTypes, useInv2TransferLocations, useCreateTransfer,
} from '@/hooks/inventory2/transfers';

const LIST_PATH = '/inventory2/transfers';

/** Same four stages as the detail page; a new document sits on Draft. */
const RIBBON_STAGES: RibbonStage[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'ready', label: 'Ready' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

export default function TransferNew() {
  const navigate = useNavigate();

  const { data: types = [], isLoading: typesLoading, error: typesError } = useInv2TransferTypes();
  const { data: locations = [] } = useInv2TransferLocations();
  const create = useCreateTransfer();

  const [typeId, setTypeId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [destId, setDestId] = useState('');
  const [sourceDoc, setSourceDoc] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  // Default to the only transfer type when there is exactly one, so the common
  // case is one fewer click. With several routes configured, the user chooses.
  const effectiveTypeId = typeId || (types.length === 1 ? types[0].id : '');
  const selectedType = useMemo(
    () => types.find((t) => t.id === effectiveTypeId) ?? null,
    [types, effectiveTypeId],
  );

  const locationName = (id: string | null | undefined) =>
    locations.find((l) => l.id === id)?.name ?? null;

  const srcLocked = !!selectedType?.locks_source;
  const dstLocked = !!selectedType?.locks_destination;
  const lockedSrc = locationName(selectedType?.default_source_location_id);
  const lockedDst = locationName(selectedType?.default_dest_location_id);

  /** What the document will actually read, for the route preview. */
  const effectiveSrc = srcLocked
    ? lockedSrc
    : locationName(sourceId) ?? locationName(selectedType?.default_source_location_id);
  const effectiveDst = dstLocked
    ? lockedDst
    : locationName(destId) ?? locationName(selectedType?.default_dest_location_id);

  const canSubmit = !!effectiveTypeId && !create.isPending;

  async function submit() {
    setFailure(null);
    try {
      const res = await create.mutateAsync({
        operationTypeId: effectiveTypeId,
        sourceLocationId: sourceId || null,
        destLocationId: destId || null,
        sourceDocument: sourceDoc.trim() || null,
        // datetime-local yields a value with no zone; let the browser resolve it.
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        notes: notes.trim() || null,
      });
      navigate(`/inventory2/transfers/${res.id}`, {
        state: {
          createdSourceIgnored: res.client_source_ignored,
          createdDestinationIgnored: res.client_destination_ignored,
        },
      });
    } catch (e) {
      // Rule 5 — the message stays on screen, not just in a toast that fades.
      setFailure(errorText(e));
    }
  }

  const actions: HeaderAction[] = [
    {
      key: 'save',
      label: create.isPending ? 'Creating…' : 'Create',
      variant: 'primary',
      onClick: () => void submit(),
      disabled: !canSubmit,
      title: effectiveTypeId ? undefined : 'Choose an operation type first',
    },
    { key: 'discard', label: 'Discard', onClick: () => navigate(LIST_PATH) },
  ];

  return (
    <AppLayout title="New Transfer" moduleNav={INVENTORY2_NAV}>
      <div className="ds-root p-3 md:p-4">
        <div className="mx-auto max-w-4xl">
          <DocumentHeader
            breadcrumb={['Inventory 2', 'Internal Transfers', 'New']}
            title="New Internal Transfer"
            actions={actions}
            stages={RIBBON_STAGES}
            currentStage="draft"
            cog={false}
          />

          <div className="rounded-b-[var(--ds-radius)] border border-t-0 border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-surface))] p-3">
            {typesError && (
              <div className="mb-3">
                <ErrorBanner title="Failed to load operation types" message={errorText(typesError)} />
              </div>
            )}

            {failure && (
              <div className="mb-3">
                <ErrorBanner
                  title="Could not create the transfer"
                  message={failure}
                  onDismiss={() => setFailure(null)}
                />
              </div>
            )}

            {!typesLoading && types.length === 0 && (
              <p className="mb-3 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
                No active operation type of kind <code>internal</code> exists, so a transfer
                cannot be created. Each transfer route is its own operation type — configure
                one under Setup → Operation Types. This is configuration, not a bug in this
                screen.
              </p>
            )}

            <div className="grid gap-x-8 md:grid-cols-2">
              <div>
                <Field label="Operation Type" required htmlFor="ot"
                  hint="The route. Each type fixes where stock moves from and to.">
                  <SelectInput
                    id="ot"
                    value={effectiveTypeId}
                    onChange={(e) => {
                      setTypeId(e.target.value);
                      setSourceId('');
                      setDestId('');
                    }}
                    disabled={typesLoading || types.length === 0}
                  >
                    <option value="">Select…</option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </SelectInput>
                </Field>

                {/* Always rendered — locked or not. */}
                <Field label="Source" htmlFor={srcLocked ? undefined : 'src'} required={!srcLocked}>
                  {srcLocked ? (
                    <LockedValue
                      value={lockedSrc ?? 'Configured on the operation type'}
                      reason={`Set by operation type ${selectedType?.name ?? ''} — staff cannot draw stock from anywhere else.`}
                    />
                  ) : (
                    <SelectInput
                      id="src"
                      value={sourceId}
                      onChange={(e) => setSourceId(e.target.value)}
                      disabled={!selectedType}
                    >
                      <option value="">
                        {selectedType
                          ? `Default — ${locationName(selectedType.default_source_location_id) ?? 'none configured'}`
                          : 'Choose an operation type first'}
                      </option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}{l.code ? ` (${l.code})` : ''}
                        </option>
                      ))}
                    </SelectInput>
                  )}
                </Field>

                <Field label="Destination" htmlFor={dstLocked ? undefined : 'dest'} required={!dstLocked}>
                  {dstLocked ? (
                    <LockedValue
                      value={lockedDst ?? 'Configured on the operation type'}
                      reason={`Set by operation type ${selectedType?.name ?? ''} — staff cannot re-point it.`}
                    />
                  ) : (
                    <SelectInput
                      id="dest"
                      value={destId}
                      onChange={(e) => setDestId(e.target.value)}
                      disabled={!selectedType}
                    >
                      <option value="">
                        {selectedType
                          ? `Default — ${locationName(selectedType.default_dest_location_id) ?? 'none configured'}`
                          : 'Choose an operation type first'}
                      </option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}{l.code ? ` (${l.code})` : ''}
                        </option>
                      ))}
                    </SelectInput>
                  )}
                </Field>

                {/*
                  The route as one sentence. Both ends are already fields above;
                  this is here because the pair is the thing being decided, and
                  reading it off two separate selects is how a reversed transfer
                  gets created.
                */}
                {selectedType && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 rounded-[var(--ds-radius)] bg-[hsl(var(--ds-surface-sunken))] px-3 py-2">
                    <span className="text-[var(--ds-fs-xs)] uppercase tracking-wide text-[hsl(var(--ds-ink-subtle))]">
                      Route
                    </span>
                    <span className="text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
                      {effectiveSrc ?? '—'}
                    </span>
                    <ArrowRight className="h-4 w-4 text-[hsl(var(--ds-ink-subtle))]" aria-hidden />
                    <span className="text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
                      {effectiveDst ?? '—'}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <Field label="Source Document" htmlFor="srcdoc"
                  hint="The sales order or picking reference this transfer serves. A reference on the document, not its owner.">
                  <TextInput
                    id="srcdoc"
                    value={sourceDoc}
                    onChange={(e) => setSourceDoc(e.target.value)}
                    placeholder="e.g. SO-1042"
                  />
                </Field>

                <Field label="Scheduled Date" htmlFor="sched">
                  <TextInput
                    id="sched"
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                </Field>

                <Field label="Notes" htmlFor="notes">
                  <TextArea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 border-t border-[hsl(var(--ds-border))] pt-3">
              <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
              <Button variant="subtle" onClick={() => navigate(LIST_PATH)}>Discard</Button>
              <span className="ml-auto text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                The reference is allocated by the database on create.
              </span>
            </div>
          </div>

          <p className="mt-3 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
            Product lines are added on the transfer itself, after it exists. Units are moved
            onto it by scanning at <code>/inventory2/barcode</code>.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
