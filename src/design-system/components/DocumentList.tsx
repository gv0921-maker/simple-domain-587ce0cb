/**
 * DocumentList — the dense Odoo list view.
 *
 * Filter bar with removable chips + search, a view switcher, a record count
 * and pager, then a compact table. Rows are 32px; padding is tight inside the
 * table and generous around the card, per the density brief.
 */
import * as React from 'react';
import {
  Search, List as ListIcon, LayoutGrid, Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { Avatar, FilterChip, StatusPill, type StatusTone } from './primitives';
import { CogMenu } from './CogMenu';

export interface ListFilter {
  key: string;
  label?: string;
  value: string;
}

export interface DocumentRow {
  id: string;
  reference: string;
  contact: string;
  responsible: string;
  scheduled: string;
  sourceDocument: string;
  status: string;
  statusTone: StatusTone;
  /** Renders the scheduled date in red. */
  late?: boolean;
}

export type ListViewMode = 'list' | 'kanban' | 'calendar';

export interface DocumentListProps {
  title?: string;
  rows: DocumentRow[];
  filters?: ListFilter[];
  onRemoveFilter?: (key: string) => void;
  viewMode?: ListViewMode;
  onViewModeChange?: (m: ListViewMode) => void;
  page?: { from: number; to: number; total: number };
  className?: string;
}

const VIEWS: { key: ListViewMode; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { key: 'list', icon: ListIcon, label: 'List view' },
  { key: 'kanban', icon: LayoutGrid, label: 'Kanban view' },
  { key: 'calendar', icon: Calendar, label: 'Calendar view' },
];

const COLS = [
  { key: 'reference', label: 'Reference', className: 'w-[16%] min-w-[110px]' },
  { key: 'contact', label: 'Contact', className: 'w-[20%] min-w-[130px]' },
  { key: 'responsible', label: 'Responsible', className: 'w-[18%] min-w-[130px]' },
  { key: 'scheduled', label: 'Scheduled', className: 'w-[15%] min-w-[110px]' },
  { key: 'source', label: 'Source Document', className: 'w-[16%] min-w-[110px]' },
  { key: 'status', label: 'Status', className: 'w-[15%] min-w-[95px]' },
];

export function DocumentList({
  title = 'Transfers',
  rows,
  filters = [],
  onRemoveFilter,
  viewMode = 'list',
  onViewModeChange,
  page,
  className,
}: DocumentListProps) {
  const total = page?.total ?? rows.length;
  const from = page?.from ?? (rows.length ? 1 : 0);
  const to = page?.to ?? rows.length;

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
              placeholder={filters.length ? '' : 'Search…'}
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
                aria-label="Previous page"
                className="grid h-[20px] w-[18px] place-items-center rounded-l-[2px] border border-[hsl(var(--ds-border))] hover:bg-[hsl(var(--ds-surface-sunken))]"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Next page"
                className="grid h-[20px] w-[18px] place-items-center rounded-r-[2px] border border-l-0 border-[hsl(var(--ds-border))] hover:bg-[hsl(var(--ds-surface-sunken))]"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* view switcher */}
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

          <CogMenu bordered />
        </div>
      </div>

      {/* ---- table ---- */}
      <div className="ds-scroll-x">
        <table className="w-full min-w-[720px] border-collapse text-[var(--ds-fs-sm)]">
          <thead>
            <tr className="bg-[hsl(var(--ds-surface-alt))]">
              <th className="w-[28px] border-b border-[hsl(var(--ds-border))] px-2 py-1.5">
                <input type="checkbox" aria-label="Select all" className="align-middle" />
              </th>
              {COLS.map((c) => (
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
                className={cn(
                  'group cursor-pointer border-b border-[hsl(var(--ds-border)/0.6)]',
                  'hover:bg-[hsl(var(--ds-primary)/0.04)]',
                )}
                style={{ height: 'var(--ds-row-h)' }}
              >
                <td className="px-2">
                  <input type="checkbox" aria-label={`Select ${r.reference}`} className="align-middle" />
                </td>
                <td className="px-2 font-medium text-[hsl(var(--ds-link))] group-hover:underline">
                  {r.reference}
                </td>
                <td className="truncate px-2 text-[hsl(var(--ds-ink))]">{r.contact}</td>
                <td className="px-2">
                  <span className="flex items-center gap-1.5">
                    <Avatar name={r.responsible} size={18} />
                    <span className="truncate text-[hsl(var(--ds-ink))]">{r.responsible}</span>
                  </span>
                </td>
                <td
                  className={cn(
                    'whitespace-nowrap px-2 tabular-nums',
                    r.late
                      ? 'font-semibold text-[hsl(var(--ds-red))]'
                      : 'text-[hsl(var(--ds-ink-muted))]',
                  )}
                >
                  {r.scheduled}
                </td>
                <td className="truncate px-2 text-[hsl(var(--ds-ink-muted))]">
                  {r.sourceDocument || '—'}
                </td>
                <td className="px-2">
                  <StatusPill tone={r.statusTone}>{r.status}</StatusPill>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={COLS.length + 1}
                  className="px-3 py-10 text-center text-[hsl(var(--ds-ink-subtle))]"
                >
                  No records match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
