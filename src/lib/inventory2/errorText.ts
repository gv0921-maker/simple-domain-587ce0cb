/**
 * Inventory 2 — error text extraction.
 *
 * Lives apart from the form controls so that file exports components only
 * (react-refresh). Mirrors `extractMessage` in App.tsx deliberately: the RPCs
 * in this module raise sentences meant to be read by staff, and both the toast
 * and the inline banner must show the same words.
 */
export function errorText(e: unknown): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  const x = e as { message?: string; hint?: string; details?: string };
  return x.message || x.hint || x.details || String(e);
}
