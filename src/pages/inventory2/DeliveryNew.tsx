/**
 * Inventory 2 — new outgoing delivery. Route: /inventory2/deliveries/new
 *
 * Creates the document only. Lines and units come after, on the detail page and
 * at the bay — matching the receipt and transfer forms.
 *
 * ── TWO FIELDS A TRANSFER DOES NOT HAVE ───────────────────────────────────
 * CUSTOMER      who receives the goods. Written to partner_customer_id. It is
 *               NOT the destination — there is one CUSTOMERS location and every
 *               delivery ends there, so the party has to be recorded on the
 *               document or it is not recorded at all.
 *
 *               Read straight off `public.customers`. Deliberately NOT through
 *               CustomerSelector, which wraps CRM's ContactSearchCombobox and
 *               sits on the SHARED BOUNDARY — importing it would make this a CRM
 *               change.
 *
 * SALES ORDER   which order this delivery is against. Recorded because the
 *               payment gate will need it, even though nothing verifies payment
 *               yet. Optional, and the form says plainly what its absence
 *               means once the gate is switched on.
 *
 * ── THE PAYMENT NOTICE LIVES HERE AND ON THE DETAIL PAGE ──────────────────
 * `inv_assert_delivery_paid` exists, is named, and raises `feature_not_supported`
 * because sales_orders.paid_amount is not maintained until Sales is rebuilt. It
 * is NOT wired into inv_complete_operation, so a delivery completes without any
 * payment check at all. Saying so on screen is the whole point: an inert gate
 * that nobody is told about is indistinguishable from one that passed.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Info } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY2_NAV } from '@/lib/navigation';
import { DocumentHeader, Button, type RibbonStage, type HeaderAction } from '@/design-system';
import '@/design-system/tokens.css';
import {
  Field, TextInput, TextArea, SelectInput, LockedValue, ErrorBanner,
} from '@/components/inventory2/formControls';
import { errorText } from '@/lib/inventory2/errorText';
import {
  useInv2DeliveryTypes, useInv2DeliveryLocations, useInv2DeliveryCustomers,
  useInv2DeliverySalesOrders, useCreateDelivery,
} from '@/hooks/inventory2/deliveries';

const LIST_PATH = '/inventory2/deliveries';

const RIBBON_STAGES: RibbonStage[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'ready', label: 'Ready' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

export default function DeliveryNew() {
  const navigate = useNavigate();

  const { data: types = [], isLoading: typesLoading, error: typesError } = useInv2DeliveryTypes();
  const { data: locations = [] } = useInv2DeliveryLocations();
  const { data: customers = [], error: customersError } = useInv2DeliveryCustomers();
  const { data: salesOrders = [], error: salesOrdersError } = useInv2DeliverySalesOrders();
  const create = useCreateDelivery();

  const [typeId, setTypeId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [destId, setDestId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [salesOrderId, setSalesOrderId] = useState('');
  const [sourceDoc, setSourceDoc] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const effectiveTypeId = typeId || (types.length === 1 ? types[0].id : '');
  const selectedType = useMemo(
    () => types.find((t) => t.id === effectiveTypeId) ?? null,
    [types, effectiveTypeId],
  );
  const selectedOrder = useMemo(
    () => salesOrders.find((s) => s.id === salesOrderId) ?? null,
    [salesOrders, salesOrderId],
  );

  const locationName = (id: string | null | undefined) =>
    locations.find((l) => l.id === id)?.name ?? null;

  const srcLocked = !!selectedType?.locks_source;
  const dstLocked = !!selectedType?.locks_destination;
  const lockedSrc = locationName(selectedType?.default_source_location_id);
  const lockedDst = locationName(selectedType?.default_dest_location_id);

  const effectiveSrc = srcLocked
    ? lockedSrc
    : locationName(sourceId) ?? locationName(selectedType?.default_source_location_id);
  const effectiveDst = dstLocked
    ? lockedDst
    : locationName(destId) ?? locationName(selectedType?.default_dest_location_id);

  const canSubmit = !!effectiveTypeId && !create.isPending;

  /**
   * Picking an order fills the customer, because an order already knows whose
   * it is. It is a DEFAULT, not a lock: the two are separate columns and there
   * are real cases where goods go to a different party, so the customer stays
   * editable afterwards.
   */
  function onPickOrder(id: string) {
    setSalesOrderId(id);
    const order = salesOrders.find((s) => s.id === id);
    if (order?.customer_id && !customerId) setCustomerId(order.customer_id);
  }

  async function submit() {
    setFailure(null);
    try {
      const res = await create.mutateAsync({
        operationTypeId: effectiveTypeId,
        sourceLocationId: sourceId || null,
        destLocationId: destId || null,
        customerId: customerId || null,
        salesOrderId: salesOrderId || null,
        sourceDocument: sourceDoc.trim() || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        notes: notes.trim() || null,
      });
      navigate(`/inventory2/deliveries/${res.id}`, {
        state: {
          createdSourceIgnored: res.client_source_ignored,
          createdDestinationIgnored: res.client_destination_ignored,
        },
      });
    } catch (e) {
      // Rule 5 — the message stays on screen, not just in a toast that fades.
      // createDelivery's own error names the document when the delivery WAS
      // created and only the order link failed, so this is not a dead end.
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
    <AppLayout title="New Delivery" moduleNav={INVENTORY2_NAV}>
      <div className="ds-root p-3 md:p-4">
        <div className="mx-auto max-w-4xl">
          <DocumentHeader
            breadcrumb={['Inventory 2', 'Deliveries', 'New']}
            title="New Delivery"
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
            {customersError && (
              <div className="mb-3">
                <ErrorBanner title="Failed to load customers" message={errorText(customersError)} />
              </div>
            )}
            {salesOrdersError && (
              <div className="mb-3">
                <ErrorBanner title="Failed to load sales orders" message={errorText(salesOrdersError)} />
              </div>
            )}

            {failure && (
              <div className="mb-3">
                <ErrorBanner
                  title="Could not create the delivery"
                  message={failure}
                  onDismiss={() => setFailure(null)}
                />
              </div>
            )}

            {!typesLoading && types.length === 0 && (
              <p className="mb-3 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
                No active operation type of kind <code>outgoing</code> exists, so a delivery
                cannot be created. Configure one under Setup → Operation Types. This is
                configuration, not a bug in this screen.
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

                <Field label="Sales Order" htmlFor="so"
                  hint="The order this delivery is against. A reference on the document, not its owner.">
                  <SelectInput id="so" value={salesOrderId} onChange={(e) => onPickOrder(e.target.value)}>
                    <option value="">None — not against an order</option>
                    {salesOrders.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.reference ?? s.id}{s.customer_name ? ` — ${s.customer_name}` : ''}
                        {s.status ? ` (${s.status})` : ''}
                      </option>
                    ))}
                  </SelectInput>
                </Field>

                <Field label="Customer" htmlFor="cust"
                  hint="Who receives the goods. Recorded on the document — the destination location is the same CUSTOMERS node for every delivery.">
                  <SelectInput id="cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">None recorded</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.company ? ` — ${c.company}` : ''}
                      </option>
                    ))}
                  </SelectInput>
                </Field>

                <Field label="Source" htmlFor={srcLocked ? undefined : 'src'} required={!srcLocked}>
                  {srcLocked ? (
                    <LockedValue
                      value={lockedSrc ?? 'Configured on the operation type'}
                      reason={`Set by operation type ${selectedType?.name ?? ''} — staff cannot draw stock from anywhere else.`}
                    />
                  ) : (
                    <SelectInput
                      id="src" value={sourceId} onChange={(e) => setSourceId(e.target.value)}
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
                      id="dest" value={destId} onChange={(e) => setDestId(e.target.value)}
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
                  hint="A free-text reference. The structured link is the Sales Order field.">
                  <TextInput
                    id="srcdoc" value={sourceDoc}
                    onChange={(e) => setSourceDoc(e.target.value)}
                    placeholder="e.g. DN-1042"
                  />
                </Field>

                <Field label="Scheduled Date" htmlFor="sched">
                  <TextInput
                    id="sched" type="datetime-local" value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                </Field>

                <Field label="Notes" htmlFor="notes">
                  <TextArea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>

                <PaymentNotice orderPicked={!!selectedOrder} />
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
            Product lines are added on the delivery itself, after it exists. Units are shipped
            onto it by scanning at <code>/inventory2/barcode</code>.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}

/**
 * The inert-gate notice, in words, on the screen that creates the document.
 *
 * Stated as a fact about the SYSTEM rather than about this order, because that
 * is what is true: nothing anywhere checks payment before a delivery completes.
 */
export function PaymentNotice({ orderPicked }: { orderPicked: boolean }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-surface-sunken))] px-3 py-2">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--ds-ink-subtle))]" aria-hidden />
      <div className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))]">
        <p className="font-semibold text-[hsl(var(--ds-ink))]">
          Payment verification is not active
        </p>
        <p className="mt-0.5">
          It stays inactive until the Sales module is complete. The gate exists and is named
          (<code>inv_assert_delivery_paid</code>), but it refuses rather than approves and is
          deliberately not wired into completion — so <strong>this delivery can be completed
          whether or not the order has been paid</strong>, and nothing will stop it.
        </p>
        <p className="mt-1">
          {orderPicked
            ? 'The sales order is recorded on the delivery so the check can be applied later.'
            : 'Recording a sales order now is what lets the check be applied later. Without one, there is nothing for the gate to read.'}
        </p>
      </div>
    </div>
  );
}
