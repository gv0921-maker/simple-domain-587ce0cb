/**
 * CogMenu — the Odoo overflow/settings dropdown.
 *
 * Hand-rolled rather than Radix: the design system must not depend on the
 * existing components/ui layer, and this needs only outside-click + Escape.
 * Visual only — every item is a no-op unless a handler is passed.
 *
 * Placement is collision-aware (see ../lib/placement). The menu and its Print
 * submenu are measured when they open and on resize/scroll, then flipped to the
 * other side and/or nudged up so they stay inside the viewport.
 */
import * as React from 'react';
import { Settings, ChevronRight, Printer } from 'lucide-react';
import { cn } from '../lib/cn';
import { chooseSide, verticalShift, type Side } from '../lib/placement';

/** Gap between the parent menu and the submenu, matching the ml-1/mr-1 classes. */
const SUBMENU_GAP = 4;

/**
 * Grace period before an unpinned submenu closes on hover-out. Long enough to
 * cross the offset between trigger and panel without a steady hand, short
 * enough that it never feels stuck.
 */
const SUBMENU_CLOSE_DELAY_MS = 200;

/**
 * Width of the invisible bridge that spans the trigger→panel offset, so the
 * pointer stays inside the hover group's DOM subtree for the whole journey.
 * Slightly wider than SUBMENU_GAP to cover sub-pixel layout rounding.
 */
const SUBMENU_BRIDGE_PX = SUBMENU_GAP + 2;

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
  /**
   * Set by clicking "Print". A pinned submenu ignores hover-out entirely and
   * stays up until an item is chosen, Print is clicked again, Escape is pressed
   * or the user clicks away — which is the reliable path on touch, where there
   * is no hover at all.
   */
  const [printPinned, setPrintPinned] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const submenuAnchorRef = React.useRef<HTMLDivElement>(null);
  const submenuRef = React.useRef<HTMLDivElement>(null);

  /**
   * Hover intent. The submenu renders outside the trigger row's bounding box
   * with a small offset, so travelling from "Print" to the panel crosses a strip
   * that belongs to neither — which fired mouseleave and closed the submenu
   * mid-travel. Trigger and panel are treated as one hover group: leaving either
   * only *schedules* a close, and entering either cancels it.
   */
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelScheduledClose = React.useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openSubmenu = React.useCallback(() => {
    cancelScheduledClose();
    setPrintOpen(true);
  }, [cancelScheduledClose]);

  const scheduleCloseSubmenu = React.useCallback(() => {
    cancelScheduledClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      // A pinned submenu was opened by click and must survive hover-out.
      setPrintPinned((pinned) => {
        if (!pinned) setPrintOpen(false);
        return pinned;
      });
    }, SUBMENU_CLOSE_DELAY_MS);
  }, [cancelScheduledClose]);

  const closeAll = React.useCallback(() => {
    cancelScheduledClose();
    setOpen(false);
    setPrintOpen(false);
    setPrintPinned(false);
  }, [cancelScheduledClose]);

  // Never leave a timer behind on unmount.
  React.useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

  // Applied corrections. Measured against each element's *natural* geometry —
  // the currently applied shift is subtracted back out before deciding, via the
  // functional setState form — so re-measuring converges instead of drifting.
  const [menuShiftY, setMenuShiftY] = React.useState(0);
  const [submenuSide, setSubmenuSide] = React.useState<Side>('right');
  const [submenuShiftY, setSubmenuShiftY] = React.useState(0);

  // The cog sits at the top-right of a form header, so a submenu that always
  // flew out to the right landed past the viewport edge and was unreachable.
  // Measure at open time (and on resize/scroll) and flip when there is no room.
  React.useLayoutEffect(() => {
    if (!open) {
      setMenuShiftY(0);
      return;
    }
    const measure = () => {
      const el = menuRef.current;
      if (!el) return;
      setMenuShiftY((applied) => {
        const rect = el.getBoundingClientRect();
        return verticalShift(rect.top - applied, rect.bottom - applied, window.innerHeight);
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  React.useLayoutEffect(() => {
    if (!open || !printOpen) {
      setSubmenuShiftY(0);
      return;
    }
    const measure = () => {
      const el = submenuRef.current;
      const anchor = submenuAnchorRef.current;
      if (!el || !anchor) return;

      const anchorRect = anchor.getBoundingClientRect();
      // offsetWidth is unaffected by which side we are currently on, so the
      // side decision cannot feed back on itself.
      setSubmenuSide(
        chooseSide(
          anchorRect.left,
          anchorRect.right,
          el.offsetWidth,
          window.innerWidth,
          SUBMENU_GAP,
        ),
      );

      setSubmenuShiftY((applied) => {
        const rect = el.getBoundingClientRect();
        return verticalShift(rect.top - applied, rect.bottom - applied, window.innerHeight);
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, printOpen]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // The submenu renders inside rootRef, so this covers both panels.
      if (!rootRef.current?.contains(e.target as Node)) closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape backs out one level at a time when the submenu is showing.
      if (printOpen) {
        cancelScheduledClose();
        setPrintOpen(false);
        setPrintPinned(false);
        return;
      }
      closeAll();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, printOpen, closeAll, cancelScheduledClose]);

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
        onClick={() => {
          if (open) closeAll();
          else setOpen(true);
        }}
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
          ref={menuRef}
          role="menu"
          style={menuShiftY ? { transform: `translateY(${menuShiftY}px)` } : undefined}
          className={cn(
            'absolute top-[30px] z-50 min-w-[190px] py-1',
            'bg-[hsl(var(--ds-surface))] border border-[hsl(var(--ds-border))]',
            'rounded-[var(--ds-radius)] shadow-[var(--ds-shadow-pop)]',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {/* Print submenu — trigger and panel form one hover group. */}
          <div
            ref={submenuAnchorRef}
            className="relative"
            onMouseEnter={openSubmenu}
            onMouseLeave={scheduleCloseSubmenu}
          >
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={printOpen}
              onClick={() => {
                cancelScheduledClose();
                // Click pins it open; clicking again unpins and closes.
                if (printPinned) {
                  setPrintPinned(false);
                  setPrintOpen(false);
                } else {
                  setPrintPinned(true);
                  setPrintOpen(true);
                }
              }}
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
                ref={submenuRef}
                role="menu"
                onMouseEnter={openSubmenu}
                onMouseLeave={scheduleCloseSubmenu}
                style={submenuShiftY ? { transform: `translateY(${submenuShiftY}px)` } : undefined}
                className={cn(
                  'absolute top-[-4px] z-50 min-w-[175px] py-1',
                  'bg-[hsl(var(--ds-surface))] border border-[hsl(var(--ds-border))]',
                  'rounded-[var(--ds-radius)] shadow-[var(--ds-shadow-pop)]',
                  // Side is measured, not guessed: the previous breakpoint rule
                  // (`sm:left-full`) always opened right on desktop, which is
                  // exactly where the cog sits and where there is no room.
                  submenuSide === 'right' ? 'left-full ml-1' : 'right-full mr-1',
                )}
              >
                {/*
                  Invisible bridge across the trigger→panel offset. Without it
                  the pointer passes over a strip owned by neither element and
                  the hover group breaks. Belongs to the panel, so entering it
                  cancels the scheduled close.
                */}
                <span
                  aria-hidden="true"
                  className="absolute top-0 h-full"
                  style={{
                    width: SUBMENU_BRIDGE_PX,
                    [submenuSide === 'right' ? 'left' : 'right']: -SUBMENU_BRIDGE_PX,
                  }}
                />
                {printItems.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      p.onSelect?.();
                      // Choosing an item dismisses the whole menu, as Odoo does.
                      closeAll();
                    }}
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
