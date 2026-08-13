/**
 * Document-number formatting mirror.
 *
 * ⚠ DUPLICATED LOGIC — KEEP IN SYNC WITH SQL.
 *
 * A document number is assembled as
 *   prefix + separator + fy_label + separator + lpad(last_number + 1, padding)
 *
 * and the three inputs come from three different places on the live database:
 *
 *   prefix     a hardcoded CASE, duplicated verbatim in BOTH
 *              public.generate_document_number(text) and
 *              public.preview_next_document_number(text).
 *              NOT a column — nothing on numbering_sequences stores it, so it
 *              cannot be configured without changing those two functions.
 *   separator  numbering_settings.prefix_separator   (global, one row)
 *   padding    numbering_settings.sequential_padding (global, one row)
 *   fy_label   numbering_sequences.fy_label, or get_current_fy_label() for the
 *              current year
 *   counter    numbering_sequences.last_number
 *
 * The map below exists ONLY to render previews of *unsaved* changes, where a
 * round trip is impossible by definition. Anything showing a saved value must
 * use the `preview_next_document_number` RPC instead, so the authoritative
 * answer always comes from the database and the two cannot silently diverge.
 *
 * If the SQL CASE ever changes, this map must change with it.
 */

/** Mirrors the CASE in generate_document_number / preview_next_document_number. */
export const DOCUMENT_PREFIXES: Record<string, string> = {
  sales_order: 'SO',
  quotation: 'QT',
  invoice: 'INV',
  delivery_note: 'DN',
  internal_transfer: 'ITO',
  internal_movement: 'IM',
  vendor_order: 'VO',
  work_order: 'WO',
  return_request: 'RT',
  credit_note: 'CN',
  goods_receipt: 'GR',
  payment_receipt: 'PR',
  correction_order: 'CO',
  stock_count: 'SC',
  write_off: 'WF',
  refund: 'RF',
  exchange: 'EX',
};

/** The SQL falls back to `upper(p_document_type)` for unknown types. */
export function prefixFor(documentType: string): string {
  return DOCUMENT_PREFIXES[documentType.toLowerCase()] ?? documentType.toUpperCase();
}

/** True when the prefix is a real mapping rather than the uppercase fallback. */
export function hasMappedPrefix(documentType: string): boolean {
  return documentType.toLowerCase() in DOCUMENT_PREFIXES;
}

/** Document types the SQL knows a prefix for, for the create dropdown. */
export const KNOWN_DOCUMENT_TYPES = Object.keys(DOCUMENT_PREFIXES).sort();

/** Human labels — "Sales Order" from "sales_order". */
export function documentTypeLabel(documentType: string): string {
  return documentType
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** Client-side mirror of the SQL format expression. Previews only. */
export function formatDocumentNumber(opts: {
  documentType: string;
  fyLabel: string;
  nextNumber: number;
  separator: string;
  padding: number;
}): string {
  const pad = Math.max(1, Math.floor(opts.padding));
  return [
    prefixFor(opts.documentType),
    opts.fyLabel,
    String(Math.max(0, Math.floor(opts.nextNumber))).padStart(pad, '0'),
  ].join(opts.separator);
}

export const DEFAULT_SEPARATOR = '-';
export const DEFAULT_PADDING = 4;
