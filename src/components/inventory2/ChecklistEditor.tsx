/**
 * Inventory 2 — QC checklist template editor. Pass 11.
 *
 * Shared by the config surface (any product, plus globals) and the product
 * form's Quality tab (one product, fixed). The difference is one prop:
 * `lockedProductId`. When set, the scope selector disappears and the template
 * can only be created for that product — the product form is not a place to
 * accidentally create a global rule that applies to the whole catalogue.
 *
 * SCOPE IS SET ON CREATE AND NEVER EDITED. Moving a template between a product
 * and global, or between products, would retroactively change what every
 * recorded inv_test_result was a check OF. The service refuses to patch
 * product_id for the same reason; on edit the scope shows as a read-only line
 * with that explanation.
 */
import { useEffect, useState } from 'react';
import { Button, StatusPill, cn } from '@/design-system';
import { Field, TextInput, TextArea, SelectInput, ErrorBanner } from './formControls';
import { errorText } from '@/lib/inventory2/errorText';
import {
  useCreateChecklist, useUpdateChecklist, useInv2ChecklistProducts, useRequiredCheckImpact,
} from '@/hooks/inventory2/checklists';
import { RequiredCheckWarning } from './RequiredCheckWarning';
import type { ChecklistTemplate } from '@/lib/services/inventory2/checklists';

export interface ChecklistEditorProps {
  /** Fixes the scope to one product and hides the selector. */
  lockedProductId?: string;
  lockedProductName?: string | null;
  /** Editing an existing template. Omit to create. */
  template?: ChecklistTemplate;
  /** Used to suggest the next sort_order so new rows land at the bottom. */
  existing: ChecklistTemplate[];
  onDone: () => void;
  onCancel: () => void;
}

const GLOBAL = '__global__';

export function ChecklistEditor({
  lockedProductId, lockedProductName, template, existing, onDone, onCancel,
}: ChecklistEditorProps) {
  const isEdit = !!template;
  const { data: products = [] } = useInv2ChecklistProducts();
  const create = useCreateChecklist();
  const update = useUpdateChecklist();
  const saving = create.isPending || update.isPending;

  const [scope, setScope] = useState<string>(lockedProductId ?? GLOBAL);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isRequired, setIsRequired] = useState(true);
  const [requiresValue, setRequiresValue] = useState(false);
  const [requiresAttachment, setRequiresAttachment] = useState(false);
  const [sortOrder, setSortOrder] = useState(10);
  const [isActive, setIsActive] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (template) {
      setScope(template.product_id ?? GLOBAL);
      setName(template.name);
      setDescription(template.description ?? '');
      setIsRequired(template.is_required);
      setRequiresValue(template.requires_value);
      setRequiresAttachment(template.requires_attachment);
      setSortOrder(template.sort_order);
      setIsActive(template.is_active);
      return;
    }
    // New: land at the bottom of the existing list, in tens so a later insert
    // between two rows does not need every row renumbered.
    const maxSort = existing.reduce((m, t) => Math.max(m, t.sort_order), 0);
    setSortOrder(maxSort + 10);
  }, [template, existing]);

  const canSubmit = !!name.trim() && !saving;

  /**
   * Does saving put a REQUIRED check into the applicable set that was not there
   * before? Three transitions do:
   *   - creating one that is required and active
   *   - promoting an active advisory check to required
   *   - un-archiving a check that is required
   * Editing the name of an already-live required check does not, because the
   * applicable set is unchanged.
   *
   * Advisory checks never qualify — see requiredCheckImpact for why the RPC
   * makes that safe.
   */
  const scopeProductId = isEdit ? (template!.product_id) : (scope === GLOBAL ? null : scope);
  const wasLiveRequired = isEdit && template!.is_required && template!.is_active;
  const willBeLiveRequired = isRequired && isActive;
  const needsWarning = willBeLiveRequired && !wasLiveRequired;

  const [pendingConfirm, setPendingConfirm] = useState(false);
  const { data: impact, isLoading: impactLoading } = useRequiredCheckImpact(
    scopeProductId,
    pendingConfirm,
  );

  function onSubmitClick() {
    if (needsWarning) { setPendingConfirm(true); return; }
    void submit();
  }

  async function submit() {
    setPendingConfirm(false);
    setFailure(null);
    try {
      if (isEdit && template) {
        await update.mutateAsync({
          id: template.id,
          patch: {
            name,
            description,
            is_required: isRequired,
            requires_value: requiresValue,
            requires_attachment: requiresAttachment,
            sort_order: sortOrder,
            is_active: isActive,
          },
        });
      } else {
        await create.mutateAsync({
          product_id: scope === GLOBAL ? null : scope,
          name,
          description,
          is_required: isRequired,
          requires_value: requiresValue,
          requires_attachment: requiresAttachment,
          sort_order: sortOrder,
          is_active: isActive,
        });
      }
      onDone();
    } catch (e) {
      setFailure(errorText(e));
    }
  }

  const scopeLabel = template
    ? (template.product_id
        ? `${template.product_name ?? 'This product'}${template.product_sku ? ` (${template.product_sku})` : ''}`
        : 'Global — applies to every product')
    : null;

  return (
    <div className="space-y-2">
      {failure && (
        <ErrorBanner
          title={isEdit ? 'Could not save the check' : 'Could not create the check'}
          message={failure}
          onDismiss={() => setFailure(null)}
        />
      )}

      {isEdit ? (
        <Field label="Applies to">
          <div className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">{scopeLabel}</div>
          <p className="mt-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
            Scope cannot be changed. Moving a check between products — or to global — would
            change what every result already recorded against it was a check of. Archive this
            one and create a replacement instead.
          </p>
        </Field>
      ) : lockedProductId ? (
        <Field label="Applies to">
          <div className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink))]">
            {lockedProductName ?? 'This product'}
          </div>
          <p className="mt-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
            Global checks that apply to every product are created under Setup → QC Checklists.
          </p>
        </Field>
      ) : (
        <Field label="Applies to" required htmlFor="c-scope">
          <SelectInput id="c-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value={GLOBAL}>Global — every product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
            ))}
          </SelectInput>
        </Field>
      )}

      <Field label="Check" required htmlFor="c-name" hint="What the inspector is being asked to confirm.">
        <TextInput
          id="c-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Frame integrity"
        />
      </Field>

      <Field label="Guidance" htmlFor="c-desc" hint="Optional. Shown to the inspector alongside the check.">
        <TextArea id="c-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <div className="grid gap-x-8 md:grid-cols-2">
        <div>
          <Field
            label="Required"
            htmlFor="c-required"
            hint="Required: a failure rejects the unit, and leaving it unanswered keeps the unit quarantined. Advisory: a failure only flags it for attention."
          >
            <SelectInput
              id="c-required"
              value={isRequired ? 'yes' : 'no'}
              onChange={(e) => setIsRequired(e.target.value === 'yes')}
            >
              <option value="yes">Required — failure rejects the unit</option>
              <option value="no">Advisory — failure flags for attention</option>
            </SelectInput>
          </Field>

          <Field label="Order" htmlFor="c-sort" hint="Lower numbers first. Tens leave room to insert later.">
            <TextInput
              id="c-sort"
              type="number"
              step="10"
              min="0"
              value={String(sortOrder)}
              onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
            />
          </Field>
        </div>

        <div>
          <Field label="Needs a reading" htmlFor="c-value" hint="The inspector must type a measurement, not just pass or fail.">
            <SelectInput
              id="c-value"
              value={requiresValue ? 'yes' : 'no'}
              onChange={(e) => setRequiresValue(e.target.value === 'yes')}
            >
              <option value="no">No reading</option>
              <option value="yes">Reading required</option>
            </SelectInput>
          </Field>

          <Field label="Needs a photo" htmlFor="c-attach" hint="The inspector must attach evidence before the check can be submitted.">
            <SelectInput
              id="c-attach"
              value={requiresAttachment ? 'yes' : 'no'}
              onChange={(e) => setRequiresAttachment(e.target.value === 'yes')}
            >
              <option value="no">No photo</option>
              <option value="yes">Photo required</option>
            </SelectInput>
          </Field>

          {isEdit && (
            <Field label="Status" htmlFor="c-active" hint="Archived checks stop appearing on new inspections. Past results are kept.">
              <SelectInput
                id="c-active"
                value={isActive ? 'yes' : 'no'}
                onChange={(e) => setIsActive(e.target.value === 'yes')}
              >
                <option value="yes">Active</option>
                <option value="no">Archived</option>
              </SelectInput>
            </Field>
          )}
        </div>
      </div>

      {isEdit && template!.result_count > 0 && (
        <div
          className={cn(
            'rounded-[var(--ds-radius)] border border-[hsl(var(--ds-blue)/0.4)]',
            'bg-[hsl(var(--ds-blue-bg))] px-3 py-2 text-[var(--ds-fs-sm)]',
          )}
        >
          <StatusPill tone="blue">{template!.result_count} recorded</StatusPill>{' '}
          <span className="text-[hsl(var(--ds-ink))]">
            results already reference this check. Renaming it changes how those historical
            results read; archiving keeps them intact and simply stops it appearing on new
            inspections.
          </span>
        </div>
      )}

      {pendingConfirm ? (
        <RequiredCheckWarning
          isGlobal={scopeProductId === null}
          productName={
            isEdit
              ? template!.product_name
              : (lockedProductName ?? products.find((p) => p.id === scope)?.name)
          }
          impact={impact}
          loading={impactLoading}
          confirmLabel={isEdit ? 'Save anyway' : 'Add check anyway'}
          busy={saving}
          onConfirm={() => void submit()}
          onCancel={() => setPendingConfirm(false)}
        />
      ) : (
        <div className="flex items-center gap-2 border-t border-[hsl(var(--ds-border))] pt-3">
          <Button variant="primary" onClick={onSubmitClick} disabled={!canSubmit}>
            {saving ? 'Saving…' : isEdit ? 'Save' : 'Add check'}
          </Button>
          <Button variant="subtle" onClick={onCancel}>Cancel</Button>
        </div>
      )}
    </div>
  );
}
