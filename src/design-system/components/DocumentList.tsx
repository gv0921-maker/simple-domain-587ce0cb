/**
 * DocumentList — the dense Odoo list view.
 *
 * Filter bar with removable chips + search, a view switcher, a record count
 * and pager, then a compact table. Rows are 32px; padding is tight inside the
 * table and generous around the card, per the density brief.
 *
 * The component started life as a presentation-only shell with hard-coded
 * Transfers columns and inert controls. It is now driveable by real pages
 * without losing that default: pass `columns` to define your own table,
 * `search`/`onSearchChange` to control the search box, `onRowClick` to make
 * rows navigate, `onNew` to get the New button, and `onPrevPage`/`onNextPage`
 * to wire the pager. Omit them all and you get exactly the previous demo
 * behaviour, which is what `DesignPreview` relies on.
 */
import * as React from 'react';
import {
  Search, List as ListIcon, LayoutGrid, Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { Avatar, Button, FilterChip, StatusPill, type StatusTone } from './primitives';
import { CogMenu } from './CogMenu';

export interface ListFilter {
  key: string;
  label?: string;
  value: string;
}

/**
 * The demo row shape. Only `id` and `reference` are required — the remaining
 * fields exist for the default Transfers columns and are optional so that a
 * caller supplying its own `columns` is not forced to invent placeholder data.
 */
export interface DocumentRow {
  id: string;
  reference: string;
  contact?: string;
  responsible?: string;
  scheduled?: string;
  sourceDocument?: string;
  status?: string;
  statusTone?: StatusTone;
  /** Renders the scheduled date in red. */
  late?: boolean;
}

/** A caller-defined column. `render` receives the whole row. */
export interface ListColumn<R> {
  key: string;
  label: string;
  /** Width/alignment utilities for the <th>. */
  className?: string;
  render: (row: R) => React.ReactNode;
}

export type ListViewMode = 'list' | 'kanban' | 'calendar';

export interface DocumentListProps<R = DocumentRow> {
  title?: string;
  rows: R[];
  /** Defaults to the Transfers columns, which expect `DocumentRow`. */
  columns?: ListColumn<R>[];
  filters?: ListFilter[];
  onRemoveFilter?: (key: string) => void;
  viewMode?: ListViewMode;
  onViewModeChange?: (m: ListViewMode) => void;
  page?: { from: number; to: number; total: number };
  /** Controlled search. Left uncontrolled (and inert) when omitted. */
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Renders the primary New button in the control bar. */
  onNew?: () => void;
  newLabel?: string;
  onRowClick?: (row: R) => void;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  /** Leading select-all/select-row checkbox column. */
  selectable?: boolean;
  /** Accessible name for a row's checkbox. Defaults to the row reference/id. */
  getRowLabel?: (row: R) => string;
  /** Hide the list/kanban/calendar switcher on views that only have a list. */
  showViewSwitcher?: boolean;
  emptyMessage?: string;
  /** Minimum table width before horizontal scrolling kicks in. */
  minTableWidth?: number;
  className?: string;
}

const VIEWS: { key: ListViewMode; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { key: 'list', icon: ListIcon, label: 'List view' },
  { key: 'kanban', icon: LayoutGrid, label: 'Kanban view' },
  { key: 'calendar', icon: Calendar, label: 'Calendar view' },
];

/** The original hard-coded Transfers columns, kept as the default. */
const DEFAULT_COLS: ListColumn<DocumentRow>[] = [
  {
    key: 'reference',
    label: 'Reference',
    className: 'w-[16%] min-w-[110px]',
    render: (r) => (
      <span className="font-medium text-[hsl(var(--ds-link))] group-hover:underline">
        {r.reference}
      </span>
    ),
  },
  {
    key: 'contact',
    label: 'Contact',
    className: 'w-[20%] min-w-[130px]',
    render: (r) => <span className="block truncate text-[hsl(var(--ds-ink))]">{r.contact}</span>,
  },
  {
    key: 'responsible',
    label: 'Responsible',
    className: 'w-[18%] min-w-[130px]',
    render: (r) => (
      <span className="flex items-center gap-1.5">
        <Avatar name={r.responsible ?? ''} size={18} />
        <span className="truncate text-[hsl(var(--ds-ink))]">{r.responsible}</span>
      </span>
    ),
  },
  {
    key: 'scheduled',
    label: 'Scheduled',
    className: 'w-[15%] min-w-[110px]',
    render: (r) => (
      <span
        className={cn(
          'whitespace-nowrap tabular-nums',
          r.late
            ? 'font-semibold text-[hsl(var(--ds-red))]'
            : 'text-[hsl(var(--ds-ink-muted))]',
        )}
      >
        {r.scheduled}
      </span>
    ),
  },
  {
    key: 'source',
    label: 'Source Document',
    className: 'w-[16%] min-w-[110px]',
    render: (r) => (
      <span className="block truncate text-[hsl(var(--ds-ink-muted))]">
        {r.sourceDocument || '—'}
      </span>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    className: 'w-[15%] min-w-[95px]',
    render: (r) => <StatusPill tone={r.statusTone}>{r.status}</StatusPill>,
  },
];

export function DocumentList<R extends { id: string } = DocumentRow>({
  title = 'Transfers',
  rows,
  columns,
  filters = [],
  onRemoveFilter,
  viewMode = 'list',
  onViewModeChange,
  page,
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  onNew,
  newLabel = 'New',
  onRowClick,
  onPrevPage,
  onNextPage,
  prevDisabled,
  nextDisabled,
  selectable = true,
  getRowLabel,
  showViewSwitcher = true,
  emptyMessage = 'No records match the current filters.',
  minTableWidth = 720,
  className,
}: DocumentListProps<R>) {
  const total = page?.total ?? rows.length;
  const from = page?.from ?? (rows.length ? 1 : 0);
  const to = page?.to ?? rows.length;

  // When no `columns` are supplied the caller is using the demo Transfers
  // shape, so the default columns are valid for it. That is the one place the
  // generic row type has to be taken on trust.
  const cols = (columns ?? (DEFAULT_COLS as unknown as ListColumn<R>[]));

  const rowLabel = (row: R) =>
    getRowLabel?.(row) ?? (row as unknown as DocumentRow).reference ?? row.id;

  const controlledSearch = search !== undefined;

  return (
    <div
      className={cn(
        'bg-[hsl(var(--ds-surface))] border border-[hsl(var(--ds-border))]',
        'rounded-[var(--ds-radius)] overflow-hidden',
        className,
      )}
    >
      {/* ---- control bar ---- */}
      <div className="border-b border-[hsl(var(--ds-border))] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold text-[hsl(var(--ds-ink))]">{title}</h2>

          {onNew && (
            <Button size="sm" variant="primary" onClick={onNew}>
              {newLabel}
            </Button>
          )}

          {/* search + chips */}
          <div
            className={cn(
              'order-last flex min-w-[220px] flex-1 flex-wrap items-center gap-1.5',
              'rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))]',
              'bg-[hsl(var(--ds-surface))] px-2 py-1',
              'focus-within:border-[hsl(var(--ds-primary))]',
              'sm:order-none',
            )}
          >
            <Search className="h-[13px] w-[13px] shrink-0 text-[hsl(var(--ds-ink-subtle))]" />
            {filters.map((f) => (
              <FilterChip
                key={f.key}
                label={f.label}
                value={f.value}
                onRemove={onRemoveFilter ? () => onRemoveFilter(f.key) : undefined}
              />
            ))}
            <input
              type="text"
              {...(controlledSearch
                ? { value: search, onChange: (e) => onSearchChange?.(e.target.value) }
                : {})}
              placeholder={filters.length ? '' : searchPlaceholder}
              aria-label="Search records"
              className={cn(
                'min-w-[60px] flex-1 bg-transparent text-[var(--ds-fs-sm)]',
                'text-[hsl(var(--ds-ink))] placeholder:text-[hsl(var(--ds-ink-subtle))]',
                'focus:outline-none',
              )}
            />
          </div>

          {/* pager */}
          <div className="flex shrink-0 items-center gap-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-muted))]">
            <span className="tabular-nums">
              {from}-{to} / {total}
            </span>
            <div className="flex">
              <button
                type="button"
                onClick={onPrevPage}
                disabled={prevDisabled}
                aria-label="Previous page"
                className="grid h-[20px] w-[18px] place-items-center rounded-l-[2px] border border-[hsl(var(--ds-border))] hover:bg-[hsl(var(--ds-surface-sunken))] disabled:opacity-40 disabled:pointer-events-none"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={onNextPage}
                disabled={nextDisabled}
                aria-label="Next page"
                className="grid h-[20px] w-[18px] place-items-center rounded-r-[2px] border border-l-0 border-[hsl(var(--ds-border))] hover:bg-[hsl(var(--ds-surface-sunken))] disabled:opacity-40 disabled:pointer-events-none"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* view switcher */}
          {showViewSwitcher && (
            <div className="flex shrink-0 overflow-hidden rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border-strong))]">
              {VIEWS.map((v, i) => {
                const active = v.key === viewMode;
                const Icon = v.icon;
                return (
                  <button
                    key={v.key}
                    type="button"
                    aria-label={v.label}
                    aria-pressed={active}
                    title={v.label}
                    onClick={() => onViewModeChange?.(v.key)}
                    className={cn(
                      'grid h-[26px] w-[28px] place-items-center transition-colors',
                      i > 0 && 'border-l border-[hsl(var(--ds-border-strong))]',
                      active
                        ? 'bg-[hsl(var(--ds-primary))] text-[hsl(var(--ds-primary-fg))]'
                        : 'bg-[hsl(var(--ds-surface))] text-[hsl(var(--ds-ink-muted))] hover:bg-[hsl(var(--ds-surface-alt))]',
                    )}
                  >
                    <Icon className="h-[13px] w-[13px]" />
                  </button>
                );
              })}
            </div>
          )}

          <CogMenu bordered />
        </div>
      </div>

      {/* ---- table ---- */}
      <div className="ds-scroll-x">
        <table
          className="w-full border-collapse text-[var(--ds-fs-sm)]"
          style={{ minWidth: minTableWidth }}
        >
          <thead>
            <tr className="bg-[hsl(var(--ds-surface-alt))]">
              {selectable && (
                <th className="w-[28px] border-b border-[hsl(var(--ds-border))] px-2 py-1.5">
                  <input type="checkbox" aria-label="Select all" className="align-middle" />
                </th>
              )}
              {cols.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    'border-b border-[hsl(var(--ds-border))] px-2 py-1.5 text-left',
                    'text-[var(--ds-fs-xs)] font-semibold uppercase tracking-wide',
                    'text-[hsl(var(--ds-ink-subtle))]',
                    c.className,
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn(
                  'group border-b border-[hsl(var(--ds-border)/0.6)]',
                  'hover:bg-[hsl(var(--ds-primary)/0.04)]',
                  onRowClick ? 'cursor-pointer' : 'cursor-default',
                )}
                style={{ height: 'var(--ds-row-h)' }}
              >
                {selectable && (
                  <td className="px-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${rowLabel(r)}`}
                      className="align-middle"
                    />
                  </td>
                )}
                {cols.map((c) => (
                  <td key={c.key} className="px-2">
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={cols.length + (selectable ? 1 : 0)}
                  className="px-3 py-10 text-center text-[hsl(var(--ds-ink-subtle))]"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
