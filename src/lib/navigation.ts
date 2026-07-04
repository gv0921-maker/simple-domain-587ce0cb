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
      { label: 'Warehouses', href: '/inventory/warehouses' },
      { label: 'Locations', href: '/inventory/locations' },
      { label: 'Operation Types', href: '/inventory/setup/operation-types' },
      { heading: true, label: 'Products' },
      { label: 'Product Categories', href: '/inventory/setup/categories' },
      { label: 'Product Attributes', href: '/inventory/setup/attributes' },
      { label: 'Units & Packagings', href: '/inventory/setup/units' },
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

// Shared navigation items for the Barcode module
export const BARCODE_NAV = [
  { label: 'Overview', href: '/barcode' },
  { label: 'Scan & Lookup', href: '/barcode/scan-lookup' },
  { label: 'Labels', href: '/barcode/labels' },
];
