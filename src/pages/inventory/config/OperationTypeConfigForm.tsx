/**
 * Operation Type — form view (rebuilt on the design system).
 *
 * Three tabs matching the Odoo form: General / Hardware / Barcode App, with a
 * title-style Name field above them. Covers all 22 configurable columns.
 *
 * Writes `operation_types` only, through the existing service
 * (useSaveOperationType -> saveOperationType). Reads `warehouse_locations` for
 * the two location dropdowns and `operation_types` for the Returns Type
 * dropdown.
 *
 * SAVE: saveOperationType is sparse — it writes only the keys it is given, so
 * columns the caller omits are preserved. This form manages every configurable
 * column, so it submits the whole form state; the sparse behaviour is what
 * makes that safe rather than merely convenient, and it is why adding a column
 * later cannot be silently clobbered by this page. On create, name and
 * operationKind are required and the service's CREATE_DEFAULTS covers the rest.
 *
 * The legacy OperationTypesConfig panel at /inventory/setup/operation-types is
 * untouched and still routed.
 *
 * Route: /inventory/config/operation-types/:id, where :id === 'new' creates.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useOperationTypes, useSaveOperationType } from '@/hooks/inventory/config';
import { useLocationsQuery } from '@/hooks/inventory/useLocations';
import { useWarehouses } from '@/hooks/inventory';
import type {
  OperationType,
  OperationKind,
  BackorderPolicy,
} from '@/lib/services/inventory/operationTypes';
import {
  DocumentHeader,
  DocumentFields,
  DocumentTabs,
  SectionLabel,
  cn,
  type DocumentField,
  type DocumentTab,
} from '@/design-system';
import '@/design-system/tokens.css';
import { indexById, locationPath } from './locationPath';
import {
  BACKORDER_LABELS,
  BACKORDER_OPTIONS,
  CARD_COLOR_OPTIONS,
  DEFAULT_CARD_COLOR,
  OPERATION_KIND_LABELS,
  OPERATION_KIND_OPTIONS,
} from './operationTypeMeta';

const LIST_PATH = '/inventory/config/operation-types';

interface FormState {
  name: string;
  operationKind: OperationKind;
  sequencePrefix: string;
  barcode: string;
  returnsOperationTypeId: string;
  createBackorder: BackorderPolicy;
  cardColor: string;
  useExistingLots: boolean;
  createNewLots: boolean;
  defaultSourceLocationId: string;
  defaultDestLocationId: string;
  printDeliverySlip: boolean;
  printReturnSlip: boolean;
  printProductLabels: boolean;
  printLotSerialLabels: boolean;
  showReservedLots: boolean;
  mandatoryScanProduct: boolean;
  mandatoryScanLotSerial: boolean;
  mandatoryScanDestLocation: boolean;
  allowExtraProducts: boolean;
  allowFullPickingValidation: boolean;
  forceDestAllProducts: boolean;
}

/** The boolean-valued keys, so the checkbox helper needs no cast. */
type BooleanField = {
  [K in keyof FormState]: FormState[K] extends boolean ? K : never;
}[keyof FormState];

/** Mirrors the service's CREATE_DEFAULTS, which mirror the live column defaults. */
const EMPTY: FormState = {
  name: '',
  operationKind: 'receipt',
  sequencePrefix: '',
  barcode: '',
  returnsOperationTypeId: '',
  createBackorder: 'ask',
  cardColor: DEFAULT_CARD_COLOR,
  useExistingLots: true,
  createNewLots: true,
  defaultSourceLocationId: '',
  defaultDestLocationId: '',
  printDeliverySlip: false,
  printReturnSlip: false,
  printProductLabels: false,
  printLotSerialLabels: false,
  showReservedLots: true,
  mandatoryScanProduct: false,
  mandatoryScanLotSerial: false,
  mandatoryScanDestLocation: false,
  allowExtraProducts: true,
  allowFullPickingValidation: false,
  forceDestAllProducts: false,
};

function fromRecord(o: OperationType): FormState {
  return {
    name: o.name,
    operationKind: o.operationKind,
    sequencePrefix: o.sequencePrefix ?? '',
    barcode: o.barcode ?? '',
    returnsOperationTypeId: o.returnsOperationTypeId ?? '',
    createBackorder: o.createBackorder,
    cardColor: o.cardColor ?? DEFAULT_CARD_COLOR,
    useExistingLots: o.useExistingLots,
    createNewLots: o.createNewLots,
    defaultSourceLocationId: o.defaultSourceLocationId ?? '',
    defaultDestLocationId: o.defaultDestLocationId ?? '',
    printDeliverySlip: !!o.printDeliverySlip,
    printReturnSlip: !!o.printReturnSlip,
    printProductLabels: !!o.printProductLabels,
    printLotSerialLabels: !!o.printLotSerialLabels,
    showReservedLots: o.showReservedLots ?? true,
    mandatoryScanProduct: !!o.mandatoryScanProduct,
    mandatoryScanLotSerial: !!o.mandatoryScanLotSerial,
    mandatoryScanDestLocation: !!o.mandatoryScanDestLocation,
    allowExtraProducts: o.allowExtraProducts ?? true,
    allowFullPickingValidation: !!o.allowFullPickingValidation,
    forceDestAllProducts: !!o.forceDestAllProducts,
  };
}

const controlClass =
  'w-full rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))] ' +
  'bg-[hsl(var(--ds-surface))] px-2 py-[3px] text-[var(--ds-fs-sm)] ' +
  'text-[hsl(var(--ds-ink))] placeholder:text-[hsl(var(--ds-ink-subtle))] ' +
  'focus:border-[hsl(var(--ds-primary))] focus:outline-none';

export default function OperationTypeConfigForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const typesQuery = useOperationTypes();
  const locationsQuery = useLocationsQuery();
  const warehousesQuery = useWarehouses();
  const saveMut = useSaveOperationType();

  const types = useMemo(() => typesQuery.data ?? [], [typesQuery.data]);
  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const warehouses = useMemo(() => warehousesQuery.data ?? [], [warehousesQuery.data]);

  const current = useMemo(
    () => (isNew ? undefined : types.find((t) => t.id === id)),
    [types, id, isNew],
  );

  const [form, setForm] = useState<FormState>(EMPTY);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [tab, setTab] = useState('general');

  useEffect(() => {
    if (isNew) {
      setForm(EMPTY);
      return;
    }
    if (current) setForm(fromRecord(current));
  }, [current, isNew]);

  /** Locations by full tree path, so "GLF/STOCK/GODOWN" disambiguates names. */
  const locationOptions = useMemo(() => {
    const byId = indexById(locations);
    const warehousesById = indexById(warehouses);
    return locations
      .map((l) => ({ id: l.id, label: locationPath(l, byId, warehousesById) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [locations, warehouses]);

  /** An operation type may not be its own returns type. */
  const returnsOptions = useMemo(
    () => types.filter((t) => t.id !== current?.id).sort((a, b) => a.name.localeCompare(b.name)),
    [types, current],
  );

  const index = current ? types.findIndex((t) => t.id === current.id) : -1;
  const goToIndex = (next: number) => {
    const target = types[next];
    if (target) navigate(`${LIST_PATH}/${target.id}`);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = () => {
    setValidationError(null);
    const name = form.name.trim();
    if (!name) {
      setValidationError('Operation type name is required.');
      return;
    }
    // Belt and braces — returnsOptions already excludes self.
    if (current && form.returnsOperationTypeId === current.id) {
      setValidationError('An operation type cannot be its own returns type.');
      return;
    }

    saveMut.mutate(
      {
        ...(current ? { id: current.id } : {}),
        name,
        operationKind: form.operationKind,
        sequencePrefix: form.sequencePrefix.trim() || null,
        barcode: form.barcode.trim() || null,
        returnsOperationTypeId: form.returnsOperationTypeId || null,
        createBackorder: form.createBackorder,
        cardColor: form.cardColor,
        useExistingLots: form.useExistingLots,
        createNewLots: form.createNewLots,
        defaultSourceLocationId: form.defaultSourceLocationId || null,
        defaultDestLocationId: form.defaultDestLocationId || null,
        printDeliverySlip: form.printDeliverySlip,
        printReturnSlip: form.printReturnSlip,
        printProductLabels: form.printProductLabels,
        printLotSerialLabels: form.printLotSerialLabels,
        showReservedLots: form.showReservedLots,
        mandatoryScanProduct: form.mandatoryScanProduct,
        mandatoryScanLotSerial: form.mandatoryScanLotSerial,
        mandatoryScanDestLocation: form.mandatoryScanDestLocation,
        allowExtraProducts: form.allowExtraProducts,
        allowFullPickingValidation: form.allowFullPickingValidation,
        forceDestAllProducts: form.forceDestAllProducts,
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
  const loadError = typesQuery.error ?? locationsQuery.error ?? warehousesQuery.error;
  const notFound = !isNew && !current && !typesQuery.isLoading && !typesQuery.error;

  /** A labelled checkbox row, used across all three tabs. */
  const check = (key: BooleanField, label: string, hint?: string): DocumentField => ({
    key,
    label,
    value: (
      <span className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={form[key]}
          onChange={(e) => set(key, e.target.checked)}
          aria-label={label}
          className="mt-[3px]"
        />
        {hint && (
          <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">{hint}</span>
        )}
      </span>
    ),
  });

  // ---------------------------------------------------------------- General
  const generalLeft: DocumentField[] = [
    {
      key: 'kind',
      label: 'Type of Operation',
      value: (
        <select
          className={controlClass}
          value={form.operationKind}
          onChange={(e) => set('operationKind', e.target.value as OperationKind)}
          aria-label="Type of Operation"
        >
          {OPERATION_KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {OPERATION_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'prefix',
      label: 'Sequence Prefix',
      value: (
        <input
          className={controlClass}
          value={form.sequencePrefix}
          onChange={(e) => set('sequencePrefix', e.target.value)}
          placeholder="e.g. RCP"
          aria-label="Sequence Prefix"
        />
      ),
    },
    {
      key: 'barcode',
      label: 'Barcode',
      value: (
        <input
          className={controlClass}
          value={form.barcode}
          onChange={(e) => set('barcode', e.target.value)}
          placeholder="Scan or type"
          aria-label="Barcode"
        />
      ),
    },
  ];

  const generalRight: DocumentField[] = [
    {
      key: 'returns',
      label: 'Returns Type',
      value: (
        <select
          className={controlClass}
          value={form.returnsOperationTypeId}
          onChange={(e) => set('returnsOperationTypeId', e.target.value)}
          aria-label="Returns Type"
        >
          <option value="">— None —</option>
          {returnsOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'backorder',
      label: 'Create Backorder',
      value: (
        <select
          className={controlClass}
          value={form.createBackorder}
          onChange={(e) => set('createBackorder', e.target.value as BackorderPolicy)}
          aria-label="Create Backorder"
        >
          {BACKORDER_OPTIONS.map((b) => (
            <option key={b} value={b}>
              {BACKORDER_LABELS[b]}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'color',
      label: 'Card Color',
      value: (
        <span role="radiogroup" aria-label="Card Color" className="flex flex-wrap gap-1.5">
          {CARD_COLOR_OPTIONS.map((c) => {
            const active = form.cardColor === c.value;
            return (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={c.label}
                title={c.label}
                onClick={() => set('cardColor', c.value)}
                className={cn(
                  'h-[20px] w-[20px] rounded-full border-2 transition-transform',
                  active
                    ? 'border-[hsl(var(--ds-ink))] scale-110'
                    : 'border-[hsl(var(--ds-border))] hover:scale-105',
                )}
                style={{ background: c.swatch }}
              />
            );
          })}
        </span>
      ),
    },
  ];

  const locationField = (
    key: 'defaultSourceLocationId' | 'defaultDestLocationId',
    label: string,
  ): DocumentField => ({
    key,
    label,
    value: (
      <select
        className={controlClass}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        aria-label={label}
      >
        <option value="">— None —</option>
        {locationOptions.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    ),
  });

  const generalTab = (
    <div className="space-y-4">
      <DocumentFields columns={[generalLeft, generalRight]} className="px-0 py-0" />

      <div>
        <SectionLabel>Lots / Serial Numbers</SectionLabel>
        <DocumentFields
          className="px-0 py-0"
          columns={[
            [check('createNewLots', 'Create New', 'Generate new lot/serial numbers on validation')],
            [check('useExistingLots', 'Use Existing', 'Allow selecting existing lot/serial numbers')],
          ]}
        />
      </div>

      <div>
        <SectionLabel>Locations</SectionLabel>
        <DocumentFields
          className="px-0 py-0"
          columns={[
            [locationField('defaultSourceLocationId', 'Source Location')],
            [locationField('defaultDestLocationId', 'Destination Location')],
          ]}
        />
      </div>
    </div>
  );

  // --------------------------------------------------------------- Hardware
  const hardwareTab = (
    <div>
      <SectionLabel>Print on Validation</SectionLabel>
      <DocumentFields
        className="px-0 py-0"
        columns={[
          [check('printDeliverySlip', 'Delivery Slip'), check('printReturnSlip', 'Return Slip')],
          [
            check('printProductLabels', 'Product Labels'),
            check('printLotSerialLabels', 'Lot/SN Labels'),
          ],
        ]}
      />
    </div>
  );

  // ------------------------------------------------------------ Barcode App
  const barcodeTab = (
    <div className="space-y-4">
      <DocumentFields
        className="px-0 py-0"
        columns={[[check('showReservedLots', 'Show reserved lots/SN')]]}
      />

      <div>
        <SectionLabel>Mandatory Scan</SectionLabel>
        <DocumentFields
          className="px-0 py-0"
          columns={[
            [
              check('mandatoryScanProduct', 'Product'),
              check('mandatoryScanLotSerial', 'Lot/Serial'),
            ],
            [check('mandatoryScanDestLocation', 'Destination Location')],
          ]}
        />
      </div>

      <div>
        <SectionLabel>Options</SectionLabel>
        <DocumentFields
          className="px-0 py-0"
          columns={[[check('allowExtraProducts', 'Allow extra products')]]}
        />
      </div>

      <div>
        <SectionLabel>Final Validation</SectionLabel>
        <DocumentFields
          className="px-0 py-0"
          columns={[
            [check('allowFullPickingValidation', 'Allow full picking validation')],
            [check('forceDestAllProducts', 'Force a destination for all products')],
          ]}
        />
      </div>
    </div>
  );

  const tabs: DocumentTab[] = [
    { key: 'general', label: 'General', content: generalTab },
    { key: 'hardware', label: 'Hardware', content: hardwareTab },
    { key: 'barcode', label: 'Barcode App', content: barcodeTab },
  ];

  const headerTitle = isNew ? 'New' : current?.name ?? '…';

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="ds-root bg-[hsl(var(--ds-canvas))] min-h-full p-4">
        <DocumentHeader
          breadcrumb={['Operation Types', headerTitle]}
          title={headerTitle}
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
          // An operation type has no workflow, so the ribbon is empty by design.
          stages={[]}
          currentStage=""
          pager={
            index >= 0
              ? {
                  index: index + 1,
                  total: types.length,
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
              Operation type not found.
            </p>
          ) : (
            <>
              <div className="px-3 pt-3">
                <label htmlFor="ot-name" className="sr-only">
                  Operation Type Name
                </label>
                <input
                  id="ot-name"
                  className={
                    'w-full border-0 border-b border-transparent bg-transparent px-0 py-1 ' +
                    'text-[26px] font-semibold leading-tight text-[hsl(var(--ds-ink))] ' +
                    'placeholder:text-[hsl(var(--ds-ink-subtle))] ' +
                    'hover:border-[hsl(var(--ds-border))] ' +
                    'focus:border-[hsl(var(--ds-primary))] focus:outline-none'
                  }
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. GOODS RECEIVED"
                />
              </div>

              <DocumentTabs tabs={tabs} value={tab} onValueChange={setTab} />
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
