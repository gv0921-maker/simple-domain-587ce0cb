/**
 * Inventory 2 — the scan screen's early route refusal.
 *
 * A pure function in its own module so it can be tested without mounting the
 * scan page. It has no imports beyond types and no I/O: everything it needs
 * was already fetched with the document.
 */
import type { ResolvedUnit, ScanDocument } from '@/lib/services/inventory2/scan';

/**
 * Why this unit cannot be scanned onto this document, or null to proceed.
 *
 * ── THIS IS A MESSAGE, NOT THE ENFORCEMENT ────────────────────────────────
 * THE SERVER IS THE AUTHORITY, and it is not this function.
 * `inv_transfer_stock_item` calls `inv_route_is_legal` at the single choke
 * point that writes `inv_stock_item.location_id` and `inv_stock_tracking`, and
 * it refuses there whatever this screen decides. Route enforcement does not
 * depend on this code running, or on it being right.
 *
 * What this buys is WHEN the operator finds out: at the bay, holding the unit,
 * with the remedy in the sentence — instead of after a round trip. That is the
 * entire value, and it is a real one, but it is presentation.
 *
 * DO NOT "optimise" by trusting a pass here. Specifically: do not skip the
 * server call because this returned null, and do not weaken the server check
 * because the screen now filters. `doc` is a cached snapshot — a session left
 * open for an hour holds an hour-old allowed-set, and the unit may have moved
 * since it was fetched. Only the server reads the unit at the moment it moves.
 *
 * ── IT MUST NEVER BE NARROWER THAN THE SERVER ─────────────────────────────
 * `allowed_from_location_ids` is a deliberate SUPERSET of what
 * `inv_route_is_legal` permits (the authority is a pair check over both ends of
 * the move; a flat set cannot express a pair). The asymmetry is safe in exactly
 * one direction — too generous means a late refusal, too narrow means a LAWFUL
 * unit refused at the bay with no way past it. Hence the empty-set rule below,
 * and hence the membership test being nothing but a membership test.
 *
 * NO HIERARCHY WALK HAPPENS HERE. `inv_location_ancestors` is the single
 * definition of containment and the set already has it applied — GODOWN is a
 * child of STOCK, so a STOCK-sourced document's set contains GODOWN outright.
 * Re-deriving that client-side would be a second definition, and two
 * definitions of containment is how they start disagreeing.
 */
export function routeRefusal(doc: ScanDocument, unit: ResolvedUnit): string | null {
  /*
   * AN EMPTY SET IS "NO OPINION", NOT "NOTHING IS ALLOWED".
   *
   * The set comes back empty when the document has no source location, and
   * refusing every unit on that basis would make the screen NARROWER than the
   * server — the one direction this design forbids. Falling through costs a
   * late message on a misconfigured document; refusing would strand an
   * operator at the bay with no way past it.
   */
  if (doc.allowed_from_location_ids.length === 0) return null;
  if (doc.allowed_from_location_ids.includes(unit.location_id)) return null;

  const from = unit.location_name ?? 'an unknown location';
  const source = doc.source_location_name ?? 'its source location';
  return (
    `${unit.serial} is in ${from}. ${doc.number} moves stock from ${source}. ` +
    `Nothing has been recorded. ` +
    `Transfer the unit to ${source} first, then scan it here.`
  );
}
