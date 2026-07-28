/**
 * Location — form view (rebuilt on the design system).
 *
 * Core fields only: Name, Parent Location, Location Type, Barcode, Removal
 * Strategy. Cyclic-counting (cyclic_count_frequency_days, last_count_date,
 * next_count_date) and aisle/shelf/bin are deliberately NOT edited here — and
 * because `locationToRow` only emits keys that are `!== undefined`, they are
 * never included in the UPDATE statement, so they survive a save untouched.
 *
 * `code` is read-only on existing locations. Four live RPCs resolve locations
 * by literal code string — complete_gr_line_qc and record_gr_item_qc ('VDR106'),
 * complete_delivery_with_qc ('CTMR107') and complete_ito_with_qc ('CRT111') —
 * so re-coding an existing location would silently break document routing. A
 * brand-new location is referenced by nothing, so a code may be entered there.
 *
 * Writes through the same data layer as the legacy WarehouseLocations page:
 * `useCreateLocation` / `useUpdateLocation` -> `createLocation` /
 * `updateLocation` -> `saveLocationAsync`.
 *
 * Route: /inventory/config/locations/:id, where :id === 'new' creates.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useLocationsQuery, useCreateLocation, useUpdateLocation } from '@/hooks/inventory/useLocations';
import { useWarehouses } from '@/hooks/inventory';
import type { Location, LocationType } from '@/lib/services/inventory';
import { DocumentHeader, DocumentFields, type DocumentField } from '@/design-system';
import '@/design-system/tokens.css';
import {
  descendantIdsOf,
  indexById,
  locationPath,
  LOCATION_TYPE_LABELS,
  LOCATION_TYPE_OPTIONS,
  REMOVAL_STRATEGY_LABELS,
  REMOVAL_STRATEGY_OPTIONS,
} from './locationPath';

const LIST_PATH = '/inventory/config/locations';

type RemovalStrategy = NonNullable<Location['removalStrategy']>;

interface FormState {
  name: string;
  code: string;
  parentId: string;
  warehouseId: string;
  type: LocationType;
  barcode: string;
  removalStrategy: RemovalStrategy;
}

const EMPTY: FormState = {
  name: '',
  code: '',
  parentId: '',
  warehouseId: '',
  type: 'internal',
  barcode: '',
  removalStrategy: 'fifo',
};

const controlClass =
  'w-full rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))] ' +
  'bg-[hsl(var(--ds-surface))] px-2 py-[3px] text-[var(--ds-fs-sm)] ' +
  'text-[hsl(var(--ds-ink))] placeholder:text-[hsl(var(--ds-ink-subtle))] ' +
  'focus:border-[hsl(var(--ds-primary))] focus:outline-none';

/** Matches the suggestion the legacy migration used for missing codes. */
function suggestCode(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, '-').slice(0, 20);
}

export default function LocationConfigForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const locationsQuery = useLocationsQuery();
  const warehousesQuery = useWarehouses();
  const createMut = useCreateLocation();
  const updateMut = useUpdateLocation();

  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const warehouses = useMemo(() => warehousesQuery.data ?? [], [warehousesQuery.data]);
  const byId = useMemo(() => indexById(locations), [locations]);
  const warehousesById = useMemo(() => indexById(warehouses), [warehouses]);

  const current = useMemo(
    () => (isNew ? undefined : locations.find((l) => l.id === id)),
    [locations, id, isNew],
  );

  const [form, setForm] = useState<FormState>(EMPTY);
  const [codeTouched, setCodeTouched] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) {
      setForm(EMPTY);
      setCodeTouched(false);
      return;
    }
    if (current) {
      setForm({
        name: current.name,
        code: current.code,
        parentId: current.parentId ?? '',
        warehouseId: current.warehouseId,
        type: current.type,
        barcode: current.barcode ?? '',
        removalStrategy: current.removalStrategy ?? 'fifo',
      });
    }
  }, [current, isNew]);

  // A location may not be its own parent, nor be reparented under one of its
  // own descendants — the database would accept either and orphan the subtree.
  const blockedParentIds = useMemo(
    () => (current ? descendantIdsOf(current.id, locations) : new Set<string>()),
    [current, locations],
  );

  const parentOptions = useMemo(
    () =>
      locations
        .filter((l) => !blockedParentIds.has(l.id))
        .map((l) => ({ id: l.id, path: locationPath(l, byId, warehousesById) }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [locations, blockedParentIds, byId, warehousesById],
  );

  const index = current ? locations.findIndex((l) => l.id === current.id) : -1;

  const goToIndex = (next: number) => {
    const target = locations[next];
    if (target) navigate(`${LIST_PATH}/${target.id}`);
  };

  /** Selecting a parent pins the warehouse — a child lives in its parent's tree. */
  const handleParentChange = (parentId: string) => {
    const parent = parentId ? byId.get(parentId) : undefined;
    setForm((f) => ({
      ...f,
      parentId,
      warehouseId: parent ? parent.warehouseId : f.warehouseId,
    }));
  };

  const handleNameChange = (name: string) => {
    setForm((f) => ({
      ...f,
      name,
      // Only auto-fill the code on new records the user hasn't typed a code into.
      code: isNew && !codeTouched ? suggestCode(name) : f.code,
    }));
  };

  const handleSave = () => {
    setValidationError(null);
    const name = form.name.trim();
    const code = form.code.trim();

    if (!name) {
      setValidationError('Location name is required.');
      return;
    }

    if (isNew) {
      // warehouse_id and code are both NOT NULL on public.warehouse_locations.
      if (!code) {
        setValidationError('A code is required for a new location.');
        return;
      }
      if (!form.warehouseId) {
        setValidationError(
          'Select a warehouse, or pick a parent location to inherit its warehouse.',
        );
        return;
      }
      createMut.mutate(
        {
          name,
          code,
          warehouseId: form.warehouseId,
          parentId: form.parentId || undefined,
          type: form.type,
          isActive: true,
          barcode: form.barcode.trim() || undefined,
          removalStrategy: form.removalStrategy,
        },
        { onSuccess: (saved) => navigate(`${LIST_PATH}/${saved.id}`) },
      );
      return;
    }

    if (!current) return;
    // Only the fields this form owns. `code`, `warehouseId`, `isActive`, the
    // cyclic-count columns and aisle/shelf/bin are absent from the patch and so
    // are absent from the UPDATE.
    updateMut.mutate(
      {
        id: current.id,
        patch: {
          name,
          parentId: form.parentId,
          type: form.type,
          barcode: form.barcode.trim(),
          removalStrategy: form.removalStrategy,
        },
      },
      { onSuccess: () => navigate(`${LIST_PATH}/${current.id}`) },
    );
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
        parentId: current.parentId ?? '',
        warehouseId: current.warehouseId,
        type: current.type,
        barcode: current.barcode ?? '',
        removalStrategy: current.removalStrategy ?? 'fifo',
      });
    }
  };

  const saving = createMut.isPending || updateMut.isPending;
  const saveError = createMut.error ?? updateMut.error;
  const loadError = locationsQuery.error ?? warehousesQuery.error;
  const notFound = !isNew && !current && !locationsQuery.isLoading && !locationsQuery.error;

  const leftFields: DocumentField[] = [
    {
      key: 'parent',
      label: 'Parent Location',
      value: (
        <select
          className={controlClass}
          value={form.parentId}
          onChange={(e) => handleParentChange(e.target.value)}
          aria-label="Parent Location"
        >
          <option value="">— None (directly under warehouse) —</option>
          {parentOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.path}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'type',
      label: 'Location Type',
      value: (
        <select
          className={controlClass}
          value={form.type}
          onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as LocationType }))}
          aria-label="Location Type"
        >
          {LOCATION_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {LOCATION_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'code',
      label: 'Code',
      value: isNew ? (
        <input
          className={controlClass}
          value={form.code}
          onChange={(e) => {
            setCodeTouched(true);
            setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }));
          }}
          placeholder="e.g. SHOWROOM-114"
          aria-label="Code"
        />
      ) : (
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-[hsl(var(--ds-ink))]">{form.code}</span>
          <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
            Fixed — system routing looks this location up by code. Renaming is safe;
            re-coding is not.
          </span>
        </span>
      ),
    },
  ];

  const rightFields: DocumentField[] = [
    {
      key: 'barcode',
      label: 'Barcode',
      value: (
        <input
          className={controlClass}
          value={form.barcode}
          onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
          placeholder="Scanned barcode"
          aria-label="Barcode"
        />
      ),
    },
    {
      key: 'removal',
      label: 'Removal Strategy',
      value: (
        <select
          className={controlClass}
          value={form.removalStrategy}
          onChange={(e) =>
            setForm((f) => ({ ...f, removalStrategy: e.target.value as RemovalStrategy }))
          }
          aria-label="Removal Strategy"
        >
          {REMOVAL_STRATEGY_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {REMOVAL_STRATEGY_LABELS[s]}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
      value: isNew ? (
        <select
          className={controlClass}
          value={form.warehouseId}
          onChange={(e) => setForm((f) => ({ ...f, warehouseId: e.target.value }))}
          disabled={!!form.parentId}
          aria-label="Warehouse"
        >
          <option value="">— Select —</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-[hsl(var(--ds-ink))]">
          {warehousesById.get(form.warehouseId)?.name ?? '—'}
        </span>
      ),
      muted: false,
    },
  ];

  const headerTitle = isNew ? 'New' : current?.name ?? '…';

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="ds-root bg-[hsl(var(--ds-canvas))] min-h-full p-4">
        <DocumentHeader
          breadcrumb={['Locations', headerTitle]}
          title={
            current ? locationPath(current, byId, warehousesById) : headerTitle
          }
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
          // A location has no workflow, so the status ribbon is empty by design.
          stages={[]}
          currentStage=""
          pager={
            index >= 0
              ? {
                  index: index + 1,
                  total: locations.length,
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
              Location not found.
            </p>
          ) : (
            <>
              <div className="px-3 pt-3">
                <label htmlFor="loc-name" className="sr-only">
                  Location Name
                </label>
                <input
                  id="loc-name"
                  className={
                    'w-full border-0 border-b border-transparent bg-transparent px-0 py-1 ' +
                    'text-[26px] font-semibold leading-tight text-[hsl(var(--ds-ink))] ' +
                    'placeholder:text-[hsl(var(--ds-ink-subtle))] ' +
                    'hover:border-[hsl(var(--ds-border))] ' +
                    'focus:border-[hsl(var(--ds-primary))] focus:outline-none'
                  }
                  value={form.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. SHOWROOM"
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
