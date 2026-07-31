// Shared navigation items for the Inventory module
export const INVENTORY_NAV = [
  { label: 'Overview', href: '/inventory' },
  { label: 'Stock Dashboard', href: '/inventory/stock-dashboard' },
  { label: 'Products', href: '/inventory/products' },
  { label: 'Stock Moves', href: '/inventory/stock-moves' },
  {
    label: 'Operations',
    href: '/inventory/operations',
    children: [
      { label: 'Overview', href: '/inventory/operations' },
      { label: 'Goods Receipts', href: '/inventory/goods-receipts' },
      { label: 'Delivery Notes', href: '/inventory/delivery-notes' },
      { label: 'Internal Movements', href: '/inventory/internal-movements' },
    ],
  },
  {
    label: 'Quality',
    href: '/inventory/stock-counts',
    children: [
      { label: 'Correction Orders', href: '/inventory/correction-orders' },
      { label: 'Stock Counts', href: '/inventory/stock-counts' },
      { label: 'Write-offs', href: '/inventory/write-offs' },
    ],
  },
  {
    label: 'Setup',
    href: '/inventory/configuration',
    children: [
      { label: 'Settings', href: '/inventory/configuration' },
      { heading: true, label: 'Warehouse Management' },
      // Rebuilt config pages (design system). The legacy pages stay routed and
      // reachable by direct URL until sign-off — see "Legacy pages pending
      // removal" in docs/REBUILD_MAP.md.
      { label: 'Warehouses', href: '/inventory/config/warehouses' },
      { label: 'Locations', href: '/inventory/config/locations' },
      { label: 'Operation Types', href: '/inventory/config/operation-types' },
      // New entry — the inventory Setup menu had no Numbering link before; the
      // only one lives in SETTINGS_NAV and still points at /settings/numbering.
      // Route is Super Admin-gated, matching the legacy page.
      { label: 'Numbering', href: '/inventory/config/numbering' },
      { heading: true, label: 'Products' },
      // Rebuilt config page; legacy /inventory/setup/categories stays routed by URL.
      { label: 'Product Categories', href: '/inventory/config/categories' },
      // Rebuilt config page; legacy /inventory/setup/attributes stays routed by URL.
      { label: 'Product Attributes', href: '/inventory/config/attributes' },
      // Rebuilt config page; legacy /inventory/setup/units stays routed by URL.
      { label: 'Units & Packagings', href: '/inventory/config/uom' },
      { heading: true, label: 'Replenishment' },
      { label: 'Reorder Rules', href: '/inventory/reorder-rules' },
      { label: 'Adjustments', href: '/inventory/adjustments' },
    ],
  },
  {
    label: 'Reports',
    href: '/inventory/reports',
    children: [
      { label: 'Reporting', href: '/inventory/reporting' },
      { label: 'Reports', href: '/inventory/reports' },
    ],
  },
];
