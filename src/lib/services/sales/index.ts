// Sales service — mirrors `@/lib/data/sales` (legacy module: contacts,
// leads (sales-side), opportunities, sales orders).
export * from '@/lib/data/sales';

// New Supabase-backed async API (consumed via @/hooks/sales).
// Namespaced to avoid colliding with legacy sync exports above.
export * as salesApi from './api';

// B2C engines & validators (Phase 1)
export {
  determineGSTType,
  calculateLineTax,
  calculateOrderTotals,
} from '@/lib/sales/gstCalculator';
export {
  validatePhone,
  formatPhone,
  splitPhone,
  PHONE_PREFIXES,
} from '@/lib/sales/phoneValidation';
export { validateGSTIN } from '@/lib/sales/gstinValidation';