/**
 * Inventory 2 — new receipt. Route: /inventory2/receipts/new
 *
 * Creates the document only. Lines and units are added on the detail page,
 * which is where the state machine lives — matching Odoo, where a receipt is
 * saved first and populated second.
 *
 * DESTINATION IS NEVER HIDDEN. When the chosen operation type sets
 * locks_destination, the field renders read-only with a lock and the reason;
 * when it does not, it renders as an editable select. Either way the value is
 * on screen. The old module hid it, which is how goods ended up in places
 * nobody could see from the document.
 *
 * The client value is still SENT when the type locks the destination — the
 * database decides, and reports back `client_destination_ignored` so we can
 * tell the user we overrode them rather than quietly showing something else.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import {
  DocumentHeader, Button,
  type RibbonStage, type HeaderAction,
} from '@/design-system';
import '@/design-system/tokens.css';
import {
  Field, TextInput, TextArea, SelectInput, LockedValue, ErrorBanner,
} from '@/components/inventory2/formControls';
import { errorText } from '@/lib/inventory2/errorText';
import {
  useInv2ReceiptTypes, useInv2Locations, useInv2Vendors, useCreateReceipt,
} from '@/hooks/inventory2/receiptMutations';

const LIST_PATH = '/inventory2/receipts';

/** Same four stages as the detail page; a new document sits on Draft. */
const RIBBON_STAGES: RibbonStage[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'ready', label: 'Ready' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

export default function ReceiptNew() {
  const navigate = useNavigate();

  const { data: types = [], isLoading: typesLoading, error: typesError } = useInv2ReceiptTypes();
  const { data: locations = [] } = useInv2Locations();
  const { data: vendors = [] } = useInv2Vendors();
  const create = useCreateReceipt();

  const [typeId, setTypeId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [destId, setDestId] = useState('');
  const [sourceDoc, setSourceDoc] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  // Default to the only receipt type when there is exactly one, so the common
  // case is one fewer click. With several, the user must choose.
  const effectiveTypeId = typeId || (types.length === 1 ? types[0].id : '');
  const selectedType = useMemo(
    () => types.find((t) => t.id === effectiveTypeId) ?? null,
    [types, effectiveTypeId],
  );

  const locationName = (id: string | null | undefined) =>
    locations.find((l) => l.id === id)?.name ?? null;

  const locked = !!selectedType?.locks_destination;
  const lockedDest = locationName(selectedType?.default_dest_location_id);

  const canSubmit = !!effectiveTypeId && !create.isPending;

  async function submit() {
    setFailure(null);
    try {
      const res = await create.mutateAsync({
        operationTypeId: effectiveTypeId,
        vendorId: vendorId || null,
        sourceDocument: sourceDoc.trim() || null,
        // datetime-local yields a value with no zone; let the browser resolve it.
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        notes: notes.trim() || null,
        destLocationId: destId || null,
      });
      navigate(`/inventory2/receipts/${res.id}`, {
        state: { createdDestinationIgnored: res.client_destination_ignored },
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
    <AppLayout title="New Receipt" moduleNav={INVENTORY_NAV}>
      <div className="ds-root p-3 md:p-4">
        <div className="mx-auto max-w-4xl">
          <DocumentHeader
            breadcrumb={['Inventory 2', 'Receipts', 'New']}
            title="New Receipt"
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
                  title="Could not create the receipt"
                  message={failure}
                  onDismiss={() => setFailure(null)}
                />
              </div>
            )}

            {!typesLoading && types.length === 0 && (
              <p className="mb-3 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
                No active operation type of kind <code>receipt</code> exists, so a receipt
                cannot be created. This is configuration, not a bug in this screen.
              </p>
            )}

            <div className="grid gap-x-8 md:grid-cols-2">
              <div>
                <Field label="Operation Type" required htmlFor="ot">
                  <SelectInput
                    id="ot"
                    value={effectiveTypeId}
                    onChange={(e) => { setTypeId(e.target.value); setDestId(''); }}
                    disabled={typesLoading || types.length === 0}
                  >
                    <option value="">Select…</option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </SelectInput>
                </Field>

                <Field label="Receive From" htmlFor="vendor" hint="Optional. The vendor the goods came from.">
                  <SelectInput
                    id="vendor"
                    value={vendorId}
                    onChange={(e) => setVendorId(e.target.value)}
                  >
                    <option value="">—</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </SelectInput>
                </Field>

                {/* Always rendered — locked or not. */}
                <Field
                  label="Destination"
                  htmlFor={locked ? undefined : 'dest'}
                  required={!locked}
                >
                  {locked ? (
                    <LockedValue
                      value={lockedDest ?? 'Configured on the operation type'}
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
              </div>

              <div>
                <Field label="Source Document" htmlFor="srcdoc" hint="Vendor invoice or delivery note reference.">
                  <TextInput
                    id="srcdoc"
                    value={sourceDoc}
                    onChange={(e) => setSourceDoc(e.target.value)}
                    placeholder="e.g. INV-4471"
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
            Product lines and received units are added on the receipt itself, after it exists.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
