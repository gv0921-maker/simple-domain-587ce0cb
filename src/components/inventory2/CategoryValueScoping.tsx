/**
 * Inventory 2 — which attribute values a category offers. Pass B.
 *
 * Lives ON THE CATEGORY FORM rather than at its own route. The data is
 * per-category, so it belongs with the category record; and putting it beside
 * the Parent Category selector is what makes a reparent visible — change the
 * parent and the inherited set below re-reads immediately, instead of silently
 * changing what every product in the category can offer. A separate
 * cross-category screen would be a second place to edit the same rows, which is
 * the duplicate-editor problem this codebase has already paid for once.
 *
 * THREE STATES PER VALUE, and the difference is the point:
 *   declared here   ticked, with this category's own price
 *   inherited       read-only, badged with the ancestor it came from
 *   both            declared here AND inherited — an override, shown as such
 *
 * extra_price is NOT NULL DEFAULT 0. Zero means "adds nothing", not "unset", so
 * a declared value with no adjustment renders as an explicit "+0", never as a
 * blank that might read as unconfigured.
 */
import { useMemo, useState } from 'react';
import { Button, StatusPill, SectionLabel, cn } from '@/design-system';
import { TextInput, ErrorBanner } from './formControls';
import { errorText } from '@/lib/inventory2/errorText';
import { useProductAttributes } from '@/hooks/inventory/config';
import {
  useCategoryValueLinks, useSetCategoryValueLink, useRemoveCategoryValueLink,
} from '@/hooks/inventory2/categoryValues';
import {
  ancestorsOf, resolveScopedValues, type ScopedValue,
} from '@/lib/services/inventory2/categoryValues';

interface CategoryNode {
  id: string;
  name: string;
  parentCategoryId?: string | null;
}

export function CategoryValueScoping({
  categoryId,
  categories,
  /** The parent currently selected in the form — may be unsaved. */
  pendingParentId,
}: {
  categoryId: string;
  categories: CategoryNode[];
  pendingParentId: string | null;
}) {
  const { data: attributes = [], isLoading: attrsLoading } = useProductAttributes();
  const { data: links = [], isLoading: linksLoading, error: linksError } = useCategoryValueLinks();
  const setLink = useSetCategoryValueLink();
  const removeLink = useRemoveCategoryValueLink();

  const [failure, setFailure] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});

  /**
   * Ancestors are computed from the parent currently SELECTED, not the parent
   * last saved. Changing the dropdown re-reads the inherited set immediately,
   * so the consequence of a reparent is on screen before it is committed.
   */
  const byId = useMemo(() => {
    const m = new Map<string, CategoryNode>(categories.map((c) => [c.id, c]));
    const self = m.get(categoryId);
    if (self) m.set(categoryId, { ...self, parentCategoryId: pendingParentId });
    return m;
  }, [categories, categoryId, pendingParentId]);

  const ancestors = useMemo(() => ancestorsOf(categoryId, byId), [categoryId, byId]);

  const savedParentId = categories.find((c) => c.id === categoryId)?.parentCategoryId ?? null;
  const parentChanged = (savedParentId ?? '') !== (pendingParentId ?? '');

  const perAttribute = useMemo(
    () =>
      attributes
        .filter((a) => a.isActive)
        .map((a) => ({
          attribute: a,
          values: resolveScopedValues(
            categoryId,
            (a.values ?? []).map((v) => ({
              id: v.id, attribute_id: a.id, value: v.value, color_hex: v.colorHex ?? null,
            })),
            links,
            ancestors,
          ),
        })),
    [attributes, categoryId, links, ancestors],
  );

  async function toggle(v: ScopedValue) {
    setFailure(null);
    try {
      if (v.declaredHere) {
        await removeLink.mutateAsync({ categoryId, valueId: v.value_id });
      } else {
        await setLink.mutateAsync({
          category_id: categoryId,
          value_id: v.value_id,
          attribute_id: v.attribute_id,
          extra_price: 0,
        });
      }
    } catch (e) {
      setFailure(errorText(e));
    }
  }

  async function commitPrice(v: ScopedValue) {
    const raw = priceDraft[v.value_id];
    if (raw === undefined) return;
    const next = Number(raw);
    if (!Number.isFinite(next) || next < 0) {
      setFailure('A price adjustment must be zero or more.');
      return;
    }
    setFailure(null);
    try {
      await setLink.mutateAsync({
        category_id: categoryId,
        value_id: v.value_id,
        attribute_id: v.attribute_id,
        extra_price: next,
      });
      setPriceDraft((d) => { const n = { ...d }; delete n[v.value_id]; return n; });
    } catch (e) {
      setFailure(errorText(e));
    }
  }

  const totalDeclared = perAttribute.reduce(
    (n, g) => n + g.values.filter((v) => v.declaredHere).length, 0);
  const totalInherited = perAttribute.reduce(
    (n, g) => n + g.values.filter((v) => v.inheritedFrom && !v.declaredHere).length, 0);

  return (
    <div className="border-t border-[hsl(var(--ds-border))] px-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Attribute values this category offers</SectionLabel>
        <span className="flex items-center gap-1.5">
          <StatusPill tone="green">{totalDeclared} declared here</StatusPill>
          <StatusPill tone="blue">{totalInherited} inherited</StatusPill>
        </span>
      </div>

      {/*
        Nothing enforces this yet. Saying so on the screen is the difference
        between "configured, waiting" and "configured and apparently ignored".
      */}
      <p className="mt-1.5 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
        <strong>Not enforced yet.</strong> Products still see every value of an attribute
        assigned to them — the variant editor and the sales customization picker are
        repointed in a later pass. Configuring it now is deliberate: the scoping is set up
        before it starts filtering, so nothing changes underneath anyone.
      </p>

      {ancestors.length > 0 && (
        <p className="mt-2 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))]">
          Inherits from{' '}
          {ancestors.map((a, i) => (
            <span key={a.id}>
              {i > 0 && ' → '}
              <strong>{a.name}</strong>
            </span>
          ))}
          . A value declared on any of those applies here too.
        </p>
      )}

      {parentChanged && (
        <div
          className={cn(
            'mt-2 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-amber)/0.4)]',
            'bg-[hsl(var(--ds-amber-bg))] px-3 py-2 text-[var(--ds-fs-sm)]',
          )}
        >
          <p className="font-semibold text-[hsl(var(--ds-amber))]">
            Parent changed — the inherited list below has already updated
          </p>
          <p className="mt-0.5 text-[hsl(var(--ds-ink))]">
            {ancestors.length === 0
              ? 'This category would inherit nothing. Values declared on the old parent would no longer apply here.'
              : `It would now inherit from ${ancestors.map((a) => a.name).join(' → ')}.`}{' '}
            Save the category to commit it.
          </p>
        </div>
      )}

      {failure && (
        <div className="mt-2">
          <ErrorBanner title="Could not update the value" message={failure} onDismiss={() => setFailure(null)} />
        </div>
      )}
      {linksError && (
        <div className="mt-2">
          <ErrorBanner title="Failed to load scoping" message={errorText(linksError)} />
        </div>
      )}

      {attrsLoading || linksLoading ? (
        <p className="mt-3 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">Loading…</p>
      ) : perAttribute.length === 0 ? (
        <p className="mt-3 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">
          No active attributes are defined. Create them under Setup → Product Attributes.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {perAttribute.map(({ attribute, values }) => (
            <div key={attribute.id}>
              <div className="mb-1 text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
                {attribute.name}
                <span className="ml-2 font-normal text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                  {values.filter((v) => v.declaredHere || v.inheritedFrom).length} of {values.length} available here
                </span>
              </div>

              {values.length === 0 ? (
                <p className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                  This attribute has no values yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-[var(--ds-fs-sm)]">
                    <tbody>
                      {values.map((v) => {
                        const draft = priceDraft[v.value_id];
                        const priceValue = draft ?? (v.declaredHere ? String(v.extra_price ?? 0) : '');
                        return (
                          <tr key={v.value_id} className="border-b border-[hsl(var(--ds-border)/0.7)]">
                            <td className="w-[34px] py-1.5">
                              <input
                                type="checkbox"
                                checked={v.declaredHere}
                                onChange={() => void toggle(v)}
                                aria-label={`${attribute.name}: ${v.value}`}
                              />
                            </td>

                            <td className="py-1.5 pr-3">
                              <span className="flex flex-wrap items-center gap-1.5">
                                {v.color_hex && (
                                  <span
                                    aria-hidden
                                    className="inline-block h-3 w-3 rounded border align-middle"
                                    style={{ backgroundColor: v.color_hex }}
                                  />
                                )}
                                <span className={v.declaredHere || v.inheritedFrom
                                  ? 'text-[hsl(var(--ds-ink))]'
                                  : 'text-[hsl(var(--ds-ink-subtle))]'}>
                                  {v.value}
                                </span>

                                {/* Origin is the thing that must never be ambiguous. */}
                                {v.declaredHere && v.inheritedFrom && (
                                  <StatusPill tone="amber">
                                    overrides {v.inheritedFrom.name}
                                  </StatusPill>
                                )}
                                {!v.declaredHere && v.inheritedFrom && (
                                  <StatusPill tone="blue">
                                    from {v.inheritedFrom.name}
                                  </StatusPill>
                                )}
                                {v.declaredHere && !v.inheritedFrom && (
                                  <StatusPill tone="green">here</StatusPill>
                                )}
                              </span>
                            </td>

                            <td className="w-[190px] py-1.5">
                              {v.declaredHere ? (
                                <span className="flex items-center gap-1.5">
                                  <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">+₹</span>
                                  <TextInput
                                    className="h-[26px] w-[90px] px-1.5 py-0"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={priceValue}
                                    aria-label={`Price adjustment for ${v.value}`}
                                    onChange={(e) =>
                                      setPriceDraft((d) => ({ ...d, [v.value_id]: e.target.value }))}
                                    onBlur={() => void commitPrice(v)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') void commitPrice(v); }}
                                  />
                                  {draft !== undefined && (
                                    <Button size="sm" variant="outline" onClick={() => void commitPrice(v)}>
                                      Set
                                    </Button>
                                  )}
                                </span>
                              ) : v.inheritedFrom ? (
                                <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                                  +₹{v.inheritedFrom.extra_price.toFixed(2)} from {v.inheritedFrom.name}
                                </span>
                              ) : (
                                <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
        A price of <strong>+₹0.00</strong> means this value adds nothing — it is a set
        figure, not a blank. Values are shared across categories: the same value can be
        offered by several, each at its own price.
      </p>
    </div>
  );
}
