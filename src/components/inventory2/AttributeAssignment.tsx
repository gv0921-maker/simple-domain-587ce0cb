/**
 * Inventory 2 — assign global attributes to a product. Pass 10C.
 *
 * A design-system port of components/inventory/config/ProductAttributesAssignment,
 * which is shadcn and mounted on the LEGACY product form. Both write the same
 * table; this one lives in the new module and is the one that will survive.
 * The legacy component is untouched — Rule 4, and CustomizationPicker still
 * reads what it writes.
 *
 * ASSIGNMENT DEFINES THE CANDIDATE SPACE. It creates nothing. Ticking Size and
 * Polish on a chair says those two attributes may be combined for it — 8 sizes
 * × 5 polishes is 40 candidates — and generation stays opt-in per combination
 * so only the versions actually sold become rows. That is the whole reason this
 * is separate from the variant list below it.
 *
 * UN-ASSIGNING NEVER DELETES. Existing variants keep their ids and their stock;
 * the ones whose combination no longer fits are surfaced for archiving, and the
 * database refuses even that while units exist.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, SectionLabel, StatusPill, cn } from '@/design-system';
import { ErrorBanner } from './formControls';
import { errorText } from '@/lib/inventory2/errorText';
import {
  useProductAttributes,
  useProductAttributeAssignments,
  useSetProductAttributeAssignments,
} from '@/hooks/inventory/config';
import { inv2VariantKeys } from '@/hooks/inventory2/variants';
import type { VariantRecord } from '@/lib/services/inventory2/variants';

export function AttributeAssignment({
  productId,
  variants,
  disabled,
}: {
  productId: string;
  /** Used to warn before an un-assignment orphans existing variants. */
  variants: VariantRecord[];
  disabled?: boolean;
}) {
  const { data: attributes = [], isLoading } = useProductAttributes();
  const { data: assignments = [] } = useProductAttributeAssignments(productId);
  const setMut = useSetProductAttributeAssignments(productId);
  const qc = useQueryClient();

  const [selected, setSelected] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Deliberately does NOT clear `saved`: this effect also runs on the refetch
  // that our own save triggers, so clearing here would wipe the confirmation
  // the instant it appeared. `saved` is cleared when the user next toggles.
  useEffect(() => {
    setSelected(assignments.map((a) => a.attributeId));
  }, [assignments]);

  const assignedIds = useMemo(() => new Set(assignments.map((a) => a.attributeId)), [assignments]);
  const dirty = useMemo(() => {
    const a = [...selected].sort().join(',');
    const b = [...assignedIds].sort().join(',');
    return a !== b;
  }, [selected, assignedIds]);

  /**
   * Which live variants would no longer fit the chosen attribute set. Reported
   * before saving, because the alternative is discovering it afterwards on a
   * list that suddenly makes no sense.
   */
  const orphaned = useMemo(() => {
    const keep = new Set(selected);
    return variants.filter(
      (v) => v.status !== 'archived' && v.values.some((x) => !keep.has(x.attribute_id)),
    );
  }, [variants, selected]);

  const toggle = (id: string) => {
    setSaved(false);
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  async function save() {
    setFailure(null);
    try {
      await setMut.mutateAsync(selected);
      /**
       * The save goes through the LEGACY hook, which invalidates only the
       * legacy query keys (['product-attribute-assignments', id] and
       * ['product-attributes-for', id]). The new module reads the same data
       * under inv2VariantKeys.assigned(id), so without this the variant editor
       * beside us keeps saying "no attributes assigned" after they plainly were.
       *
       * This component is the bridge between the two key spaces, so it is the
       * right place to reconcile them — until the attribute service itself moves
       * under inventory2/, which is blocked while legacy still imports it.
       */
      void qc.invalidateQueries({ queryKey: inv2VariantKeys.all });
      setSaved(true);
    } catch (e) {
      setFailure(errorText(e));
    }
  }

  return (
    <div>
      <SectionLabel>Attributes that apply to this product</SectionLabel>
      <p className="mt-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
        This sets what <em>may</em> be combined; it creates nothing on its own. Add the
        versions you actually sell below. The same assignment also drives the customization
        picker on sales lines for made-to-order products.
      </p>

      {failure && (
        <div className="mt-2">
          <ErrorBanner title="Could not save the attributes" message={failure} onDismiss={() => setFailure(null)} />
        </div>
      )}

      {isLoading ? (
        <p className="mt-2 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">Loading…</p>
      ) : attributes.length === 0 ? (
        <p className="mt-2 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
          No attributes are defined yet. Create them under Setup → Product Attributes.
        </p>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {attributes.map((a) => {
            const on = selected.includes(a.id);
            return (
              <label
                key={a.id}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-[var(--ds-radius)] border p-2 transition-colors',
                  on
                    ? 'border-[hsl(var(--ds-primary))] bg-[hsl(var(--ds-primary)/0.05)]'
                    : 'border-[hsl(var(--ds-border))] hover:bg-[hsl(var(--ds-surface-alt))]',
                  disabled && 'pointer-events-none opacity-60',
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={disabled}
                  onChange={() => toggle(a.id)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[var(--ds-fs-sm)] font-medium text-[hsl(var(--ds-ink))]">
                      {a.name}
                    </span>
                    <StatusPill tone="grey">{a.values?.length ?? 0} values</StatusPill>
                  </span>
                  {(a.values ?? []).length > 0 && (
                    <span className="mt-0.5 block truncate text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                      {(a.values ?? []).map((v) => v.value).join(', ')}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {dirty && orphaned.length > 0 && (
        <div
          className={cn(
            'mt-3 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-amber)/0.4)]',
            'bg-[hsl(var(--ds-amber-bg))] px-3 py-2 text-[var(--ds-fs-sm)]',
          )}
        >
          <p className="font-semibold text-[hsl(var(--ds-amber))]">
            {orphaned.length} existing version{orphaned.length === 1 ? '' : 's'} would no longer fit
          </p>
          <p className="mt-0.5 text-[hsl(var(--ds-ink))]">
            {orphaned.map((v) => v.sku).join(', ')} — these keep their rows and their stock.
            Nothing is deleted. Archive them from the list below if they are genuinely
            finished; the database refuses to archive any that still hold units.
          </p>
        </div>
      )}

      {!disabled && (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" onClick={() => void save()} disabled={!dirty || setMut.isPending}>
            {setMut.isPending ? 'Saving…' : 'Save attributes'}
          </Button>
          {saved && !dirty && (
            <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-green))]">Saved.</span>
          )}
        </div>
      )}
    </div>
  );
}
