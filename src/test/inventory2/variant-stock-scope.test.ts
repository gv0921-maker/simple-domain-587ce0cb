/**
 * listVariants() must derive TWO different stock figures from TWO different
 * reads of inv_stock_item, and the difference must survive to the call sites.
 *
 *   on_hand         `internal` locations only — what the "On Hand" columns show
 *   units_anywhere  every location type      — what predicts the archive refusal
 *                                              from tg_product_variant_guard
 *
 * WHY THIS IS A MOCK TEST AND WHAT THAT DOES AND DOES NOT PROVE.
 *
 * The case that matters — a variant whose only units sit at a `transit`
 * location — does not exist in the database and cannot be created without
 * writing fixture rows to a live table. So it is constructed here instead.
 *
 * What this proves: the client issues both reads, only one of them carries the
 * location-type restriction, and the two results are mapped to the two fields
 * the right way round. Collapse them into one query, or point either field at
 * the other's result, and these tests fail.
 *
 * What this does NOT prove: that PostgREST honours `inv_location!inner(type)`
 * + `.eq('inv_location.type', 'internal')`. That is a server behaviour and it
 * is proved separately against live data — 25 units exist, 23 of them at
 * GODOWN (`internal`) and 2 at DELIVERY ORDER (`transit`), and the filtered
 * read returns 23. Do not weaken the assertions here on the assumption that
 * the server half is covered; it is a different half.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** One recorded PostgREST query. */
interface Recorded {
  table: string;
  select: string;
  filters: string[];
}

const h = vi.hoisted(() => ({
  recorded: [] as Recorded[],
  /** variant_id -> location type, one entry per physical unit. */
  units: [] as { variant_id: string; location_type: string }[],
  variants: [] as Record<string, unknown>[],
}));

/** True when this query restricts to internal locations. */
const isInternalScoped = (q: Recorded) =>
  q.filters.includes('inv_location.type=internal') && q.select.includes('inv_location!inner');

vi.mock('@/integrations/supabase/client', () => {
  const build = (table: string) => {
    const q: Recorded = { table, select: '', filters: [] };
    h.recorded.push(q);

    const rows = (): unknown[] => {
      if (table === 'product_variants') return h.variants;
      if (table === 'inv_stock_item') {
        const units = isInternalScoped(q)
          ? h.units.filter((u) => u.location_type === 'internal')
          : h.units;
        return units.map((u) => ({ variant_id: u.variant_id }));
      }
      return [];
    };

    const builder = {
      select(s: string) { q.select = s; return builder; },
      order() { return builder; },
      eq(col: string, val: unknown) { q.filters.push(`${col}=${String(val)}`); return builder; },
      not(col: string, op: string, val: unknown) {
        q.filters.push(`${col}.not.${op}.${String(val)}`);
        return builder;
      },
      then<T>(onFulfilled: (r: { data: unknown[]; error: null }) => T) {
        return Promise.resolve({ data: rows(), error: null }).then(onFulfilled);
      },
    };
    return builder;
  };

  return { supabase: { from: (table: string) => build(table) } };
});

const { listVariants } = await import('@/lib/services/inventory2/variants');

const variantRow = (id: string, sku: string) => ({
  id,
  product_id: 'p1',
  sku,
  name: sku,
  barcode: null,
  sale_price: 0,
  cost_price: 0,
  status: 'provisional',
  combo_key: null,
  created_at: '2026-08-17T00:00:00Z',
  promoted_at: null,
  archived_at: null,
});

beforeEach(() => {
  h.recorded.length = 0;
  h.units.length = 0;
  h.variants.length = 0;
});

describe('listVariants — the two stock reads', () => {
  it('issues exactly two reads of inv_stock_item, exactly one of them internal-scoped', async () => {
    h.variants.push(variantRow('v1', 'LARGE-WALNUT'));
    await listVariants();

    const stockReads = h.recorded.filter((q) => q.table === 'inv_stock_item');
    expect(stockReads).toHaveLength(2);
    expect(stockReads.filter(isInternalScoped)).toHaveLength(1);

    // The unfiltered read must carry NO location restriction of any kind —
    // tg_product_variant_guard has none, so a prediction of it must have none.
    const unfiltered = stockReads.filter((q) => !isInternalScoped(q));
    expect(unfiltered).toHaveLength(1);
    expect(unfiltered[0].filters.join(' ')).not.toContain('inv_location');
    expect(unfiltered[0].select).not.toContain('inv_location');
  });

  /**
   * THE CASE OPTION 2 WOULD HAVE BROKEN SILENTLY. Both units are in transit,
   * so the variant holds no stock — but the archive guard still counts 2 and
   * will refuse. units_anywhere is what lets the screen say so.
   */
  it('a variant whose only units are in transit: on_hand 0, units_anywhere 2', async () => {
    h.variants.push(variantRow('v-transit', 'TRANSIT-ONLY'));
    h.units.push(
      { variant_id: 'v-transit', location_type: 'transit' },
      { variant_id: 'v-transit', location_type: 'transit' },
    );

    const [v] = await listVariants();
    expect(v.sku).toBe('TRANSIT-ONLY');
    expect(v.on_hand).toBe(0);
    expect(v.units_anywhere).toBe(2);

    // The tooltip condition in VariantsConfigList.tsx. This is the assertion
    // that fails if the tooltip is ever repointed at on_hand.
    expect(v.units_anywhere > 0).toBe(true);
  });

  it('counts customer and scrap units as units_anywhere but never as on_hand', async () => {
    h.variants.push(variantRow('v-gone', 'DELIVERED'));
    h.units.push(
      { variant_id: 'v-gone', location_type: 'customer' },
      { variant_id: 'v-gone', location_type: 'scrap' },
    );

    const [v] = await listVariants();
    expect(v.on_hand).toBe(0);
    expect(v.units_anywhere).toBe(2);
  });

  it('the two agree when every unit is internal — the fields are not swapped', async () => {
    h.variants.push(variantRow('v-godown', 'IN-GODOWN'));
    h.units.push(
      { variant_id: 'v-godown', location_type: 'internal' },
      { variant_id: 'v-godown', location_type: 'internal' },
      { variant_id: 'v-godown', location_type: 'internal' },
    );

    const [v] = await listVariants();
    expect(v.on_hand).toBe(3);
    expect(v.units_anywhere).toBe(3);
  });

  it('splits a mixed variant: 3 held, 5 referenced', async () => {
    h.variants.push(variantRow('v-mixed', 'MIXED'));
    for (let i = 0; i < 3; i++) h.units.push({ variant_id: 'v-mixed', location_type: 'internal' });
    h.units.push({ variant_id: 'v-mixed', location_type: 'transit' });
    h.units.push({ variant_id: 'v-mixed', location_type: 'customer' });

    const [v] = await listVariants();
    expect(v.on_hand).toBe(3);
    expect(v.units_anywhere).toBe(5);
  });
});
