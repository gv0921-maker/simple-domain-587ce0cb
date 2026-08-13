/**
 * QC Checklists — the full configuration surface.
 * Route: /inventory2/config/checklists
 *
 * Closes the Pass 6 hole. `inv_test_template` has had no UI since it was
 * created, so a new product shipped with NO QC gate at all until someone wrote
 * SQL; Pass 8 made that visible with a warning on the Quality segment, and this
 * is where the warning gets acted on.
 *
 * Sibling of attributes and variants under Setup, for the same reason those two
 * are siblings of each other: a checklist template is its own kind of thing with
 * its own row shape, and mixing it into another list would only obscure both.
 *
 * GLOBAL vs PER-PRODUCT is the distinction the list leads with, because it is
 * the one that surprises people: a template with product_id NULL applies to
 * every product, including ones created later.
 */
import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY2_NAV } from '@/lib/navigation';
import { DocumentList, StatusPill, Button, cn, type ListColumn } from '@/design-system';
import '@/design-system/tokens.css';
import { ErrorBanner } from '@/components/inventory2/formControls';
import { errorText } from '@/lib/inventory2/errorText';
import { ChecklistEditor } from '@/components/inventory2/ChecklistEditor';
import { useInv2Checklists, useSetChecklistActive, useRequiredCheckImpact } from '@/hooks/inventory2/checklists';
import { RequiredCheckWarning } from '@/components/inventory2/RequiredCheckWarning';
import type { ChecklistTemplate } from '@/lib/services/inventory2/checklists';

type Filter = 'active' | 'archived' | 'global' | 'all';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'global', label: 'Global' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'All' },
];

export default function ChecklistsConfigList() {
  const { data: rows = [], isLoading, error } = useInv2Checklists();
  const setActive = useSetChecklistActive();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [editing, setEditing] = useState<ChecklistTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** A required check awaiting restore confirmation. */
  const [restoring, setRestoring] = useState<ChecklistTemplate | null>(null);
  const { data: restoreImpact, isLoading: restoreImpactLoading } = useRequiredCheckImpact(
    restoring?.product_id ?? null,
    !!restoring,
  );

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: rows.length, active: 0, archived: 0, global: 0 };
    for (const r of rows) {
      if (r.is_active) m.active += 1; else m.archived += 1;
      if (!r.product_id) m.global += 1;
    }
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const byFilter = rows.filter((r) =>
      filter === 'all' ? true
      : filter === 'global' ? !r.product_id
      : filter === 'archived' ? !r.is_active
      : r.is_active);
    const q = search.trim().toLowerCase();
    if (!q) return byFilter;
    return byFilter.filter((r) =>
      [r.name, r.description, r.product_name, r.product_sku]
        .some((v) => (v ?? '').toLowerCase().includes(q)));
  }, [rows, filter, search]);

  /**
   * Restore is a SECOND path that can put a required check back into the
   * applicable set, and it does not go through ChecklistEditor — so it needs
   * the same warning, or the confirmation would be trivially sidestepped by
   * archiving and restoring instead of editing.
   *
   * Archiving never needs it: removing a check can only ever make a unit's
   * inspection more complete, never less.
   */
  async function toggle(t: ChecklistTemplate) {
    setActionError(null);
    if (!t.is_active && t.is_required) { setRestoring(t); return; }
    try {
      await setActive.mutateAsync({ id: t.id, isActive: !t.is_active });
    } catch (e) {
      setActionError(errorText(e));
    }
  }

  async function confirmRestore() {
    if (!restoring) return;
    setActionError(null);
    try {
      await setActive.mutateAsync({ id: restoring.id, isActive: true });
      setRestoring(null);
    } catch (e) {
      setActionError(errorText(e));
    }
  }

  const columns: ListColumn<ChecklistTemplate>[] = [
    {
      key: 'name', label: 'Check',
      render: (t) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-[hsl(var(--ds-ink))]">{t.name}</div>
          {t.description && (
            <div className="truncate text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
              {t.description}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'scope', label: 'Applies to', className: 'w-[190px]',
      render: (t) =>
        t.product_id ? (
          <span className="text-[hsl(var(--ds-ink))]">
            {t.product_name ?? '—'}
            {t.product_sku && (
              <span className="text-[hsl(var(--ds-ink-subtle))]"> · {t.product_sku}</span>
            )}
          </span>
        ) : (
          <StatusPill tone="blue">Every product</StatusPill>
        ),
    },
    {
      key: 'rules', label: 'Rules', className: 'w-[210px]',
      render: (t) => (
        <span className="flex flex-wrap gap-1">
          <StatusPill tone={t.is_required ? 'red' : 'grey'}>
            {t.is_required ? 'Required' : 'Advisory'}
          </StatusPill>
          {t.requires_value && <StatusPill tone="amber">Reading</StatusPill>}
          {t.requires_attachment && <StatusPill tone="amber">Photo</StatusPill>}
        </span>
      ),
    },
    {
      key: 'order', label: 'Order', className: 'w-[70px] text-right',
      render: (t) => <span className="tabular-nums">{t.sort_order}</span>,
    },
    {
      key: 'used', label: 'Results', className: 'w-[80px] text-right',
      render: (t) => <span className="tabular-nums">{t.result_count}</span>,
    },
    {
      key: 'status', label: 'Status', className: 'w-[100px]',
      render: (t) => (
        <StatusPill tone={t.is_active ? 'green' : 'grey'}>
          {t.is_active ? 'Active' : 'Archived'}
        </StatusPill>
      ),
    },
    {
      key: 'actions', label: '', className: 'w-[150px]',
      render: (t) => (
        <span className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => { setEditing(t); setCreating(false); }}>
            Edit
          </Button>
          <Button size="sm" variant="subtle" onClick={() => void toggle(t)}>
            {t.is_active ? 'Archive' : 'Restore'}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY2_NAV}>
      <div className="ds-root bg-[hsl(var(--ds-canvas))] min-h-full p-4">
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex items-center gap-1 text-[var(--ds-fs-xs)]">
            <li className="font-semibold text-[hsl(var(--ds-ink))]" aria-current="page">
              QC Checklists
            </li>
          </ol>
        </nav>

        {error && (
          <div className="mb-3">
            <ErrorBanner title="Failed to load checklists" message={errorText(error)} />
          </div>
        )}
        {actionError && (
          <div className="mb-3">
            <ErrorBanner
              title="Could not change the check"
              message={actionError}
              onDismiss={() => setActionError(null)}
            />
          </div>
        )}

        <p className="mb-3 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
          What an inspector is asked to confirm for each unit. A check with no product applies
          to <strong>every</strong> product, including ones created later. A product with no
          applicable check has no QC gate at all — the Quality segment says so on the document.
          Checks are archived, never deleted, so past results stay readable.
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'h-[26px] rounded-[var(--ds-radius)] border px-2.5 text-[var(--ds-fs-xs)] font-medium transition-colors',
                filter === f.key
                  ? 'border-[hsl(var(--ds-primary))] bg-[hsl(var(--ds-primary))] text-[hsl(var(--ds-primary-fg))]'
                  : 'border-[hsl(var(--ds-border-strong))] bg-[hsl(var(--ds-surface))] text-[hsl(var(--ds-ink-muted))] hover:bg-[hsl(var(--ds-surface-alt))]',
              )}
            >
              {f.label}
              <span className="ml-1 tabular-nums opacity-70">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>

        {restoring && (
          <div className="mb-3">
            <RequiredCheckWarning
              isGlobal={restoring.product_id === null}
              productName={restoring.product_name}
              impact={restoreImpact}
              loading={restoreImpactLoading}
              confirmLabel="Restore anyway"
              busy={setActive.isPending}
              onConfirm={() => void confirmRestore()}
              onCancel={() => setRestoring(null)}
            />
          </div>
        )}

        {(creating || editing) && (
          <div className="mb-3 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-surface))] p-3">
            <p className="mb-2 text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
              {editing ? `Edit "${editing.name}"` : 'New check'}
            </p>
            <ChecklistEditor
              template={editing ?? undefined}
              existing={rows}
              onDone={() => { setCreating(false); setEditing(null); }}
              onCancel={() => { setCreating(false); setEditing(null); }}
            />
          </div>
        )}

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <DocumentList<ChecklistTemplate>
            title="QC Checklists"
            rows={filtered}
            columns={columns}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search checks or products…"
            page={{ from: filtered.length ? 1 : 0, to: filtered.length, total: rows.length }}
            onNew={() => { setCreating(true); setEditing(null); }}
            newLabel="New"
            showViewSwitcher={false}
            minTableWidth={940}
            emptyMessage={
              rows.length === 0
                ? 'No checks configured. Until at least one exists, no product has a QC gate.'
                : 'No checks match this filter.'
            }
          />
        )}
      </div>
    </AppLayout>
  );
}
