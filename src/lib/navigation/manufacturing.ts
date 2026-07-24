// Shared navigation items for the Manufacturing module
// BOM, Work Centers, Planning and the old /manufacturing/shop-floor screen
// were removed: they read work_orders through the pre-stage-machine
// status/state columns, which nothing writes any more, so they showed empty
// or stale data. The live factory app is /shop-floor.
export const MANUFACTURING_NAV = [
  { label: 'Overview', href: '/manufacturing' },
  { label: 'Work Orders', href: '/manufacturing/work-orders' },
  { label: 'Shop Floor', href: '/shop-floor' },
  { label: 'Reports', href: '/manufacturing/reports' },
];
