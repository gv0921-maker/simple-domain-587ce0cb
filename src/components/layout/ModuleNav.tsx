import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  findSectionForPath,
  type SettingsNavSection,
} from '@/lib/navigation/settings';

interface NavItem {
  label: string;
  href?: string;
  heading?: boolean;
  children?: NavItem[];
}

export type ModuleNavInput = NavItem[] | SettingsNavSection[];

interface ModuleNavProps {
  items: ModuleNavInput;
}

function isGrouped(items: ModuleNavInput): items is SettingsNavSection[] {
  return items.length > 0 && (items[0] as any).items !== undefined;
}

export function ModuleNav({ items: rawItems }: ModuleNavProps) {
  const location = useLocation();
  const navigate = useNavigate();

  if (!rawItems || rawItems.length === 0) return null;

  // Grouped (settings sections): render only the items in the section that
  // contains the active route. Falls back to the first section's items.
  let items: NavItem[];
  if (isGrouped(rawItems)) {
    const section =
      findSectionForPath(rawItems, location.pathname) ?? rawItems[0];
    items = section.items.map(({ label, href }) => ({ label, href }));
  } else {
    items = rawItems;
  }

  if (items.length === 0) return null;

  // Module root is the first path segment of the first tab. The index tab
  // (usually the module overview/default sub-path) should only match exactly,
  // so it is not underlined for every child route.
  const moduleRoot = useMemo(() => {
    const firstHref = items[0]?.href ?? '';
    return '/' + firstHref.split('/').filter(Boolean)[0];
  }, [items]);

  const indexHref = items[0]?.href ?? '';
  const isIndexTab = (item: NavItem): boolean => item.href === indexHref;

  // Flatten children for active detection & mobile select
  const flatItems: NavItem[] = items.flatMap((i) =>
    i.children && i.children.length > 0 ? [i, ...i.children] : [i],
  ).filter((i) => !i.heading && !!i.href);

  const isItemActive = (item: NavItem): boolean => {
    if (item.heading || !item.href) return false;
    if (isIndexTab(item)) {
      return (
        location.pathname === moduleRoot || location.pathname === item.href
      );
    }
    if (
      location.pathname === item.href ||
      location.pathname.startsWith(item.href + '/')
    )
      return true;
    return (item.children ?? []).some(isItemActive);
  };

  // Pick the longest matching href so nested routes win over parent index.
  const activeItem =
    [...flatItems]
      .sort((a, b) => b.href.length - a.href.length)
      .find((i) => {
        if (i.heading || !i.href) return false;
        if (isIndexTab(i)) {
          return (
            location.pathname === moduleRoot || location.pathname === i.href
          );
        }
        return (
          location.pathname === i.href ||
          location.pathname.startsWith(i.href + '/')
        );
      }) ?? items[0];

  // Scroll arrows
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setShowLeft(scrollLeft > 2);
    setShowRight(scrollLeft + clientWidth < scrollWidth - 2);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
    };
  }, [updateArrows]);

  // Auto-scroll active tab into view
  useEffect(() => {
    const node = activeRef.current;
    const container = scrollRef.current;
    if (!node || !container) return;
    const nLeft = node.offsetLeft;
    const nRight = nLeft + node.offsetWidth;
    const cLeft = container.scrollLeft;
    const cRight = cLeft + container.clientWidth;
    if (nLeft < cLeft + 24) {
      container.scrollTo({ left: Math.max(0, nLeft - 24), behavior: 'smooth' });
    } else if (nRight > cRight - 24) {
      container.scrollTo({
        left: nRight - container.clientWidth + 24,
        behavior: 'smooth',
      });
    }
  }, [location.pathname, items.length]);

  const scrollBy = (dx: number) => {
    scrollRef.current?.scrollBy({ left: dx, behavior: 'smooth' });
  };

  const renderTab = (item: NavItem) => {
    const isActive = isItemActive(item);
    const setRef = (el: HTMLAnchorElement | HTMLButtonElement | null) => {
      if (isActive && el) activeRef.current = el;
    };
    const tabClass = cn(
      'inline-flex items-center gap-1 text-sm font-medium transition-colors duration-150 relative py-2 whitespace-nowrap px-1',
      isActive
        ? 'text-foreground'
        : 'text-muted-foreground hover:text-foreground',
    );

    if (item.children && item.children.length > 0) {
      return (
        <DropdownMenu key={item.label}>
          <DropdownMenuTrigger
            ref={setRef as (el: HTMLButtonElement | null) => void}
            className={cn(tabClass, 'outline-none')}
          >
            {item.label}
            <ChevronDown className="h-3.5 w-3.5" />
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary animate-fade-in" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[200px]">
            {item.children.map((c, idx) => {
              if (c.heading) {
                return (
                  <div
                    key={`h-${c.label}-${idx}`}
                    className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {c.label}
                  </div>
                );
              }
              if (!c.href) return null;
              return (
                <DropdownMenuItem
                  key={c.href}
                  onSelect={() => navigate(c.href!)}
                  className={cn(
                    isItemActive(c) && 'bg-accent text-accent-foreground',
                  )}
                >
                  {c.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    if (!item.href) return null;
    return (
      <Link
        key={item.href}
        to={item.href!}
        ref={setRef as (el: HTMLAnchorElement | null) => void}
        className={tabClass}
      >
        {item.label}
        {isActive && (
          <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary animate-fade-in" />
        )}
      </Link>
    );
  };

  return (
    <>
      {/* Desktop: horizontal scroll with arrow controls */}
      <div className="hidden md:block relative border-b border-border bg-card">
        {showLeft && (
          <button
            type="button"
            aria-label="Scroll tabs left"
            onClick={() => scrollBy(-200)}
            className="absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center w-8 bg-gradient-to-r from-card via-card to-transparent text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <nav
          ref={scrollRef}
          className="flex items-center gap-6 px-4 h-10 overflow-x-auto whitespace-nowrap scrollbar-hide"
        >
          {items.map(renderTab)}
        </nav>
        {showRight && (
          <button
            type="button"
            aria-label="Scroll tabs right"
            onClick={() => scrollBy(200)}
            className="absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center w-8 bg-gradient-to-l from-card via-card to-transparent text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Mobile: dropdown (flattened) */}
      <div className="md:hidden border-b border-border bg-card px-3 py-2">
        <Select value={activeItem.href} onValueChange={(v) => navigate(v)}>
          <SelectTrigger className="w-full h-9 text-sm font-medium">
            <SelectValue>{activeItem.label}</SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-[70vh]">
            {flatItems.map((item) => (
              <SelectItem key={item.href} value={item.href}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
