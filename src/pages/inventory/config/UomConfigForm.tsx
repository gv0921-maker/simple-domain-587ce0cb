/**
 * Unit of Measure — form view (rebuilt on the design system).
 *
 * Fields are the real columns: name (UNIQUE), abbreviation, uom_type
 * (CHECK reference|bigger|smaller|unit), ratio, is_active. No category field —
 * this database has no uom category table, and inventing one would be fiction.
 *
 * ⚠ CLOBBER GUARD. `saveUnitOfMeasure` builds a COMPLETE payload with
 * `?? default` on every column, so an update omitting a field overwrites it —
 * uomType would reset to 'unit' and ratio to 1, which would silently break
 * Dozen (ratio 12) and Pair (ratio 2). Every field is submitted explicitly from
 * loaded state.
 *
 * Route: /inventory/config/uom/:id, where :id === 'new' creates.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useUnitsOfMeasure, useSaveUnitOfMeasure } from '@/hooks/inventory/config';
import type { UnitOfMeasure, UomType } from '@/lib/services/inventory/unitsOfMeasure';
import { DocumentHeader, DocumentFields, type DocumentField } from '@/design-system';
import '@/design-system/tokens.css';
import { UOM_TYPE_LABELS, UOM_TYPE_OPTIONS } from './configMeta';

const LIST_PATH = '/inventory/config/uom';

const controlClass =
  'w-full rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))] ' +
  'bg-[hsl(var(--ds-surface))] px-2 py-[3px] text-[var(--ds-fs-sm)] ' +
  'text-[hsl(var(--ds-ink))] placeholder:text-[hsl(var(--ds-ink-subtle))] ' +
  'focus:border-[hsl(var(--ds-primary))] focus:outline-none';

interface FormState {
  name: string;
  abbreviation: string;
  uomType: UomType;
  ratio: number;
  isActive: boolean;
}

const EMPTY: FormState = {
  name: '',
  abbreviation: '',
  uomType: 'unit',
  ratio: 1,
  isActive: true,
};

function fromRecord(u: UnitOfMeasure): FormState {
  return {
    name: u.name,
    abbreviation: u.abbreviation,
    uomType: u.uomType,
    ratio: u.ratio,
    isActive: u.isActive,
  };
}

export default function UomConfigForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const query = useUnitsOfMeasure();
  const saveMut = useSaveUnitOfMeasure();

  const units = useMemo(() => query.data ?? [], [query.data]);
  const current = useMemo(
    () => (isNew ? undefined : units.find((u) => u.id === id)),
    [units, id, isNew],
  );

  const [form, setForm] = useState<FormState>(EMPTY);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) {
      setForm(EMPTY);
      return;
    }
    if (current) setForm(fromRecord(current));
  }, [current, isNew]);

  const index = current ? units.findIndex((u) => u.id === current.id) : -1;
  const goToIndex = (next: number) => {
    const target = units[next];
    if (target) navigate(`${LIST_PATH}/${target.id}`);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = () => {
    setValidationError(null);
    const name = form.name.trim();
    const abbreviation = form.abbreviation.trim();
    if (!name) {
      setValidationError('Unit name is required.');
      return;
    }
    if (!abbreviation) {
      setValidationError('Symbol is required.');
      return;
    }
    if (!(form.ratio > 0)) {
      setValidationError('Ratio must be greater than zero.');
      return;
    }
    // `name` is UNIQUE — catch the collision before Postgres does, for a
    // friendlier message. The database remains the real guard.
    if (units.some((u) => u.id !== current?.id && u.name.toLowerCase() === name.toLowerCase())) {
      setValidationError(`A unit named "${name}" already exists.`);
      return;
    }

    saveMut.mutate(
      {
        ...(current ? { id: current.id } : {}),
        name,
        abbreviation,
        uomType: form.uomType,
        ratio: Number(form.ratio),
        isActive: form.isActive,
      },
      { onSuccess: (saved) => navigate(`${LIST_PATH}/${saved.id}`) },
    );
  };

  const handleDiscard = () => {
    setValidationError(null);
    if (isNew) {
      navigate(LIST_PATH);
      return;
    }
    if (current) setForm(fromRecord(current));
  };

  const saveError = saveMut.error;
  const loadError = query.error;
  const notFound = !isNew && !current && !query.isLoading && !query.error;

  const left: DocumentField[] = [
    {
      key: 'abbreviation',
      label: 'Symbol',
      value: (
        <input
          className={controlClass}
          value={form.abbreviation}
          onChange={(e) => set('abbreviation', e.target.value)}
          placeholder="e.g. pc"
          aria-label="Symbol"
        />
      ),
    },
    {
      key: 'uomType',
      label: 'Type',
      value: (
        <select
          className={controlClass}
          value={form.uomType}
          onChange={(e) => set('uomType', e.target.value as UomType)}
          aria-label="Type"
        >
          {UOM_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {UOM_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      ),
    },
  ];

  const right: DocumentField[] = [
    {
      key: 'ratio',
      label: 'Ratio',
      value: (
        <span className="flex flex-col gap-0.5">
          <input
            type="number"
            step="0.0001"
            min="0"
            className={controlClass}
            value={form.ratio}
            onChange={(e) => set('ratio', Number(e.target.value))}
            aria-label="Ratio"
          />
          <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
            Relative to the reference unit — e.g. Dozen is 12.
          </span>
        </span>
      ),
    },
    {
      key: 'isActive',
      label: 'Active',
      value: (
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => set('isActive', e.target.checked)}
          aria-label="Active"
        />
      ),
    },
  ];

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="ds-root bg-[hsl(var(--ds-canvas))] min-h-full p-4">
        <DocumentHeader
          breadcrumb={['Units of Measure', isNew ? 'New' : current?.name ?? '…']}
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
          stages={[]}
          currentStage=""
          pager={
            index >= 0
              ? {
                  index: index + 1,
                  total: units.length,
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
              Unit not found.
            </p>
          ) : (
            <>
              <div className="px-3 pt-3">
                <label htmlFor="uom-name" className="sr-only">
                  Unit Name
                </label>
                <input
                  id="uom-name"
                  className={
                    'w-full border-0 border-b border-transparent bg-transparent px-0 py-1 ' +
                    'text-[26px] font-semibold leading-tight text-[hsl(var(--ds-ink))] ' +
                    'placeholder:text-[hsl(var(--ds-ink-subtle))] ' +
                    'hover:border-[hsl(var(--ds-border))] ' +
                    'focus:border-[hsl(var(--ds-primary))] focus:outline-none'
                  }
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Dozen"
                />
              </div>
              <DocumentFields columns={[left, right]} />
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
