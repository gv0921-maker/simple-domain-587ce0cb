/**
 * Inventory 2 — the shared variant creator/editor. Pass 10C.
 *
 * ONE COMPONENT, THREE SURFACES:
 *   /inventory2/config/variants   full management — any product, creates permanent
 *   product form → Attributes & Variants  one product fixed, creates permanent
 *   Sales order/quotation line    one product fixed, creates PROVISIONAL
 *
 * `createStatus` is a REQUIRED prop with no default. That is the whole point of
 * the shared core: a surface cannot create the wrong kind of variant by
 * forgetting to pass something. Sales passes 'provisional'; the two inventory
 * surfaces pass 'permanent'.
 *
 * `canEdit` gates the header fields, not the combination. Sales may bring a
 * version into existence when a customer asks for one, but may not price or
 * rename it — that is inventory's call, and RLS enforces the same split
 * (product_variants_insert_write admits sales_rep; _update_inv does not).
 *
 * The combination is chosen on create and never edited afterwards. Changing
 * which values a variant stands for would silently redefine every document that
 * already references it; the replacement is a new variant and archiving the old
 * one, which is what the database's immutable combo_key already pushes you
 * toward.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, StatusPill, cn } from '@/design-system';
import { Field, TextInput, SelectInput, ErrorBanner } from './formControls';
import { errorText } from '@/lib/inventory2/errorText';
import { useCreateVariant, useUpdateVariant } from '@/hooks/inventory2/variants';
import type {
  AssignedAttributes, VariantRecord, VariantStatus,
} from '@/lib/services/inventory2/variants';

export interface VariantEditorProps {
  productId: string;
  productName?: string | null;
  /**
   * The candidate space: the attributes assigned to this product AND the values
   * its category allows. `undefined` means still loading — distinct from a
   * loaded scope that is empty, which is a real answer with a reason to show.
   */
  scope: AssignedAttributes | undefined;
  /** Existing variants of this product, for the duplicate pre-check. */
  existing: VariantRecord[];
  /** REQUIRED, never defaulted. See the header. */
  createStatus: VariantStatus;
  /** Whether the caller may set SKU, name, barcode and prices. */
  canEdit: boolean;
  /** Editing an existing variant. Omit to create. */
  variant?: VariantRecord;
  onDone: (variant?: VariantRecord) => void;
  onCancel: () => void;
}

/** Suggested name: "Product (Large, Walnut)" — the Odoo convention. */
function suggestName(productName: string | null | undefined, chosen: string[]): string {
  const base = (productName ?? 'Variant').trim();
  return chosen.length ? `${base} (${chosen.join(', ')})` : base;
}

/** Suggested SKU fragment from the chosen values, uppercased and hyphenated. */
function suggestSkuSuffix(chosen: string[]): string {
  return chosen
    .map((v) => v.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6))
    .filter(Boolean)
    .join('-');
}

export function VariantEditor({
  productId, productName, scope, existing,
  createStatus, canEdit, variant, onDone, onCancel,
}: VariantEditorProps) {
  const isEdit = !!variant;
  const attributes = useMemo(() => scope?.attributes ?? [], [scope]);
  const create = useCreateVariant();
  const update = useUpdateVariant();
  const saving = create.isPending || update.isPending;

  // attribute_id -> value_id
  const [values, setValues] = useState<Record<string, string>>({});
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [salePrice, setSalePrice] = useState(0);
  const [costPrice, setCostPrice] = useState(0);
  const [touchedName, setTouchedName] = useState(false);
  const [touchedSku, setTouchedSku] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!variant) return;
    setValues(Object.fromEntries(variant.values.map((v) => [v.attribute_id, v.value_id])));
    setSku(variant.sku);
    setName(variant.name);
    setBarcode(variant.barcode ?? '');
    setSalePrice(variant.sale_price);
    setCostPrice(variant.cost_price);
    setTouchedName(true);
    setTouchedSku(true);
  }, [variant]);

  const chosenLabels = useMemo(
    () =>
      attributes
        .map((a) => a.values.find((v) => v.id === values[a.id])?.value)
        .filter((v): v is string => !!v),
    [attributes, values],
  );

  // Suggest name and SKU until the user types their own.
  useEffect(() => {
    if (isEdit) return;
    if (!touchedName) setName(suggestName(productName, chosenLabels));
    if (!touchedSku) {
      const suffix = suggestSkuSuffix(chosenLabels);
      setSku(suffix ? `${suffix}` : '');
    }
  }, [chosenLabels, productName, isEdit, touchedName, touchedSku]);

  /**
   * Duplicate pre-check. The database is the real guard — a UNIQUE index on
   * (product_id, combo_key) cannot be raced — but catching it here means the
   * user is told before typing a SKU rather than after pressing Create.
   */
  const duplicate = useMemo(() => {
    if (isEdit) return null;
    const chosenIds = attributes
      .map((a) => values[a.id])
      .filter(Boolean)
      .sort()
      .join(':');
    if (!chosenIds) return null;
    return existing.find((v) => {
      const key = v.values.map((x) => x.value_id).sort().join(':');
      return v.product_id === productId && key === chosenIds;
    }) ?? null;
  }, [attributes, values, existing, isEdit, productId]);

  const allChosen = attributes.length > 0 && attributes.every((a) => !!values[a.id]);
  const canSubmit =
    !saving &&
    !!sku.trim() &&
    !!name.trim() &&
    (isEdit || (allChosen && !duplicate));

  async function submit() {
    setFailure(null);
    try {
      if (isEdit && variant) {
        await update.mutateAsync({
          id: variant.id,
          patch: { sku, name, barcode: barcode || null, sale_price: salePrice, cost_price: costPrice },
        });
        onDone();
      } else {
        const created = await create.mutateAsync({
          product_id: productId,
          sku,
          name,
          barcode: barcode || null,
          sale_price: salePrice,
          cost_price: costPrice,
          status: createStatus,
          values,
        });
        onDone(created);
      }
    } catch (e) {
      // Rule 5 — the database's own sentence, on screen, not just in a toast.
      setFailure(errorText(e));
    }
  }

  /*
   * FOUR REASONS THERE MAY BE NOTHING TO CHOOSE FROM, and they are not the same
   * problem, so they do not get the same message. Before Pass C a product with
   * no category still offered every value in the system; now it offers none,
   * which is correct but would be baffling without being told why.
   */
  if (!isEdit && !scope) {
    return (
      <p className="p-4 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
        Loading the available values…
      </p>
    );
  }

  const noValuesAnywhere =
    !isEdit && attributes.length > 0 && attributes.every((a) => a.values.length === 0);

  if (!isEdit && (attributes.length === 0 || scope!.categoryId === null || noValuesAnywhere)) {
    const uncategorised = scope!.categoryId === null;
    return (
      <div className="rounded-[var(--ds-radius)] border border-dashed border-[hsl(var(--ds-border-strong))] bg-[hsl(var(--ds-surface-sunken))] p-4">
        {uncategorised ? (
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--ds-amber))]" />
            <div className="text-[var(--ds-fs-sm)]">
              <p className="font-semibold text-[hsl(var(--ds-amber))]">
                This product has no category, so no values are available
              </p>
              <p className="mt-0.5 text-[hsl(var(--ds-ink))]">
                Which values a product may be built from is declared on its category —
                a Dining Chair offers the polishes chairs are sold in, not every polish in
                the system. Without a category there is nothing to draw that list from.
                Set a category on the General Information tab, then declare its values
                under Setup → Product Categories.
              </p>
            </div>
          </div>
        ) : attributes.length === 0 ? (
          <p className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
            This product has no attributes assigned, so there is no combination to define.
            Assign attributes first — a variant must state what it stands for.
          </p>
        ) : (
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--ds-amber))]" />
            <div className="text-[var(--ds-fs-sm)]">
              <p className="font-semibold text-[hsl(var(--ds-amber))]">
                {scope!.categoryName ?? 'This category'} offers no values for these attributes
              </p>
              <p className="mt-0.5 text-[hsl(var(--ds-ink))]">
                {attributes.map((a) => a.name).join(', ')}{' '}
                {attributes.length === 1 ? 'is' : 'are'} assigned to this product, but the
                category declares none of their values — so there is no combination to
                build. Declare them on the category, or on one of its parents.
              </p>
            </div>
          </div>
        )}
        <div className="mt-3">
          <Button variant="subtle" onClick={onCancel}>Close</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {failure && (
        <ErrorBanner
          title={isEdit ? 'Could not save the variant' : 'Could not create the variant'}
          message={failure}
          onDismiss={() => setFailure(null)}
        />
      )}

      {createStatus === 'provisional' && !isEdit && (
        <div
          className={cn(
            'rounded-[var(--ds-radius)] border border-[hsl(var(--ds-blue)/0.4)]',
            'bg-[hsl(var(--ds-blue-bg))] px-3 py-2 text-[var(--ds-fs-sm)]',
          )}
        >
          <p className="font-semibold text-[hsl(var(--ds-blue))]">
            This creates a provisional version
          </p>
          <p className="mt-0.5 text-[hsl(var(--ds-ink))]">
            It appears in the catalogue immediately so inventory can order it, but stays
            marked provisional until an order is confirmed against it or units of it are
            received. Nothing removes it in the meantime.
          </p>
        </div>
      )}

      {/* The combination. Immutable once created — see the header. */}
      <div>
        {isEdit ? (
          <Field label="Combination">
            <div className="flex flex-wrap items-center gap-1.5">
              {variant!.values.map((v) => (
                <StatusPill key={v.attribute_id} tone="grey">
                  {v.attribute_name}: {v.value}
                </StatusPill>
              ))}
            </div>
            <p className="mt-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
              A variant's combination cannot be changed. Redefining it would silently change
              what every document referencing it means — archive this one and create a
              replacement instead.
            </p>
          </Field>
        ) : (
          attributes.map((a) => (
            <Field key={a.id} label={a.name} required htmlFor={`attr-${a.id}`}>
              <SelectInput
                id={`attr-${a.id}`}
                value={values[a.id] ?? ''}
                onChange={(e) => setValues((p) => ({ ...p, [a.id]: e.target.value }))}
              >
                <option value="">Select…</option>
                {a.values.map((v) => (
                  <option key={v.id} value={v.id}>{v.value}</option>
                ))}
              </SelectInput>
              {/*
                An attribute the category declares nothing for. The dropdown
                would otherwise be silently empty and Create permanently
                unreachable, since every attribute must be answered.
              */}
              {a.values.length === 0 && (
                <p className="mt-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-amber))]">
                  {scope!.categoryName ?? 'This category'} declares no {a.name.toLowerCase()}{' '}
                  values, so this cannot be answered. Declare them on the category first.
                </p>
              )}
            </Field>
          ))
        )}
      </div>

      {duplicate && (
        <div
          className={cn(
            'rounded-[var(--ds-radius)] border border-[hsl(var(--ds-amber)/0.4)]',
            'bg-[hsl(var(--ds-amber-bg))] px-3 py-2 text-[var(--ds-fs-sm)]',
          )}
        >
          <p className="font-semibold text-[hsl(var(--ds-amber))]">
            That combination already exists
          </p>
          <p className="mt-0.5 text-[hsl(var(--ds-ink))]">
            <strong>{duplicate.sku}</strong> — {duplicate.name}
            {duplicate.status === 'archived' && ' (archived — restore it rather than making a second one)'}
          </p>
        </div>
      )}

      <div className="grid gap-x-8 md:grid-cols-2">
        <div>
          <Field label="Reference (SKU)" required htmlFor="v-sku" hint="Unique across all products and variants.">
            <TextInput
              id="v-sku"
              value={sku}
              disabled={!canEdit}
              onChange={(e) => { setSku(e.target.value); setTouchedSku(true); }}
            />
          </Field>
          <Field label="Name" required htmlFor="v-name">
            <TextInput
              id="v-name"
              value={name}
              disabled={!canEdit}
              onChange={(e) => { setName(e.target.value); setTouchedName(true); }}
            />
          </Field>
          <Field label="Barcode" htmlFor="v-barcode">
            <TextInput id="v-barcode" value={barcode} disabled={!canEdit}
              onChange={(e) => setBarcode(e.target.value)} />
          </Field>
        </div>
        <div>
          <Field label="Sales Price" htmlFor="v-sale" hint="Absolute for this version, not a delta from the product.">
            <TextInput id="v-sale" type="number" step="0.01" min="0" value={String(salePrice)}
              disabled={!canEdit}
              onChange={(e) => setSalePrice(Number(e.target.value) || 0)} />
          </Field>
          <Field label="Cost" htmlFor="v-cost">
            <TextInput id="v-cost" type="number" step="0.01" min="0" value={String(costPrice)}
              disabled={!canEdit}
              onChange={(e) => setCostPrice(Number(e.target.value) || 0)} />
          </Field>
          {!canEdit && (
            <p className="mt-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
              Pricing and naming are set by Inventory. You are creating the version so it
              exists; Inventory completes it.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-[hsl(var(--ds-border))] pt-3">
        <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
          {saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}
        </Button>
        <Button variant="subtle" onClick={onCancel}>Cancel</Button>
        {!isEdit && !allChosen && (
          <span className="ml-auto text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
            Choose a value for every attribute.
          </span>
        )}
      </div>
    </div>
  );
}
