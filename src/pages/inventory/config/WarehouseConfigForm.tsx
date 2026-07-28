/**
 * Warehouse — form view (rebuilt on the design system).
 *
 * Deliberately minimal, matching the true-Odoo warehouse form: a title-style
 * Name field, a Short Name, and an Address. Nothing else. Routing defaults are
 * configured on Operation Types, so this form never reads or writes
 * `warehouses.default_receipt_location_id` / `default_delivery_location_id` /
 * `default_internal_location_id`, and there is no routes button because we do
 * not use multi-step routes.
 *
 * Writes the `warehouses` table only, through the existing
 * `useSaveWarehouse` -> `saveWarehouseAsync` service path (insert when the id
 * is empty, update otherwise). No new data layer.
 *
 * Route: /inventory/config/warehouses/:id, where :id === 'new' creates.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useWarehouses, useSaveWarehouse } from '@/hooks/inventory';
import type { Warehouse } from '@/lib/services/inventory';
import { DocumentHeader, DocumentFields, type DocumentField } from '@/design-system';
import '@/design-system/tokens.css';

const LIST_PATH = '/inventory/config/warehouses';

interface FormState {
  name: string;
  code: string;
  address: string;
}

const EMPTY: FormState = { name: '', code: '', address: '' };

/** Shared input styling so the two field inputs match the design system. */
const inputClass =
  'w-full rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))] ' +
  'bg-[hsl(var(--ds-surface))] px-2 py-[3px] text-[var(--ds-fs-sm)] ' +
  'text-[hsl(var(--ds-ink))] placeholder:text-[hsl(var(--ds-ink-subtle))] ' +
  'focus:border-[hsl(var(--ds-primary))] focus:outline-none';

export default function WarehouseConfigForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  // The list is already cached by the list view; reusing it gives us the record
  // pager for free without a second round trip.
  const warehousesQuery = useWarehouses();
  const saveMut = useSaveWarehouse();

  const warehouses = useMemo(() => warehousesQuery.data ?? [], [warehousesQuery.data]);
  const current = useMemo(
    () => (isNew ? undefined : warehouses.find((w) => w.id === id)),
    [warehouses, id, isNew],
  );

  const [form, setForm] = useState<FormState>(EMPTY);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Load the record into the form once it arrives (and when navigating between
  // records with the pager).
  useEffect(() => {
    if (isNew) {
      setForm(EMPTY);
      return;
    }
    if (current) {
      setForm({
        name: current.name,
        code: current.code,
        address: current.address ?? '',
      });
    }
  }, [current, isNew]);

  const index = current ? warehouses.findIndex((w) => w.id === current.id) : -1;

  const goToIndex = (next: number) => {
    const target = warehouses[next];
    if (target) navigate(`${LIST_PATH}/${target.id}`);
  };

  const handleSave = () => {
    setValidationError(null);
    const name = form.name.trim();
    const code = form.code.trim();
    // Both are NOT NULL on `public.warehouses`; stop here rather than letting
    // Postgres reject the insert.
    if (!name || !code) {
      setValidationError('Warehouse name and Short Name are both required.');
      return;
    }

    // Only the three fields this form owns are sent. `warehouseToRow` skips
    // undefined keys, so the default_*_location_id columns are never written.
    const payload: Warehouse = {
      id: current?.id ?? '',
      name,
      code,
      address: form.address.trim(),
      isActive: current?.isActive ?? true,
    };

    saveMut.mutate(payload, {
      onSuccess: (saved) => navigate(`${LIST_PATH}/${saved.id}`),
      // Failures are surfaced by the global MutationCache toast and by the
      // inline banner below, which reads saveMut.error. Nothing is swallowed.
    });
  };

  const handleDiscard = () => {
    setValidationError(null);
    if (isNew) {
      navigate(LIST_PATH);
      return;
    }
    if (current) {
      setForm({
        name: current.name,
        code: current.code,
        address: current.address ?? '',
      });
    }
  };

  const notFound = !isNew && !current && !warehousesQuery.isLoading && !warehousesQuery.error;

  const leftFields: DocumentField[] = [
    {
      key: 'code',
      label: 'Short Name',
      value: (
        <input
          className={inputClass}
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
          placeholder="e.g. GLF101"
          aria-label="Short Name"
        />
      ),
    },
  ];

  const rightFields: DocumentField[] = [
    {
      key: 'address',
      label: 'Address',
      value: (
        <input
          className={inputClass}
          value={form.address}
          onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          placeholder="Street, city"
          aria-label="Address"
        />
      ),
    },
  ];

  const saveError = saveMut.error;
  const loadError = warehousesQuery.error;

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="ds-root bg-[hsl(var(--ds-canvas))] min-h-full p-4">
        <DocumentHeader
          breadcrumb={['Warehouses', isNew ? 'New' : current?.name ?? '…']}
          title={isNew ? 'New' : current?.name ?? '…'}
          actions={[
            {
              key: 'save',
              label: saveMut.isPending ? 'Saving…' : 'Save',
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
          // A warehouse has no workflow, so the status ribbon is empty by design.
          stages={[]}
          currentStage=""
          pager={
            index >= 0
              ? {
                  index: index + 1,
                  total: warehouses.length,
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
              Warehouse not found.
            </p>
          ) : (
            <>
              {/* Odoo's big title field — the record's name, edited in place. */}
              <div className="px-3 pt-3">
                <label htmlFor="wh-name" className="sr-only">
                  Warehouse Name
                </label>
                <input
                  id="wh-name"
                  className={
                    'w-full border-0 border-b border-transparent bg-transparent px-0 py-1 ' +
                    'text-[26px] font-semibold leading-tight text-[hsl(var(--ds-ink))] ' +
                    'placeholder:text-[hsl(var(--ds-ink-subtle))] ' +
                    'hover:border-[hsl(var(--ds-border))] ' +
                    'focus:border-[hsl(var(--ds-primary))] focus:outline-none'
                  }
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. GLF"
                />
              </div>

              <DocumentFields columns={[leftFields, rightFields]} />
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
