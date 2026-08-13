/**
 * Inventory 2 — product form. Routes:
 *   /inventory2/products/new
 *   /inventory2/products/:id
 *
 * This is the first Inventory 2 screen that writes `products`, a table shared
 * with Sales. The approved write surface is enumerated in
 * lib/services/inventory2/products.ts (`WRITABLE`) and enforced there at
 * runtime; this file must not widen it.
 *
 * SALES PRICE IS INVENTORY-OWNED (Pass 10D). Products belong to Inventory and
 * every other module consumes them, so the catalogue price is set here. It is
 * safe to edit because nothing recalculates from it: order_lines,
 * quotation_lines, invoice_lines and subscription_lines each carry their own
 * NOT NULL unit_price, snapshotted when the line is written. Editing the
 * catalogue price seeds the NEXT line and cannot rewrite a past invoice.
 *
 * TWO VALUES ARE SHOWN BUT NOT EDITABLE, each for a different reason:
 *
 *   Quantity On Hand  Derived from inv_stock_item, never from
 *                     products.stock_on_hand. Odoo does the same — its
 *                     "Quantity On Hand" is computed from stock moves, not a
 *                     stored field anyone can type into. Showing the derived
 *                     number with its status split is what makes the legacy
 *                     column visibly obsolete: the one product reads 10 in
 *                     stock_on_hand and 24 here.
 *
 *   Track Serials     Under investigation. The flag is false on the one
 *                     product in the database, which carries 24
 *                     serial-identified units, because nothing reads it —
 *                     inv_receive_serial never consults it and
 *                     inv_stock_item.serial is NOT NULL. A toggle that changes
 *                     nothing is worse than no toggle, so it is read-only
 *                     until that is resolved.
 *
 * NO DELETE. RLS forbids it (`products_no_delete` USING(false)) and 37 foreign
 * keys reference products.id. Archiving via is_active is the supported path.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY2_NAV } from '@/lib/navigation';
import {
  DocumentHeader, DocumentTabs, Button, StatusPill, SectionLabel, cn,
  type RibbonStage, type HeaderAction, type DocumentTab, type StatusTone,
} from '@/design-system';
import '@/design-system/tokens.css';
import {
  Field, TextInput, TextArea, SelectInput, LockedValue, ErrorBanner,
} from '@/components/inventory2/formControls';
import { errorText } from '@/lib/inventory2/errorText';
import { STATUS_LABEL, STATUS_TONE, STATUS_MEANING } from '@/lib/inventory2/status';
import {
  useInv2Product, useInv2ProductOnHand, useInv2Categories, useInv2Uoms,
  useCreateInv2Product, useUpdateInv2Product,
} from '@/hooks/inventory2/products';
import {
  PRODUCT_TYPES, COST_METHODS, PRODUCT_MODES,
  type ProductInput, type ProductType, type CostMethod, type ProductMode, type OnHandBucket,
} from '@/lib/services/inventory2/products';
import { AttributeAssignment } from '@/components/inventory2/AttributeAssignment';
import { VariantEditor } from '@/components/inventory2/VariantEditor';
import { useInv2Variants, useInv2AssignedAttributes } from '@/hooks/inventory2/variants';
import type { VariantStatus } from '@/lib/services/inventory2/variants';

const VARIANT_TONE: Record<VariantStatus, StatusTone> = {
  provisional: 'blue',
  permanent: 'green',
  archived: 'grey',
};

const VARIANT_LABEL: Record<VariantStatus, string> = {
  provisional: 'Provisional',
  permanent: 'Permanent',
  archived: 'Archived',
};

const LIST_PATH = '/inventory2/products';

/** Products have no state machine. Active/Archived is the only real status. */
const RIBBON_STAGES: RibbonStage[] = [
  { key: 'active', label: 'Active' },
  { key: 'archived', label: 'Archived' },
];

const TYPE_LABEL: Record<ProductType, string> = {
  stockable: 'Stockable — tracked as units in stock',
  consumable: 'Consumable — not stock tracked',
  service: 'Service — no physical goods',
};

const MODE_LABEL: Record<ProductMode, string> = {
  stocked: 'Stocked — sold as pre-defined versions',
  made_to_order: 'Made to order — options chosen per sales line',
  both: 'Both — stocked versions and made-to-order',
};

const COST_METHOD_LABEL: Record<CostMethod, string> = {
  average: 'Average cost',
  fifo: 'FIFO — first in, first out',
  lifo: 'LIFO — last in, first out',
};

const EMPTY: ProductInput = {
  sku: '',
  name: '',
  type: 'stockable',
  description: null,
  cost_price: 0,
  reorder_level: 0,
  cost_method: 'average',
  barcode: null,
  track_inventory: true,
  is_active: true,
  category_id: null,
  uom_id: null,
  weight: null,
  volume: null,
  // made_to_order matches the column default and today's behaviour: a new
  // product uses the customization picker until someone says otherwise.
  mode: 'made_to_order',
  sale_price: 0,
  warranty_eligible: false,
  factory_eligible: false,
};

/**
 * Number inputs that may legitimately be empty. Blank must round-trip to NULL,
 * not 0 — "this product has never been weighed" and "this product weighs
 * nothing" are different facts, and coercing the first into the second would
 * put a fabricated 0 into a shared table.
 */
function toNullableNumber(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ------------------------------------------------------- derived stock bits */

function totalOnHand(buckets: OnHandBucket[]): number {
  return buckets.reduce((s, b) => s + b.qty, 0);
}

/** Collapse the location dimension — the headline figure is per status. */
function byStatus(buckets: OnHandBucket[]): { status: string; qty: number }[] {
  const m = new Map<string, number>();
  for (const b of buckets) {
    const k = b.status ?? 'unknown';
    m.set(k, (m.get(k) ?? 0) + b.qty);
  }
  return [...m.entries()].map(([status, qty]) => ({ status, qty }));
}

function StatusChips({ buckets }: { buckets: OnHandBucket[] }) {
  const rows = byStatus(buckets);
  if (!rows.length) {
    return (
      <span className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-subtle))]">
        No units received yet.
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {rows.map((r) => (
        <StatusPill
          key={r.status}
          tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? 'grey'}
        >
          {r.qty} · {STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] ?? r.status}
        </StatusPill>
      ))}
    </div>
  );
}

/** A value the reader may see but not set, with the reason attached. */
function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">{children}</p>
  );
}

/** Tab body for a section that is deliberately not built yet. */
function Placeholder({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-[var(--ds-radius)] border border-dashed border-[hsl(var(--ds-border-strong))]',
        'bg-[hsl(var(--ds-surface-sunken))] p-4',
      )}
    >
      <SectionLabel>{title}</SectionLabel>
      <p className="mt-2 max-w-2xl text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
        {body}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ screen */

export default function Inv2ProductForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  /**
   * Two routes render this component: the static /products/new and the dynamic
   * /products/:id. On the static route React Router binds no `:id` param, so
   * `id` is undefined — testing only for the literal 'new' would treat the
   * create screen as a lookup for a missing record. Both forms are accepted so
   * the component does not depend on which route matched.
   */
  const isNew = id === undefined || id === 'new';
  const productId = isNew ? undefined : id;

  const { data: existing, isLoading, error: loadError } = useInv2Product(productId);
  const { data: onHand = [], error: onHandError } = useInv2ProductOnHand(productId);
  const { data: categories = [] } = useInv2Categories();
  const { data: uoms = [] } = useInv2Uoms();
  const { data: variants = [], error: variantsError } = useInv2Variants(productId);
  const { data: assignedAttributes = [] } = useInv2AssignedAttributes(productId);
  const [addingVariant, setAddingVariant] = useState(false);

  const create = useCreateInv2Product();
  const update = useUpdateInv2Product(productId);
  const saving = create.isPending || update.isPending;

  const [form, setForm] = useState<ProductInput>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!isNew && existing) {
      setForm({
        sku: existing.sku,
        name: existing.name,
        type: existing.type,
        description: existing.description,
        cost_price: existing.cost_price,
        reorder_level: existing.reorder_level,
        cost_method: existing.cost_method,
        barcode: existing.barcode,
        track_inventory: existing.track_inventory,
        is_active: existing.is_active,
        category_id: existing.category_id,
        uom_id: existing.uom_id,
        weight: existing.weight,
        volume: existing.volume,
        mode: existing.mode,
        sale_price: existing.sale_price,
        warranty_eligible: existing.warranty_eligible,
        factory_eligible: existing.factory_eligible,
      });
      setDirty(false);
    }
  }, [existing, isNew]);

  function set<K extends keyof ProductInput>(key: K, value: ProductInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  const canSave = !!form.sku.trim() && !!form.name.trim() && !saving && (isNew || dirty);

  async function save() {
    setFailure(null);
    try {
      const payload: ProductInput = {
        ...form,
        sku: form.sku.trim(),
        name: form.name.trim(),
        barcode: form.barcode?.trim() ? form.barcode.trim() : null,
        description: form.description?.trim() ? form.description.trim() : null,
      };
      if (isNew) {
        const row = await create.mutateAsync(payload);
        navigate(`/inventory2/products/${row.id}`);
      } else {
        await update.mutateAsync(payload);
        setDirty(false);
      }
    } catch (e) {
      // Rule 5 — the message stays on screen. A duplicate SKU or an RLS refusal
      // both arrive here as the Postgres sentence, and both tell the user what
      // to do next.
      setFailure(errorText(e));
    }
  }

  const actions: HeaderAction[] = [
    {
      key: 'save',
      label: saving ? 'Saving…' : isNew ? 'Create' : 'Save',
      variant: 'primary',
      onClick: () => void save(),
      disabled: !canSave,
      title: !form.sku.trim() || !form.name.trim()
        ? 'Reference and name are both required'
        : !isNew && !dirty
          ? 'No unsaved changes'
          : undefined,
    },
    { key: 'discard', label: 'Discard', onClick: () => navigate(LIST_PATH) },
  ];

  const total = useMemo(() => totalOnHand(onHand), [onHand]);

  /* --------------------------------------------------- General Information */

  const generalTab = (
    <div className="grid gap-x-8 md:grid-cols-2">
      <div>
        <Field label="Product Name" required htmlFor="name">
          <TextInput
            id="name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Teak Dining Chair"
          />
        </Field>

        <Field label="Reference (SKU)" required htmlFor="sku" hint="Must be unique across all products.">
          <TextInput
            id="sku"
            value={form.sku}
            onChange={(e) => set('sku', e.target.value)}
            placeholder="e.g. 101205"
          />
        </Field>

        <Field label="Product Type" htmlFor="type">
          <SelectInput id="type" value={form.type} onChange={(e) => set('type', e.target.value as ProductType)}>
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </SelectInput>
        </Field>

        <Field
          label="Selling Mode"
          htmlFor="mode"
          hint="Stocked sells pre-defined versions; made-to-order uses the customization picker on the sales line."
        >
          <SelectInput id="mode" value={form.mode} onChange={(e) => set('mode', e.target.value as ProductMode)}>
            {PRODUCT_MODES.map((m) => (
              <option key={m} value={m}>{MODE_LABEL[m]}</option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Category" htmlFor="cat" hint="From Inventory configuration.">
          <SelectInput
            id="cat"
            value={form.category_id ?? ''}
            onChange={(e) => set('category_id', e.target.value || null)}
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Unit of Measure" htmlFor="uom" hint="From Inventory configuration.">
          <SelectInput
            id="uom"
            value={form.uom_id ?? ''}
            onChange={(e) => set('uom_id', e.target.value || null)}
          >
            <option value="">—</option>
            {uoms.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}{u.abbreviation ? ` (${u.abbreviation})` : ''}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Barcode" htmlFor="barcode">
          <TextInput
            id="barcode"
            value={form.barcode ?? ''}
            onChange={(e) => set('barcode', e.target.value || null)}
          />
        </Field>

        <Field label="Status" htmlFor="active" hint="Products are archived, never deleted.">
          <SelectInput
            id="active"
            value={form.is_active ? 'active' : 'archived'}
            onChange={(e) => set('is_active', e.target.value === 'active')}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </SelectInput>
        </Field>
      </div>

      <div>
        <Field label="Quantity On Hand">
          {isNew ? (
            <LockedValue
              value="—"
              reason="Computed once units are received against this product. Never typed in."
            />
          ) : (
            <div>
              <LockedValue
                value={`${total} unit${total === 1 ? '' : 's'}`}
                reason="Derived from received units (inv_stock_item), counted across every location and status."
              />
              <div className="mt-2">
                <StatusChips buckets={onHand} />
              </div>
            </div>
          )}
        </Field>

        <Field label="Tracking">
          <LockedValue
            value={existing?.track_serials ? 'Serial-tracked' : 'Not serial-tracked'}
            reason="Read-only — under investigation. Every Inventory 2 unit is serial-identified regardless of this flag, so the value is currently not meaningful."
          />
        </Field>

        <Field label="Inventory Tracking" htmlFor="trackinv">
          <SelectInput
            id="trackinv"
            value={form.track_inventory ? 'yes' : 'no'}
            onChange={(e) => set('track_inventory', e.target.value === 'yes')}
          >
            <option value="yes">Tracked</option>
            <option value="no">Not tracked</option>
          </SelectInput>
        </Field>

        <Field label="Cost" htmlFor="cost" hint="What the business pays for one unit.">
          <TextInput
            id="cost"
            type="number"
            step="0.01"
            min="0"
            value={String(form.cost_price)}
            onChange={(e) => set('cost_price', Number(e.target.value) || 0)}
          />
        </Field>

        <Field
          label="Sales Price"
          htmlFor="saleprice"
          hint="Sales reads this to seed a new quotation, order or invoice line. Existing documents keep the price they were written with — changing it here never rewrites one."
        >
          <TextInput
            id="saleprice"
            type="number"
            step="0.01"
            min="0"
            value={String(form.sale_price)}
            onChange={(e) => set('sale_price', Number(e.target.value) || 0)}
          />
        </Field>

        <Field
          label="Warranty Eligible"
          htmlFor="warranty"
          hint="Warranty invoices only offer products marked eligible, and refuse one that is not."
        >
          <SelectInput
            id="warranty"
            value={form.warranty_eligible ? 'yes' : 'no'}
            onChange={(e) => set('warranty_eligible', e.target.value === 'yes')}
          >
            <option value="no">Not warranty eligible</option>
            <option value="yes">Warranty eligible</option>
          </SelectInput>
        </Field>

        <Field
          label="Factory Eligible"
          htmlFor="factory"
          hint="Factory invoices only offer products marked eligible, and refuse one that is not. Factory invoices are also raised without GST."
        >
          <SelectInput
            id="factory"
            value={form.factory_eligible ? 'yes' : 'no'}
            onChange={(e) => set('factory_eligible', e.target.value === 'yes')}
          >
            <option value="no">Not factory eligible</option>
            <option value="yes">Factory eligible</option>
          </SelectInput>
        </Field>

        <Field label="Internal Notes" htmlFor="desc">
          <TextArea
            id="desc"
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value || null)}
            placeholder="Notes for staff. Not shown to customers."
          />
        </Field>
      </div>
    </div>
  );

  /* ------------------------------------------------------------- Inventory */

  const inventoryTab = (
    <div className="space-y-4">
      <div className="grid gap-x-8 md:grid-cols-2">
        <div>
          <Field label="Reorder Level" htmlFor="reorder" hint="Dashboards flag the product when on-hand falls to or below this.">
            <TextInput
              id="reorder"
              type="number"
              step="1"
              min="0"
              value={String(form.reorder_level)}
              onChange={(e) => set('reorder_level', Number(e.target.value) || 0)}
            />
          </Field>

          <Field label="Costing Method" htmlFor="costmethod">
            <SelectInput
              id="costmethod"
              value={form.cost_method}
              onChange={(e) => set('cost_method', e.target.value as CostMethod)}
            >
              {COST_METHODS.map((m) => (
                <option key={m} value={m}>{COST_METHOD_LABEL[m]}</option>
              ))}
            </SelectInput>
          </Field>
        </div>

        <div>
          <Field label="Weight" htmlFor="weight" hint="Per unit, in kg. Leave blank if not measured.">
            <TextInput
              id="weight"
              type="number"
              step="0.001"
              min="0"
              value={form.weight ?? ''}
              onChange={(e) => set('weight', toNullableNumber(e.target.value))}
              placeholder="—"
            />
          </Field>

          <Field label="Volume" htmlFor="volume" hint="Per unit, in m³. Leave blank if not measured.">
            <TextInput
              id="volume"
              type="number"
              step="0.001"
              min="0"
              value={form.volume ?? ''}
              onChange={(e) => set('volume', toNullableNumber(e.target.value))}
              placeholder="—"
            />
          </Field>
        </div>
      </div>

      {/* The derived breakdown — the replacement for products.stock_on_hand. */}
      <div>
        <SectionLabel>Stock on hand by location and status</SectionLabel>
        {onHandError && (
          <div className="mt-2">
            <ErrorBanner title="Failed to load stock" message={errorText(onHandError)} />
          </div>
        )}
        {isNew ? (
          <p className="mt-2 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
            Available once the product exists and units have been received against it.
          </p>
        ) : onHand.length === 0 ? (
          <p className="mt-2 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
            No units of this product have been received into Inventory 2 yet.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[var(--ds-fs-sm)]">
              <thead>
                <tr className="border-b border-[hsl(var(--ds-border))] text-left text-[var(--ds-fs-xs)] uppercase tracking-wide text-[hsl(var(--ds-ink-subtle))]">
                  <th className="py-1.5 pr-3 font-semibold">Location</th>
                  <th className="py-1.5 pr-3 font-semibold">Status</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Qty</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Reserved</th>
                  <th className="py-1.5 font-semibold">Means</th>
                </tr>
              </thead>
              <tbody>
                {onHand.map((b, i) => (
                  <tr key={`${b.location_id}-${b.status}-${i}`} className="border-b border-[hsl(var(--ds-border))]">
                    <td className="py-1.5 pr-3">{b.location_name ?? '—'}</td>
                    <td className="py-1.5 pr-3">
                      <StatusPill tone={STATUS_TONE[b.status as keyof typeof STATUS_TONE] ?? 'grey'}>
                        {STATUS_LABEL[b.status as keyof typeof STATUS_LABEL] ?? b.status ?? '—'}
                      </StatusPill>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{b.qty}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{b.qty_reserved}</td>
                    <td className="py-1.5 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                      {b.status ? STATUS_MEANING[b.status as keyof typeof STATUS_MEANING] : '—'}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1.5 pr-3">Total</td>
                  <td />
                  <td className="py-1.5 pr-3 text-right tabular-nums">{total}</td>
                  <td /><td />
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/*
          The legacy column is shown ONLY where it disagrees, and labelled as
          superseded. Silence would let someone reading a dashboard that still
          uses stock_on_hand believe the two agree.
        */}
        {!isNew && existing && existing.legacy_stock_on_hand !== total && (
          <div className="mt-3 flex items-start gap-2 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-amber)/0.4)] bg-[hsl(var(--ds-amber-bg))] px-3 py-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--ds-amber))]" />
            <div className="text-[var(--ds-fs-sm)]">
              <p className="font-semibold text-[hsl(var(--ds-amber))]">
                The legacy <code>stock_on_hand</code> column disagrees
              </p>
              <p className="mt-0.5 text-[hsl(var(--ds-ink))]">
                It reads <strong>{existing.legacy_stock_on_hand}</strong>; the units actually
                in stock total <strong>{total}</strong>. Some dashboards and reports still read
                the legacy column. This screen never writes it, and retiring it is a separate
                approved pass.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* The legacy free-text pair, shown where it drifted from configuration. */}
      {!isNew && existing && (existing.legacy_category_text || existing.legacy_uom_text) && (
        <div>
          <SectionLabel>Legacy free-text fields</SectionLabel>
          <p className="mt-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
            Written by the old product form and read by nothing in Inventory 2. This screen
            sets the configured <code>category_id</code> / <code>uom_id</code> instead and
            never writes these. Shown so the drift is visible rather than silent.
          </p>
          <div className="mt-2 flex flex-wrap gap-4 text-[var(--ds-fs-sm)]">
            <span className="text-[hsl(var(--ds-ink-muted))]">
              category: <code>{existing.legacy_category_text || '(empty)'}</code>
            </span>
            <span className="text-[hsl(var(--ds-ink-muted))]">
              unit_of_measure: <code>{existing.legacy_uom_text || '(empty)'}</code>
            </span>
          </div>
        </div>
      )}
    </div>
  );

  /* --------------------------------------------- Attributes & Variants ---- */
  //
  // Two sections, in the order the work happens: assign the attributes that MAY
  // be combined, then create the combinations actually sold. Assignment creates
  // nothing on its own — generation is opt-in per combination, which is what
  // stops 8 sizes x 5 polishes becoming 40 rows nobody asked for.
  //
  // This is the narrower surface. Editing, archiving and cross-product work
  // live at /inventory2/config/variants.

  const showVariants = form.mode !== 'made_to_order';

  const variantsTab = isNew ? (
    <Placeholder
      title="Available once the product exists"
      body="Attributes are assigned per product, so this product has to be saved before it can carry any."
    />
  ) : (
    <div className="space-y-5">
      <AttributeAssignment productId={productId!} variants={variants} />

      {!showVariants ? (
        <div className="rounded-[var(--ds-radius)] border border-dashed border-[hsl(var(--ds-border-strong))] bg-[hsl(var(--ds-surface-sunken))] p-4">
          <SectionLabel>Versions are hidden for made-to-order products</SectionLabel>
          <p className="mt-2 max-w-2xl text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
            This product is set to <strong>Made to order</strong>, so options are chosen per
            sales line through the customization picker rather than sold as pre-defined
            versions. The attributes above still apply — the picker reads them. Change the
            selling mode on General Information to sell fixed versions.
          </p>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>Versions of this product</SectionLabel>
            {!addingVariant && (
              <Button size="sm" variant="primary" onClick={() => setAddingVariant(true)}>
                Add version
              </Button>
            )}
          </div>

          {variantsError && (
            <div className="mt-2">
              <ErrorBanner title="Failed to load versions" message={errorText(variantsError)} />
            </div>
          )}

          {addingVariant && (
            <div className="mt-2 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border))] p-3">
              <VariantEditor
                productId={productId!}
                productName={existing?.name}
                attributes={assignedAttributes}
                existing={variants}
                createStatus="permanent"
                canEdit
                onDone={() => setAddingVariant(false)}
                onCancel={() => setAddingVariant(false)}
              />
            </div>
          )}

          {variants.length === 0 ? (
            <p className="mt-2 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
              No versions yet. Assign attributes above, then add the combinations you sell.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[var(--ds-fs-sm)]">
                <thead>
                  <tr className="border-b border-[hsl(var(--ds-border))] text-left text-[var(--ds-fs-xs)] uppercase tracking-wide text-[hsl(var(--ds-ink-subtle))]">
                    <th className="py-1.5 pr-3 font-semibold">Version</th>
                    <th className="py-1.5 pr-3 font-semibold">Combination</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Price</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">On Hand</th>
                    <th className="py-1.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => (
                    <tr key={v.id} className="border-b border-[hsl(var(--ds-border))]">
                      <td className="py-1.5 pr-3">
                        <div className="font-medium text-[hsl(var(--ds-ink))]">{v.name}</div>
                        <div className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">{v.sku}</div>
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className="flex flex-wrap gap-1">
                          {v.values.map((x) => (
                            <StatusPill key={x.attribute_id} tone="grey">{x.value}</StatusPill>
                          ))}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{money(v.sale_price)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{v.on_hand}</td>
                      <td className="py-1.5">
                        <StatusPill tone={VARIANT_TONE[v.status]}>{VARIANT_LABEL[v.status]}</StatusPill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                Editing and archiving versions happens on{' '}
                <a href="/inventory2/config/variants" className="text-[hsl(var(--ds-link))] hover:underline">
                  Setup → Product Variants
                </a>.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const tabs: DocumentTab[] = [
    { key: 'general', label: 'General Information', content: generalTab },
    {
      key: 'variants',
      label: 'Attributes & Variants',
      badge: isNew ? undefined : variants.length || undefined,
      content: variantsTab,
    },
    {
      key: 'prices',
      label: 'Prices',
      content: (
        <Placeholder
          title="Not built in this pass"
          body={
            <>
              The product's own price is <code>sale_price</code> on General Information, and
              it is Inventory-owned. This tab is for <code>pricelists</code> —
              customer-specific and quantity-break pricing — which are currently empty and
              still written from Sales. Note that a pricelist is recorded on a quotation or
              order today but never applied to a line, so the feature is half-built on the
              Sales side; building this tab means finishing that first.
            </>
          }
        />
      ),
    },
    { key: 'inventory', label: 'Inventory', content: inventoryTab },
  ];

  /* ---------------------------------------------------------------- render */

  const title = isNew ? 'New Product' : (existing?.name ?? '…');

  return (
    <AppLayout title={isNew ? 'New Product' : 'Product'} moduleNav={INVENTORY2_NAV}>
      <div className="ds-root p-3 md:p-4">
        <div className="mx-auto max-w-5xl">
          <DocumentHeader
            breadcrumb={['Inventory 2', 'Products', isNew ? 'New' : (existing?.sku ?? '')]}
            title={title}
            actions={actions}
            stages={RIBBON_STAGES}
            currentStage={form.is_active ? 'active' : 'archived'}
            cog={false}
          />

          <div className="rounded-b-[var(--ds-radius)] border border-t-0 border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-surface))]">
            {loadError && (
              <div className="p-3">
                <ErrorBanner title="Failed to load the product" message={errorText(loadError)} />
              </div>
            )}

            {failure && (
              <div className="p-3 pb-0">
                <ErrorBanner
                  title={isNew ? 'Could not create the product' : 'Could not save the product'}
                  message={failure}
                  onDismiss={() => setFailure(null)}
                />
              </div>
            )}

            {!isNew && isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading…</div>
            ) : !isNew && !existing && !loadError ? (
              <div className="p-6 text-sm text-muted-foreground">
                No product with that id.
              </div>
            ) : (
              <>
                <DocumentTabs tabs={tabs} defaultValue="general" />

                <div className="flex items-center gap-2 border-t border-[hsl(var(--ds-border))] p-3">
                  <Button variant="primary" onClick={() => void save()} disabled={!canSave}>
                    {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
                  </Button>
                  <Button variant="subtle" onClick={() => navigate(LIST_PATH)}>Discard</Button>
                  <span className="ml-auto text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                    Creating and editing products requires an admin role.
                  </span>
                </div>
              </>
            )}
          </div>

          <ReadOnlyNote>
            Products are owned by Inventory; every other module reads them. This screen
            writes: reference, name, type, notes, selling mode, cost, sales price, reorder
            level, costing method, barcode, inventory tracking, warranty and factory
            eligibility, status, category, unit of measure, weight and volume. It never
            writes stock_on_hand, the legacy category/unit_of_measure text pair, or the
            legacy variants JSONB — and it cannot delete.
          </ReadOnlyNote>
        </div>
      </div>
    </AppLayout>
  );
}
