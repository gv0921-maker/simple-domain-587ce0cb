/**
 * Product Attribute — form view (rebuilt on the design system).
 *
 * Attribute header fields plus a child list of its values, the classic
 * attribute → values shape:
 *
 *   product_attributes         name (UNIQUE), display_type (CHECK), is_active, sort_order
 *   product_attribute_values   value, extra_price, color_hex, sort_order
 *                              FK attribute_id ON DELETE CASCADE
 *
 * ⚠ CLOBBER GUARD — this one matters, because the data is real. Both
 * `saveAttribute` and `saveAttributeValue` build COMPLETE payloads with
 * `?? default`, so an update omitting a field overwrites it. Saving an attribute
 * without displayType would reset Colour from `color` to `radio`; saving a value
 * without colorHex would null hexes that are populated today (#111111, #8B4513,
 * …). Every field is therefore submitted explicitly from loaded state.
 *
 * Values are saved one row at a time because that is what the existing service
 * offers — there is no bulk upsert. A value is only written when it actually
 * changed, so an untouched row is never rewritten.
 *
 * Note `product_attribute_values` has NO unique constraint on
 * (attribute_id, value), so duplicates are possible; the form warns rather than
 * silently allowing them.
 *
 * Route: /inventory/config/attributes/:id, where :id === 'new' creates.
 * A new attribute must be saved before values can be added — they need its id.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import {
  useProductAttributes,
  useSaveProductAttribute,
  useSaveProductAttributeValue,
  useDeleteProductAttributeValue,
} from '@/hooks/inventory/config';
import type {
  AttributeDisplayType,
  ProductAttribute,
  ProductAttributeValue,
} from '@/lib/services/inventory/attributes';
import {
  DocumentHeader,
  DocumentFields,
  SectionLabel,
  Button,
  type DocumentField,
} from '@/design-system';
import '@/design-system/tokens.css';
import { DISPLAY_TYPE_LABELS, DISPLAY_TYPE_OPTIONS } from './configMeta';

const LIST_PATH = '/inventory/config/attributes';

const controlClass =
  'w-full rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))] ' +
  'bg-[hsl(var(--ds-surface))] px-2 py-[3px] text-[var(--ds-fs-sm)] ' +
  'text-[hsl(var(--ds-ink))] placeholder:text-[hsl(var(--ds-ink-subtle))] ' +
  'focus:border-[hsl(var(--ds-primary))] focus:outline-none';

interface HeaderState {
  name: string;
  displayType: AttributeDisplayType;
  sortOrder: number;
  isActive: boolean;
}

/** A value row being edited. `id` absent means it has not been created yet. */
interface ValueRow {
  key: string;
  id?: string;
  value: string;
  extraPrice: number;
  colorHex: string;
  sortOrder: number;
}

const EMPTY_HEADER: HeaderState = {
  name: '',
  displayType: 'radio',
  sortOrder: 0,
  isActive: true,
};

function valueRowsFrom(attr: ProductAttribute): ValueRow[] {
  return (attr.values ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value))
    .map((v) => ({
      key: v.id,
      id: v.id,
      value: v.value,
      extraPrice: v.extraPrice,
      colorHex: v.colorHex ?? '',
      sortOrder: v.sortOrder,
    }));
}

function isUnchanged(row: ValueRow, original: ProductAttributeValue): boolean {
  return (
    row.value === original.value &&
    row.extraPrice === original.extraPrice &&
    row.colorHex === (original.colorHex ?? '') &&
    row.sortOrder === original.sortOrder
  );
}

export default function AttributeConfigForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const query = useProductAttributes();
  const saveAttrMut = useSaveProductAttribute();
  const saveValMut = useSaveProductAttributeValue();
  const deleteValMut = useDeleteProductAttributeValue();

  const attributes = useMemo(() => query.data ?? [], [query.data]);
  const current = useMemo(
    () => (isNew ? undefined : attributes.find((a) => a.id === id)),
    [attributes, id, isNew],
  );

  const [header, setHeader] = useState<HeaderState>(EMPTY_HEADER);
  const [rows, setRows] = useState<ValueRow[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) {
      setHeader(EMPTY_HEADER);
      setRows([]);
      setRemovedIds([]);
      return;
    }
    if (current) {
      setHeader({
        name: current.name,
        displayType: current.displayType,
        sortOrder: current.sortOrder,
        isActive: current.isActive,
      });
      setRows(valueRowsFrom(current));
      setRemovedIds([]);
    }
  }, [current, isNew]);

  const index = current ? attributes.findIndex((a) => a.id === current.id) : -1;
  const goToIndex = (next: number) => {
    const target = attributes[next];
    if (target) navigate(`${LIST_PATH}/${target.id}`);
  };

  const setField = <K extends keyof HeaderState>(key: K, value: HeaderState[K]) =>
    setHeader((h) => ({ ...h, [key]: value }));

  const setRow = <K extends keyof ValueRow>(key: string, field: K, value: ValueRow[K]) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  const addRow = () =>
    setRows((rs) => [
      ...rs,
      {
        key: `new-${Date.now()}-${rs.length}`,
        value: '',
        extraPrice: 0,
        colorHex: '',
        sortOrder: (rs.at(-1)?.sortOrder ?? 0) + 10,
      },
    ]);

  const removeRow = (key: string) =>
    setRows((rs) => {
      const row = rs.find((r) => r.key === key);
      if (row?.id) setRemovedIds((ids) => [...ids, row.id!]);
      return rs.filter((r) => r.key !== key);
    });

  const handleSave = async () => {
    setValidationError(null);
    const name = header.name.trim();
    if (!name) {
      setValidationError('Attribute name is required.');
      return;
    }
    const trimmed = rows.map((r) => ({ ...r, value: r.value.trim() }));
    if (trimmed.some((r) => !r.value)) {
      setValidationError('Every value needs a name. Remove blank rows or fill them in.');
      return;
    }
    const seen = new Set<string>();
    for (const r of trimmed) {
      const k = r.value.toLowerCase();
      if (seen.has(k)) {
        setValidationError(
          `Duplicate value "${r.value}". The database would accept it, but it makes the attribute ambiguous.`,
        );
        return;
      }
      seen.add(k);
    }

    try {
      // Header first — a new attribute needs an id before its values exist.
      const saved = await saveAttrMut.mutateAsync({
        ...(current ? { id: current.id } : {}),
        name,
        displayType: header.displayType,
        sortOrder: Math.floor(header.sortOrder) || 0,
        isActive: header.isActive,
      });

      for (const gone of removedIds) {
        await deleteValMut.mutateAsync(gone);
      }

      const originals = new Map((current?.values ?? []).map((v) => [v.id, v]));
      for (const row of trimmed) {
        const original = row.id ? originals.get(row.id) : undefined;
        // Skip rows that did not change, so untouched values are never rewritten.
        if (original && isUnchanged(row, original)) continue;
        await saveValMut.mutateAsync({
          ...(row.id ? { id: row.id } : {}),
          attributeId: saved.id,
          value: row.value,
          extraPrice: Number(row.extraPrice) || 0,
          colorHex: row.colorHex.trim() || null,
          sortOrder: Math.floor(row.sortOrder) || 0,
        });
      }

      navigate(`${LIST_PATH}/${saved.id}`);
    } catch {
      // Surfaced by the inline banner and the global mutation toast.
    }
  };

  const handleDiscard = () => {
    setValidationError(null);
    if (isNew) {
      navigate(LIST_PATH);
      return;
    }
    if (current) {
      setHeader({
        name: current.name,
        displayType: current.displayType,
        sortOrder: current.sortOrder,
        isActive: current.isActive,
      });
      setRows(valueRowsFrom(current));
      setRemovedIds([]);
    }
  };

  const saving = saveAttrMut.isPending || saveValMut.isPending || deleteValMut.isPending;
  const saveError = saveAttrMut.error ?? saveValMut.error ?? deleteValMut.error;
  const loadError = query.error;
  const notFound = !isNew && !current && !query.isLoading && !query.error;
  const showColour = header.displayType === 'color';

  const left: DocumentField[] = [
    {
      key: 'displayType',
      label: 'Display Type',
      value: (
        <select
          className={controlClass}
          value={header.displayType}
          onChange={(e) => setField('displayType', e.target.value as AttributeDisplayType)}
          aria-label="Display Type"
        >
          {DISPLAY_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {DISPLAY_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      ),
    },
  ];

  const right: DocumentField[] = [
    {
      key: 'sortOrder',
      label: 'Sort Order',
      value: (
        <input
          type="number"
          step={1}
          className={controlClass}
          value={header.sortOrder}
          onChange={(e) => setField('sortOrder', Number(e.target.value))}
          aria-label="Sort Order"
        />
      ),
    },
    {
      key: 'isActive',
      label: 'Active',
      value: (
        <input
          type="checkbox"
          checked={header.isActive}
          onChange={(e) => setField('isActive', e.target.checked)}
          aria-label="Active"
        />
      ),
    },
  ];

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="ds-root bg-[hsl(var(--ds-canvas))] min-h-full p-4">
        <DocumentHeader
          breadcrumb={['Product Attributes', isNew ? 'New' : current?.name ?? '…']}
          title={isNew ? 'New' : current?.name ?? '…'}
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
          stages={[]}
          currentStage=""
          pager={
            index >= 0
              ? {
                  index: index + 1,
                  total: attributes.length,
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
              Attribute not found.
            </p>
          ) : (
            <>
              <div className="px-3 pt-3">
                <label htmlFor="attr-name" className="sr-only">
                  Attribute Name
                </label>
                <input
                  id="attr-name"
                  className={
                    'w-full border-0 border-b border-transparent bg-transparent px-0 py-1 ' +
                    'text-[26px] font-semibold leading-tight text-[hsl(var(--ds-ink))] ' +
                    'placeholder:text-[hsl(var(--ds-ink-subtle))] ' +
                    'hover:border-[hsl(var(--ds-border))] ' +
                    'focus:border-[hsl(var(--ds-primary))] focus:outline-none'
                  }
                  value={header.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="e.g. Wood Finish"
                />
              </div>

              <DocumentFields columns={[left, right]} />

              <div className="border-t border-[hsl(var(--ds-border))] p-3">
                <div className="flex items-center justify-between gap-3">
                  <SectionLabel>Values</SectionLabel>
                  <Button size="sm" variant="outline" onClick={addRow}>
                    Add value
                  </Button>
                </div>

                <div className="ds-scroll-x mt-2">
                  <table className="w-full min-w-[520px] border-collapse text-[var(--ds-fs-sm)]">
                    <thead>
                      <tr className="bg-[hsl(var(--ds-surface-alt))]">
                        {['Value', 'Extra Price', ...(showColour ? ['Colour'] : []), 'Sort', ''].map(
                          (h) => (
                            <th
                              key={h}
                              scope="col"
                              className="border-b border-[hsl(var(--ds-border))] px-2 py-1.5 text-left text-[var(--ds-fs-xs)] font-semibold uppercase tracking-wide text-[hsl(var(--ds-ink-subtle))]"
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.key}
                          className="border-b border-[hsl(var(--ds-border)/0.6)]"
                          style={{ height: 'var(--ds-row-h)' }}
                        >
                          <td className="px-2 py-1">
                            <input
                              className={controlClass}
                              value={r.value}
                              onChange={(e) => setRow(r.key, 'value', e.target.value)}
                              placeholder="e.g. Teak"
                              aria-label="Value"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              type="number"
                              step="0.01"
                              className={controlClass}
                              value={r.extraPrice}
                              onChange={(e) =>
                                setRow(r.key, 'extraPrice', Number(e.target.value))
                              }
                              aria-label="Extra Price"
                            />
                          </td>
                          {showColour && (
                            <td className="px-2 py-1">
                              <span className="flex items-center gap-1.5">
                                <input
                                  type="color"
                                  value={/^#[0-9a-fA-F]{6}$/.test(r.colorHex) ? r.colorHex : '#cccccc'}
                                  onChange={(e) => setRow(r.key, 'colorHex', e.target.value)}
                                  aria-label="Colour swatch"
                                  className="h-[24px] w-[28px] shrink-0 cursor-pointer border border-[hsl(var(--ds-border-strong))] bg-transparent"
                                />
                                <input
                                  className={controlClass}
                                  value={r.colorHex}
                                  onChange={(e) => setRow(r.key, 'colorHex', e.target.value)}
                                  placeholder="#8B4513"
                                  aria-label="Colour hex"
                                />
                              </span>
                            </td>
                          )}
                          <td className="px-2 py-1">
                            <input
                              type="number"
                              step={1}
                              className={controlClass}
                              value={r.sortOrder}
                              onChange={(e) => setRow(r.key, 'sortOrder', Number(e.target.value))}
                              aria-label="Sort"
                            />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => removeRow(r.key)}
                              aria-label={`Remove ${r.value || 'value'}`}
                            >
                              Remove
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr>
                          <td
                            colSpan={showColour ? 5 : 4}
                            className="px-3 py-8 text-center text-[hsl(var(--ds-ink-subtle))]"
                          >
                            No values yet — use “Add value”.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <p className="mt-2 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                  Removing a value deletes it on save. Values are stored per attribute and
                  cascade if the attribute itself is deleted.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
