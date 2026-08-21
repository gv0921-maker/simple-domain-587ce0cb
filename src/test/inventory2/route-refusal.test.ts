/**
 * The scan screen's early route refusal.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT.
 *
 * `routeRefusal` decides WHEN an operator is told, never WHETHER a movement
 * happens. The authority is `inv_route_is_legal`, called inside
 * `inv_transfer_stock_item`, and it is covered by
 * `supabase/smoke/route_enforcement_smoke.sql` against live data. Nothing here
 * touches the database, so nothing here is evidence about enforcement.
 *
 * What it IS evidence for is the property that cannot be checked server-side:
 * that this screen-side filter is never NARROWER than the server. A refusal
 * the server would not have made is the one failure mode with no way past it
 * at the bay, and it is invisible in a green smoke suite because the server is
 * never reached.
 *
 * Each test below fails if the behaviour under test is removed:
 *   - drop the empty-set guard  -> "no source location" refuses everything
 *   - test containment locally  -> the GODOWN/STOCK case flips
 *   - drop the membership test  -> the refusal never fires at all
 */
import { describe, it, expect } from 'vitest';
import { routeRefusal } from '@/lib/inventory2/routeRefusal';
import type { ResolvedUnit, ScanDocument } from '@/lib/services/inventory2/scan';

const GODOWN = '11111111-1111-1111-1111-111111111111';
const DELIVERY_ORDER = '22222222-2222-2222-2222-222222222222';
const STOCK = '33333333-3333-3333-3333-333333333333';

function doc(over: Partial<ScanDocument> = {}): ScanDocument {
  return {
    id: 'op-1',
    number: 'DEL/2627/0002',
    state: 'ready',
    kind: 'outgoing',
    type_name: 'DELIVERY NOTE',
    flags: {
      mandatory_scan_product: false,
      mandatory_scan_serial: false,
      mandatory_scan_dest_location: false,
      allow_extra_products: false,
    },
    source_location_id: DELIVERY_ORDER,
    source_location_name: 'DELIVERY ORDER',
    dest_location_id: null,
    dest_location_name: 'CUSTOMERS',
    vendor_name: null,
    allowed_from_location_ids: [DELIVERY_ORDER],
    lines: [],
    units: [],
    ...over,
  };
}

function unit(over: Partial<ResolvedUnit> = {}): ResolvedUnit {
  return {
    kind: 'unit',
    code: '101205-2627-0003',
    stock_item_id: 'si-1',
    serial: '101205-2627-0003',
    product_id: 'p-1',
    status: 'ok',
    location_id: GODOWN,
    location_name: 'GODOWN',
    origin_operation_id: null,
    ...over,
  };
}

describe('routeRefusal', () => {
  it('refuses a unit outside the allowed set, naming both locations and the remedy', () => {
    const msg = routeRefusal(doc(), unit());
    expect(msg).toBe(
      '101205-2627-0003 is in GODOWN. DEL/2627/0002 moves stock from DELIVERY ORDER. ' +
      'Nothing has been recorded. ' +
      'Transfer the unit to DELIVERY ORDER first, then scan it here.',
    );
  });

  it('names where the unit IS, not where the document starts', () => {
    // The one substitution that would look right and be wrong: reporting the
    // document's source as the unit's location. Both strings appear in the
    // message, so an assertion on "contains GODOWN" alone would not catch it.
    const msg = routeRefusal(doc(), unit())!;
    expect(msg.startsWith('101205-2627-0003 is in GODOWN.')).toBe(true);
  });

  it('permits a unit that is in the allowed set', () => {
    expect(routeRefusal(doc(), unit({ location_id: DELIVERY_ORDER, location_name: 'DELIVERY ORDER' })))
      .toBeNull();
  });

  it('permits a child location BECAUSE THE SET SAYS SO, without walking the hierarchy itself', () => {
    // GODOWN's parent is STOCK. inv_document_allowed_from has already expanded
    // the descendants, so a STOCK-sourced document's set CONTAINS GODOWN and a
    // flat membership test is enough.
    const staging = doc({
      number: 'INT/2627/0002',
      kind: 'internal',
      source_location_id: STOCK,
      source_location_name: 'STOCK',
      allowed_from_location_ids: [STOCK, GODOWN],
    });
    expect(routeRefusal(staging, unit())).toBeNull();
  });

  it('does NOT infer containment on its own: an unexpanded set refuses the child', () => {
    // The companion to the test above, and the one that pins WHERE containment
    // is defined. Same document, same unit, but the set as it would arrive if
    // the server had not expanded descendants. If this function ever grew its
    // own parent walk, this would return null and the two definitions would
    // have started to diverge.
    const unexpanded = doc({
      number: 'INT/2627/0002',
      kind: 'internal',
      source_location_id: STOCK,
      source_location_name: 'STOCK',
      allowed_from_location_ids: [STOCK],
    });
    expect(routeRefusal(unexpanded, unit())).not.toBeNull();
  });

  it('has NO OPINION on an empty set rather than refusing everything', () => {
    // The narrow-side guard. A document with no source location yields an empty
    // set; refusing here would strand a lawful unit at the bay with no way
    // past it, which is the one direction the superset design forbids.
    const noSource = doc({ source_location_id: null, source_location_name: null, allowed_from_location_ids: [] });
    expect(routeRefusal(noSource, unit())).toBeNull();
  });

  it('still refuses when the unit location has no name, without printing undefined', () => {
    const msg = routeRefusal(doc(), unit({ location_name: null }))!;
    expect(msg).toContain('is in an unknown location.');
    expect(msg).not.toContain('undefined');
    expect(msg).not.toContain('null');
  });
});
