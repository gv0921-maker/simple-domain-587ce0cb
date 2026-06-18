// Shared navigation items for the Inventory module
export const INVENTORY_NAV = [
  { label: 'Overview', href: '/inventory' },
  { label: 'Stock Dashboard', href: '/inventory/stock-dashboard' },
  { label: 'Products', href: '/inventory/products' },
  { label: 'Stock Moves', href: '/inventory/stock-moves' },
  { label: 'Warehouses', href: '/inventory/warehouses' },
  {
    label: 'Operations',
    href: '/inventory/operations',
    children: [
      { label: 'Operations', href: '/inventory/operations' },
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
      { label: 'Locations', href: '/inventory/locations' },
      { label: 'Adjustments', href: '/inventory/adjustments' },
      { label: 'Reorder Rules', href: '/inventory/reorder-rules' },
      { label: 'Configuration', href: '/inventory/configuration' },
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
