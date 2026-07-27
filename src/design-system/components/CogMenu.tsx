/**
 * CogMenu — the Odoo overflow/settings dropdown.
 *
 * Hand-rolled rather than Radix: the design system must not depend on the
 * existing components/ui layer, and this needs only outside-click + Escape.
 * Visual only — every item is a no-op unless a handler is passed.
 */
import * as React from 'react';
import { Settings, ChevronRight, Printer } from 'lucide-react';
import { cn } from '../lib/cn';

export interface CogMenuItem {
  key: string;
  label: string;
  danger?: boolean;
  onSelect?: () => void;
}

export interface CogMenuProps {
  printItems?: CogMenuItem[];
  items?: CogMenuItem[];
  align?: 'left' | 'right';
  /** Renders a bordered button instead of a bare icon. */
  bordered?: boolean;
}

const DEFAULT_PRINT: CogMenuItem[] = [
  { key: 'picking', label: 'Picking Operations' },
  { key: 'delivery', label: 'Delivery Slip' },
  { key: 'return', label: 'Return slip' },
  { key: 'labels', label: 'Labels' },
];

const DEFAULT_ITEMS: CogMenuItem[] = [
  { key: 'duplicate', label: 'Duplicate' },
  { key: 'unreserve', label: 'Unreserve' },
  { key: 'lock', label: 'Lock' },
  { key: 'scrap', label: 'Scrap' },
  { key: 'split', label: 'Split' },
];

export function CogMenu({
  printItems = DEFAULT_PRINT,
  items = DEFAULT_ITEMS,
  align = 'right',
  bordered = false,
}: CogMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [printOpen, setPrintOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setPrintOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setPrintOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const itemCls = (danger?: boolean) =>
    cn(
      'flex w-full items-center justify-between gap-6 px-3 py-[5px] text-left',
      'text-[var(--ds-fs-sm)] transition-colors',
      danger
        ? 'text-[hsl(var(--ds-red))] hover:bg-[hsl(var(--ds-red-bg))]'
        : 'text-[hsl(var(--ds-ink))] hover:bg-[hsl(var(--ds-surface-sunken))]',
    );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Actions"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'grid h-[26px] w-[26px] place-items-center rounded-[var(--ds-radius)]',
          'text-[hsl(var(--ds-ink-muted))] transition-colors',
          'hover:bg-[hsl(var(--ds-surface-sunken))] hover:text-[hsl(var(--ds-ink))]',
          bordered && 'border border-[hsl(var(--ds-border-strong))]',
          open && 'bg-[hsl(var(--ds-surface-sunken))] text-[hsl(var(--ds-ink))]',
        )}
      >
        <Settings className="h-[15px] w-[15px]" strokeWidth={2} />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute top-[30px] z-50 min-w-[190px] py-1',
            'bg-[hsl(var(--ds-surface))] border border-[hsl(var(--ds-border))]',
            'rounded-[var(--ds-radius)] shadow-[var(--ds-shadow-pop)]',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {/* Print submenu */}
          <div
            className="relative"
            onMouseEnter={() => setPrintOpen(true)}
            onMouseLeave={() => setPrintOpen(false)}
          >
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={printOpen}
              onClick={() => setPrintOpen((v) => !v)}
              className={itemCls()}
            >
              <span className="flex items-center gap-2">
                <Printer className="h-[13px] w-[13px]" />
                Print
              </span>
              <ChevronRight className="h-[13px] w-[13px] opacity-60" />
            </button>

            {printOpen && (
              <div
                role="menu"
                className={cn(
                  'absolute top-[-4px] z-50 min-w-[175px] py-1',
                  'bg-[hsl(var(--ds-surface))] border border-[hsl(var(--ds-border))]',
                  'rounded-[var(--ds-radius)] shadow-[var(--ds-shadow-pop)]',
                  // flip to the left on narrow screens so it never leaves the viewport
                  align === 'right'
                    ? 'right-full mr-1 sm:right-auto sm:left-full sm:ml-1 sm:mr-0'
                    : 'left-full ml-1',
                )}
              >
                {printItems.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    role="menuitem"
                    onClick={p.onSelect}
                    className={itemCls()}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="my-1 h-px bg-[hsl(var(--ds-border))]" />

          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={it.onSelect}
              className={itemCls(it.danger)}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
