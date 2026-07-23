// Unified document activity feed used across CRM (non-opportunity), Sales,
// Inventory, and other modules. Backed by the shared `activity_log` table
// via `ActivityChatter`. This is a thin naming adapter so callers use one
// component name regardless of module.
//
// The CRM Opportunity detail page keeps its bespoke inline chatter (backed
// by crm_notes / crm_activities) unchanged.
export { ActivityChatter as DocumentChatter } from '@/components/shared/ActivityChatter';
export type { ActivityRecordType as DocumentType } from '@/lib/services/activityLog';