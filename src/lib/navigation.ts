// Navigation for the LEGACY Inventory module (/inventory/*).
//
// The Setup group used to carry the rebuilt config pages. Those now live at
// /inventory2/config/* and appear in INVENTORY2_NAV below — one config surface,
// owned by the new module. Legacy pages still READ the same config tables; they
// have simply lost their edit links. The old /inventory/config/* URLs redirect,
// so nothing here is a dead end.
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

// Navigation for INVENTORY 2 (/inventory2/*) — the rebuilt module.
//
// Its own menu rather than a shared one: while both modules used INVENTORY_NAV
// the two felt like one system with duplicate entries ("Goods Receipts" next to
// "Goods Receipts (v2)"), which is exactly the ambiguity this consolidation
// exists to remove. A page belongs to whichever nav it renders.
//
// The route prefix stays /inventory2 until go-live, so the labels here are the
// plain business names — there is no "(v2)" suffix, because within this menu
// there is nothing to disambiguate against.
export const INVENTORY2_NAV = [
  {
    label: 'Operations',
    href: '/inventory2/receipts',
    children: [
      { label: 'Receipts', href: '/inventory2/receipts' },
      { label: 'Barcode', href: '/inventory2/barcode' },
    ],
  },
  { label: 'Products', href: '/inventory2/products' },
  { label: 'Quality', href: '/inventory2/qc' },
  {
    label: 'Setup',
    href: '/inventory2/config/warehouses',
    children: [
      { heading: true, label: 'Warehouse Management' },
      { label: 'Warehouses', href: '/inventory2/config/warehouses' },
      { label: 'Locations', href: '/inventory2/config/locations' },
      { label: 'Operation Types', href: '/inventory2/config/operation-types' },
      // Super Admin-gated at the route; shown to everyone and refused there
      // rather than hidden, so a missing page is explained instead of absent.
      { label: 'Numbering', href: '/inventory2/config/numbering' },
      { heading: true, label: 'Products' },
      { label: 'Product Categories', href: '/inventory2/config/categories' },
      // Two sibling entries, not one mixed list: attributes are the global
      // vocabulary, a variant belongs to exactly one product.
      { label: 'Product Attributes', href: '/inventory2/config/attributes' },
      { label: 'Product Variants', href: '/inventory2/config/variants' },
      { label: 'Units & Packagings', href: '/inventory2/config/uom' },
    ],
  },
];
