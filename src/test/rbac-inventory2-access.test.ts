import { describe, it, expect } from 'vitest';
import { getModuleForPath, getRequiredPermissionForPath } from '@/lib/data/rbac';
import { getModuleTabs } from '@/lib/data/moduleTabs';

/**
 * /inventory2 was outside RBAC entirely.
 *
 * getModuleForPath matches `normalized === prefix || normalized.startsWith(prefix + '/')`.
 * '/inventory2/receipts' satisfies neither test against '/inventory', so it
 * resolved to null, and canAccessRoute treats an unmapped route as open. Every
 * page of the rebuilt module was therefore reachable by any authenticated user
 * from the first /inventory2 route until the prefix below was added.
 *
 * These assertions cover the pure inputs to that decision — the role/user cache
 * is only populated from Supabase, so the end-to-end path is verified manually.
 */

const INV2_PAGES = [
  '/inventory2/receipts',
  '/inventory2/receipts/abc-123',
  '/inventory2/qc',
  '/inventory2/barcode',
  '/inventory2/products',
  '/inventory2/products/abc-123',
];

describe('inventory2 route mapping', () => {
  it.each(INV2_PAGES)('maps %s to the inventory module', (path) => {
    expect(getModuleForPath(path)).toBe('inventory');
  });

  it('maps the config subtree that arrives with the page move', () => {
    expect(getModuleForPath('/inventory2/config/warehouses')).toBe('inventory');
    expect(getModuleForPath('/inventory2/config/attributes/new')).toBe('inventory');
  });

  it('does not let /inventory2 fall through to the legacy /inventory prefix', () => {
    // The bug this guards: adding '/inventory2' AFTER '/inventory' would be a
    // no-op if '/inventory' matched first. It cannot, but assert it so a future
    // reorder or a looser matcher is caught here rather than in production.
    expect(getModuleForPath('/inventory2')).toBe('inventory');
    expect(getModuleForPath('/inventory')).toBe('inventory');
  });

  it('still maps the legacy module and leaves other modules alone', () => {
    expect(getModuleForPath('/inventory/products')).toBe('inventory');
    expect(getModuleForPath('/barcode/labels')).toBe('inventory');
    expect(getModuleForPath('/crm/contacts')).toBe('crm');
    expect(getModuleForPath('/sales/orders')).toBe('sales');
  });
});

describe('inventory2 required permission levels', () => {
  it.each(INV2_PAGES)('requires only view for %s', (path) => {
    expect(getRequiredPermissionForPath(path)).toBe('view');
  });

  it.each([
    '/inventory2/receipts/new',
    '/inventory2/products/new',
    '/inventory2/config/warehouses/new',
  ])('requires create for %s', (path) => {
    // Consequence accepted with V on the Pass 10 consolidation: a view-only
    // role (Sales Manager, Read Only) can no longer open these create forms.
    // That matches how /inventory/adjustments/new already behaves for them.
    expect(getRequiredPermissionForPath(path)).toBe('create');
  });
});

describe('inventory2 tab coverage', () => {
  const tabs = getModuleTabs('inventory');

  it.each([
    ['/inventory2/receipts', 'inv2-receipts'],
    ['/inventory2/products', 'inv2-products'],
    ['/inventory2/qc', 'inv2-qc'],
    ['/inventory2/barcode', 'inv2-barcode'],
    ['/inventory2/config', 'inv2-config'],
  ])('declares a tab whose href covers %s', (path, tabId) => {
    const tab = tabs.find((t) => t.id === tabId);
    expect(tab, `tab ${tabId} must exist`).toBeDefined();
    expect(path === tab!.href || path.startsWith(`${tab!.href}/`)).toBe(true);
  });

  it('covers every inventory2 page with some tab', () => {
    // Without this, getTabFromPath returns null and canAccessRoute falls into
    // the hasExplicitTabRestriction branch — inert today only because
    // tabPermissions is hardcoded to [] for every role.
    for (const path of [...INV2_PAGES, '/inventory2/config/uom']) {
      const covered = tabs.some(
        (t) => path === t.href || path.startsWith(`${t.href}/`),
      );
      expect(covered, `no tab covers ${path}`).toBe(true);
    }
  });

  it('keeps the legacy inventory tabs intact', () => {
    for (const id of ['overview', 'products', 'operations', 'configuration']) {
      expect(tabs.some((t) => t.id === id)).toBe(true);
    }
  });
});
