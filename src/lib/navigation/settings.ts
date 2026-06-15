// Settings Module Navigation — grouped (Odoo-style) with role gating.
//
// Two exports:
//   - SETTINGS_SECTIONS : grouped structure used by the Settings hub
//     (categorised cards) AND by ModuleNav to render only the items of the
//     section the current page belongs to.
//   - SETTINGS_NAV : the same shape, kept under the legacy export name so all
//     existing `moduleNav={SETTINGS_NAV}` call sites keep working — ModuleNav
//     now detects grouped vs flat input.

export type SettingsMinRole =
  | 'any'
  | 'admin_or_super'
  | 'super_admin'
  | 'hr_or_super';

export interface SettingsNavItem {
  label: string;
  href: string;
  minRole?: SettingsMinRole;
  description?: string;
}

export interface SettingsNavSection {
  id: string;
  label: string;
  icon: string; // lucide icon name
  description: string;
  minRole: SettingsMinRole;
  items: SettingsNavItem[];
}

export const SETTINGS_SECTIONS: SettingsNavSection[] = [
  {
    id: 'company',
    label: 'Company',
    icon: 'Building2',
    description: 'Company identity, document numbering, holidays and payment accounts.',
    minRole: 'super_admin',
    items: [
      { label: 'Company Info', href: '/settings/company', minRole: 'super_admin' },
      { label: 'Numbering', href: '/settings/numbering', minRole: 'super_admin' },
      { label: 'Holidays', href: '/settings/holidays', minRole: 'super_admin' },
      { label: 'Payment Accounts', href: '/settings/payment-accounts', minRole: 'super_admin' },
    ],
  },
  {
    id: 'users',
    label: 'Users & Permissions',
    icon: 'Shield',
    description: 'Manage users, roles and review the audit trail.',
    minRole: 'admin_or_super',
    items: [
      { label: 'Users', href: '/settings/users', minRole: 'admin_or_super' },
      { label: 'Roles', href: '/settings/roles', minRole: 'admin_or_super' },
      { label: 'Audit Logs', href: '/audit-logs', minRole: 'super_admin' },
    ],
  },
  {
    id: 'hr',
    label: 'HR',
    icon: 'Users',
    description: 'Work schedules and payroll configuration.',
    minRole: 'hr_or_super',
    items: [
      { label: 'Work Schedules', href: '/settings/work-schedules', minRole: 'super_admin' },
      { label: 'Payroll', href: '/settings/payroll', minRole: 'super_admin' },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    icon: 'ShoppingCart',
    description: 'Vendors, price approvals and CRM pipelines.',
    minRole: 'admin_or_super',
    items: [
      { label: 'Vendors', href: '/settings/vendors', minRole: 'admin_or_super' },
      { label: 'Price Approvals', href: '/settings/price-approvals', minRole: 'super_admin' },
      { label: 'CRM Pipelines', href: '/settings/crm-pipelines', minRole: 'admin_or_super' },
    ],
  },
  {
    id: 'personal',
    label: 'Personal',
    icon: 'User',
    description: 'Your own notification and accessibility preferences.',
    minRole: 'any',
    items: [
      { label: 'Notifications', href: '/settings/notifications', minRole: 'any' },
      { label: 'Accessibility', href: '/settings/accessibility', minRole: 'any' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: 'Cog',
    description: 'Module customisation, form studio and backups.',
    minRole: 'super_admin',
    items: [
      { label: 'Customization', href: '/settings/customization', minRole: 'super_admin' },
      { label: 'Form Studio', href: '/settings/studio', minRole: 'super_admin' },
      { label: 'Backups', href: '/settings/backups', minRole: 'super_admin' },
    ],
  },
];

// Back-compat alias: every existing `moduleNav={SETTINGS_NAV}` keeps working
// because ModuleNav now accepts the grouped shape and auto-picks the section
// containing the active route.
export const SETTINGS_NAV: SettingsNavSection[] = SETTINGS_SECTIONS;

// ---------- Helpers ----------

export interface RoleCaps {
  isSuperAdmin: boolean;
  isAdminOrSuper: boolean;
  isAdminOrHR: boolean;
}

export function userMeetsMinRole(min: SettingsMinRole | undefined, caps: RoleCaps): boolean {
  switch (min) {
    case undefined:
    case 'any':
      return true;
    case 'admin_or_super':
      return caps.isAdminOrSuper;
    case 'super_admin':
      return caps.isSuperAdmin;
    case 'hr_or_super':
      return caps.isAdminOrHR || caps.isSuperAdmin;
    default:
      return false;
  }
}

/** Return the sections + items the user is allowed to see. */
export function filterSettingsSections(
  sections: SettingsNavSection[],
  caps: RoleCaps,
): SettingsNavSection[] {
  return sections
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => userMeetsMinRole(i.minRole ?? s.minRole, caps)),
    }))
    .filter((s) => s.items.length > 0 && userMeetsMinRole(s.minRole, caps));
}

/** Find the section that contains a given pathname (used by ModuleNav). */
export function findSectionForPath(
  sections: SettingsNavSection[],
  pathname: string,
): SettingsNavSection | undefined {
  let best: { section: SettingsNavSection; len: number } | undefined;
  for (const s of sections) {
    for (const i of s.items) {
      if (pathname === i.href || pathname.startsWith(i.href + '/')) {
        if (!best || i.href.length > best.len) best = { section: s, len: i.href.length };
      }
    }
  }
  return best?.section;
}