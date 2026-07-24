import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ModuleNav } from '@/components/layout/ModuleNav';

/**
 * Regression tests for "Rendered more hooks than during the previous render".
 *
 * Several components used to bail out early (`if (!x) return null`) *before*
 * calling the rest of their hooks. That is stable only while the guard's value
 * is stable — as soon as it flips on a later render, React sees a different
 * number of hooks and throws, blanking the page.
 *
 * These tests drive each guard from its falsy to its truthy state across a
 * rerender, which is exactly the transition that used to crash.
 */

// jsdom has no ResizeObserver; ModuleNav observes its scroll container.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('hook ordering across guard transitions', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).ResizeObserver = ResizeObserverStub;
    // jsdom implements neither of these; ModuleNav scrolls the active tab
    // into view on mount.
    Element.prototype.scrollTo = () => {};
    Element.prototype.scrollBy = () => {};
    // React logs the hook-order error via console.error before throwing.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('ModuleNav survives going from no items to items', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/sales']}>
        <ModuleNav items={[]} />
      </MemoryRouter>,
    );

    // The empty case renders nothing at all.
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();

    // Populating the nav previously changed the hook count and threw.
    expect(() =>
      rerender(
        <MemoryRouter initialEntries={['/sales']}>
          <ModuleNav
            items={[
              { label: 'Overview', href: '/sales' },
              { label: 'Quotations', href: '/sales/quotations' },
            ]}
          />
        </MemoryRouter>,
      ),
    ).not.toThrow();

    expect(screen.getAllByText('Overview').length).toBeGreaterThan(0);
  });

  it('ModuleNav survives going from items back to no items', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/sales']}>
        <ModuleNav items={[{ label: 'Overview', href: '/sales' }]} />
      </MemoryRouter>,
    );

    expect(() =>
      rerender(
        <MemoryRouter initialEntries={['/sales']}>
          <ModuleNav items={[]} />
        </MemoryRouter>,
      ),
    ).not.toThrow();
  });

  it('does not log a React hook-order error', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/sales']}>
        <ModuleNav items={[]} />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter initialEntries={['/sales']}>
        <ModuleNav items={[{ label: 'Overview', href: '/sales' }]} />
      </MemoryRouter>,
    );

    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toMatch(/more hooks than during the previous render/i);
    expect(logged).not.toMatch(/change in the order of Hooks/i);
  });
});
