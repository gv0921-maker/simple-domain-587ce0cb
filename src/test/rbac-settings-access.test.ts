import { describe, it, expect } from 'vitest';
import {
  getRoles,
  getModuleForPath,
  getRequiredPermissionForPath,
} from '@/lib/data/rbac';

/**
 * Admins were locked out of Settings.
 *
 * DEFAULT_ROLES built the Admin role as "every module except settings", and
 * ProtectedRoute resolves /settings/* through canAccessRoute -> hasPermission,
 * so admins were bounced to '/' from every settings page reached that way.
 *
 * These assertions cover the pure inputs to that decision. The role/user
 * assignment cache is only populated from Supabase, so the end-to-end path is
 * covered by the manual check in the plan's verification section.
 */

const findRole = (id: string) => getRoles().find((r) => r.id === id);
const permFor = (roleId: string, module: string) =>
  findRole(roleId)?.permissions.find((p) => p.module === module);

describe('settings route mapping', () => {
  it.each([
    '/settings',
    '/settings/users',
    '/settings/roles',
    '/settings/customization',
  ])('maps %s to the settings module', (path) => {
    expect(getModuleForPath(path)).toBe('settings');
  });

  it('requires only view level for the settings index', () => {
    expect(getRequiredPermissionForPath('/settings')).toBe('view');
  });

  it('requires admin level for the studio editor', () => {
    // ROUTE_PERMISSION_OVERRIDES singles this one out, so a lesser grant
    // would still deny it.
    expect(getRequiredPermissionForPath('/settings/studio')).toBe('admin');
  });
});

describe('default role permissions for settings', () => {
  it('grants Admin the settings module', () => {
    const perm = permFor('admin', 'settings');
    expect(perm).toBeDefined();
    expect(perm?.level).toBe('admin');
  });

  it('grants Super Admin the settings module', () => {
    expect(permFor('super_admin', 'settings')?.level).toBe('admin');
  });

  it('does not grant Admin a level below what /settings/studio needs', () => {
    // Guards against a future downgrade to 'edit' silently re-breaking studio.
    expect(permFor('admin', 'settings')?.level).toBe(
      getRequiredPermissionForPath('/settings/studio'),
    );
  });

  it('still withholds settings from non-administrative roles', () => {
    expect(permFor('sales_rep', 'settings')).toBeUndefined();
    expect(permFor('warehouse_operator', 'settings')).toBeUndefined();
  });
});
