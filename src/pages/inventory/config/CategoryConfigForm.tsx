/**
 * Product Category — form view (rebuilt on the design system).
 *
 * Fields are the real columns: name, parent_category_id, description,
 * sort_order, is_active.
 *
 * ⚠ CLOBBER GUARD. `saveCategory` builds a COMPLETE payload with `?? default`
 * on every column, so an update omitting a field overwrites it (parentCategoryId
 * would flatten to root, isActive to true, sortOrder to 0). This form therefore
 * loads the record and submits every column explicitly — load-spread-patch —
 * so nothing can be silently defaulted. Do not partially submit through this
 * service.
 *
 * A category may not be its own parent, nor be reparented under one of its own
 * descendants; the dropdown excludes both.
 *
 * Route: /inventory/config/categories/:id, where :id === 'new' creates.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useProductCategories, useSaveProductCategory } from '@/hooks/inventory/config';
import type { ProductCategory } from '@/lib/services/inventory/categories';
import { DocumentHeader, DocumentFields, type DocumentField } from '@/design-system';
import '@/design-system/tokens.css';
import { categoryPath, descendantIdsOf, indexById } from './configMeta';

const LIST_PATH = '/inventory/config/categories';

const controlClass =
  'w-full rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))] ' +
  'bg-[hsl(var(--ds-surface))] px-2 py-[3px] text-[var(--ds-fs-sm)] ' +
  'text-[hsl(var(--ds-ink))] placeholder:text-[hsl(var(--ds-ink-subtle))] ' +
  'focus:border-[hsl(var(--ds-primary))] focus:outline-none';

interface FormState {
  name: string;
  parentCategoryId: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

const EMPTY: FormState = {
  name: '',
  parentCategoryId: '',
  description: '',
  sortOrder: 0,
  isActive: true,
};

function fromRecord(c: ProductCategory): FormState {
  return {
    name: c.name,
    parentCategoryId: c.parentCategoryId ?? '',
    description: c.description ?? '',
    sortOrder: c.sortOrder,
    isActive: c.isActive,
  };
}

export default function CategoryConfigForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const query = useProductCategories();
  const saveMut = useSaveProductCategory();

  const categories = useMemo(() => query.data ?? [], [query.data]);
  const byId = useMemo(() => indexById(categories), [categories]);
  const current = useMemo(
    () => (isNew ? undefined : categories.find((c) => c.id === id)),
    [categories, id, isNew],
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

  const blockedParents = useMemo(
    () => (current ? descendantIdsOf(current.id, categories) : new Set<string>()),
    [current, categories],
  );

  const parentOptions = useMemo(
    () =>
      categories
        .filter((c) => !blockedParents.has(c.id))
        .map((c) => ({ id: c.id, label: categoryPath(c, byId) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [categories, blockedParents, byId],
  );

  const index = current ? categories.findIndex((c) => c.id === current.id) : -1;
  const goToIndex = (next: number) => {
    const target = categories[next];
    if (target) navigate(`${LIST_PATH}/${target.id}`);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = () => {
    setValidationError(null);
    const name = form.name.trim();
    if (!name) {
      setValidationError('Category name is required.');
      return;
    }
    // Every column is sent explicitly — saveCategory would default anything omitted.
    saveMut.mutate(
      {
        ...(current ? { id: current.id } : {}),
        name,
        parentCategoryId: form.parentCategoryId || null,
        description: form.description.trim() || null,
        sortOrder: Math.floor(form.sortOrder) || 0,
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
      key: 'parent',
      label: 'Parent Category',
      value: (
        <select
          className={controlClass}
          value={form.parentCategoryId}
          onChange={(e) => set('parentCategoryId', e.target.value)}
          aria-label="Parent Category"
        >
          <option value="">— None (top level) —</option>
          {parentOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'description',
      label: 'Description',
      value: (
        <input
          className={controlClass}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Optional"
          aria-label="Description"
        />
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
          value={form.sortOrder}
          onChange={(e) => set('sortOrder', Number(e.target.value))}
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
          checked={form.isActive}
          onChange={(e) => set('isActive', e.target.checked)}
          aria-label="Active"
        />
      ),
    },
  ];

  const headerTitle = isNew ? 'New' : current ? categoryPath(current, byId) : '…';

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="ds-root bg-[hsl(var(--ds-canvas))] min-h-full p-4">
        <DocumentHeader
          breadcrumb={['Product Categories', isNew ? 'New' : current?.name ?? '…']}
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
          stages={[]}
          currentStage=""
          pager={
            index >= 0
              ? {
                  index: index + 1,
                  total: categories.length,
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
              Category not found.
            </p>
          ) : (
            <>
              <div className="px-3 pt-3">
                <label htmlFor="cat-name" className="sr-only">
                  Category Name
                </label>
                <input
                  id="cat-name"
                  className={
                    'w-full border-0 border-b border-transparent bg-transparent px-0 py-1 ' +
                    'text-[26px] font-semibold leading-tight text-[hsl(var(--ds-ink))] ' +
                    'placeholder:text-[hsl(var(--ds-ink-subtle))] ' +
                    'hover:border-[hsl(var(--ds-border))] ' +
                    'focus:border-[hsl(var(--ds-primary))] focus:outline-none'
                  }
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Seating"
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
