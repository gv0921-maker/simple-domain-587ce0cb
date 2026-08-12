/**
 * Inventory 2 — how a unit's condition is presented.
 *
 * Kept out of any component file so both the QC screens and the receipt page
 * can share one vocabulary; a unit described as "Quarantined" in one place and
 * "Held" in another is how staff stop trusting the screen.
 */
import type { StatusTone } from '@/design-system';
import type { Database } from '@/integrations/supabase/types';

export type InvStockStatus = Database['public']['Enums']['inv_stock_status'];

export const STATUS_TONE: Record<InvStockStatus, StatusTone> = {
  ok: 'green',
  attention: 'amber',
  quarantined: 'blue',
  rejected: 'red',
  damaged: 'red',
  destroyed: 'red',
  lost: 'grey',
};

export const STATUS_LABEL: Record<InvStockStatus, string> = {
  ok: 'OK',
  attention: 'Attention',
  quarantined: 'Quarantined',
  rejected: 'Rejected',
  damaged: 'Damaged',
  destroyed: 'Destroyed',
  lost: 'Lost',
};

/** Only `ok` counts as sellable. Everything else is on hand but held back. */
export const SELLABLE: InvStockStatus = 'ok';

export function isSellable(s: InvStockStatus): boolean {
  return s === SELLABLE;
}

/** One line explaining what a status means for the business, not the schema. */
export const STATUS_MEANING: Record<InvStockStatus, string> = {
  ok: 'Passed inspection. Available to sell.',
  attention: 'On hand and sellable-adjacent, but an advisory check failed — review before promising it.',
  quarantined: 'On hand, NOT available to sell. Inspection is incomplete.',
  rejected: 'A required check failed. On hand, not sellable.',
  damaged: 'On hand, not sellable.',
  destroyed: 'No longer on hand.',
  lost: 'Unaccounted for.',
};
