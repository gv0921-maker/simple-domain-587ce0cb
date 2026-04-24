// Sales service layer — thin re-export of all sales data modules.
//
// Two sources collide on a few names (`getSalesOrder(s)`, `saveSalesOrder`,
// `SalesOrder`, `OrderActivity`):
//   - `@/lib/data/sales`          → legacy module used by SalesOrdersList,
//                                   SalesPipeline, LeadDetail, CustomerForm.
//   - `@/lib/data/sales/storage`  → newer storage layer used by everything
//                                   else (Quotations, SalesOrdersListNew, …).
//
// We re-export the storage + storage types as the modern API, then
// re-export the legacy module under the same names with `Legacy*` aliases
// for the few that collide. Existing imports continue to work because
// callers import their preferred name directly from this service.
export * from '@/lib/data/sales/storage';
export type * from '@/lib/data/sales/types';

// Legacy module — re-export everything explicitly, aliasing the names
// that already exist on the storage layer so both call-sites resolve.
export {
  getContacts,
  getContact,
  saveContact,
  getLeads,
  getLead,
  saveLead,
  updateLeadStatus,
  getOpportunities,
  getOpportunity,
  saveOpportunity,
  getSalesOrders as getLegacySalesOrders,
  getSalesOrder as getLegacySalesOrder,
  saveSalesOrder as saveLegacySalesOrder,
} from '@/lib/data/sales';

export type {
  Contact,
  Lead,
  LeadStatus,
  Opportunity,
  OpportunityStage,
  OpportunityProduct,
  OrderLine,
  OrderStatus,
  Activity,
  SalesOrder as LegacySalesOrder,
} from '@/lib/data/sales';