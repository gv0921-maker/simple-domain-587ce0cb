/**
 * Inventory 2 — generated serial numbers, the data layer.
 *
 * V's workflow: create the receipt with quantities → GENERATE SERIALS → print
 * labels → stick them on the goods → scan them in. Generation therefore comes
 * before the goods exist, which is the whole reason this module exists at all.
 *
 * ── A PENDING SERIAL IS A NUMBER, NOT A UNIT ──────────────────────────────
 * Nothing here touches `inv_stock_item`. A generated serial has no location,
 * no status and no QC, because it does not yet name anything physical. That
 * separation is what keeps the on-hand readers, `inv_available_qty`, the QC
 * gate and route enforcement completely unaware of it — see CLAUDE.md.
 *
 * ── VENDOR SERIALS ARE NORMAL ─────────────────────────────────────────────
 * A unit can arrive under a serial this module never minted, because some
 * vendors label their own goods. That is not an error and it is not reported
 * as one: `inv_receive_serial` accepts an unknown serial silently, exactly as
 * it always did. The consequence for THIS file is that the generated count and
 * the received count legitimately differ, so nothing here computes a
 * "missing" figure — see `reconcileLine` below.
 *
 * WRITES: only through the three sanctioned RPCs. `inv_pending_serial` is
 * never inserted, updated or deleted directly, because uniqueness across it
 * and `inv_stock_item` is PROCEDURAL — four mechanisms, not one constraint —
 * and a direct write is precisely what would break it (CLAUDE.md).
 */
import { supabase } from '@/integrations/supabase/client';

/* ------------------------------------------------------------------ types */

/** The lifecycle of one generated number. Derived, never stored as a column. */
export type PendingSerialState = 'pending' | 'consumed' | 'voided';

export interface PendingSerial {
  id: string;
  move_id: string;
  serial: string;
  state: PendingSerialState;
  generated_at: string;
  /**
   * How many times a label has been printed for this number.
   *
   * A MISPRINT IS A REPRINT, NOT A VOID (V, 2026-08-22). The number is
   * committed when it is generated, and a fresh label bearing it is the same
   * unit — so printing counts rather than retires. A count above 1 is normal
   * and is shown, not warned about.
   */
  print_count: number;
  first_printed_at: string | null;
  last_printed_at: string | null;
  consumed_at: string | null;
  /** The unit this number ended up naming, once it was scanned in. */
  stock_item_id: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

/**
 * The two ACCOUNTS for one receipt line, kept deliberately apart.
 *
 * ── WHY THIS IS NOT ONE FRACTION ──────────────────────────────────────────
 * "12 generated, 7 received" never meant "5 are missing", and once vendor
 * serials exist it visibly does not: a unit can arrive under the vendor's own
 * number, which consumes no label at all. Collapsing the two accounts into a
 * single figure would either report phantom shortfalls or make a
 * vendor-serialled line look permanently incomplete.
 *
 * COMPLETENESS IS `received` VS `ordered`, AND THE LABEL ACCOUNT MUST NEVER
 * DEFINE IT. If it did, a line whose goods all arrived under vendor serials
 * could never complete — its consumed count would sit at zero forever.
 */
export interface LineReconciliation {
  /* -- the goods account: did the stock arrive? ------------------------- */
  ordered: number;
  received: number;
  /** Received under a number this module generated (a consumed pending row). */
  receivedOnOurLabels: number;
  /**
   * Received under a serial with no pending row — the vendor's own.
   * Derived by subtraction rather than by a flag, because there is no flag:
   * see CLAUDE.md on why `uses_vendor_serials` was rejected.
   */
  receivedOnVendorSerials: number;

  /* -- the label account: where did our numbers go? --------------------- */
  generated: number;
  consumed: number;
  /** Generated, not yet received, not voided — labels still out there. */
  outstanding: number;
  voided: number;
}

/* ------------------------------------------------------------------ reads */

/** Every generated number for one receipt, newest line activity first. */
export async function listPendingSerials(operationId: string): Promise<PendingSerial[]> {
  const { data: moves, error: mErr } = await supabase
    .from('inv_move')
    .select('id')
    .eq('operation_id', operationId);
  if (mErr) throw mErr;

  const moveIds = (moves ?? []).map((m) => m.id);
  if (!moveIds.length) return [];

  const { data, error } = await supabase
    .from('inv_pending_serial')
    .select('id, move_id, serial, generated_at, print_count, first_printed_at, last_printed_at, consumed_at, stock_item_id, voided_at, void_reason')
    .in('move_id', moveIds)
    .order('serial');
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: r.id,
    move_id: r.move_id,
    serial: r.serial,
    // Derived here rather than stored, so the three states cannot drift out of
    // step with the timestamps that actually define them. The database already
    // forbids the impossible pair via inv_pending_serial_single_outcome.
    state: r.voided_at ? 'voided' : r.consumed_at ? 'consumed' : 'pending',
    generated_at: r.generated_at,
    print_count: r.print_count,
    first_printed_at: r.first_printed_at,
    last_printed_at: r.last_printed_at,
    consumed_at: r.consumed_at,
    stock_item_id: r.stock_item_id,
    voided_at: r.voided_at,
    void_reason: r.void_reason,
  }));
}

/**
 * Both accounts for one line.
 *
 * `received` is taken from the LINE, not from the label rows, because the line
 * is the truth about the goods. The labels only explain how much of that
 * arrival was under our own numbers.
 */
export function reconcileLine(
  ordered: number,
  received: number,
  pending: PendingSerial[],
): LineReconciliation {
  const generated = pending.length;
  const consumed = pending.filter((p) => p.state === 'consumed').length;
  const voided = pending.filter((p) => p.state === 'voided').length;
  const outstanding = pending.filter((p) => p.state === 'pending').length;

  return {
    ordered,
    received,
    receivedOnOurLabels: consumed,
    // Never negative: a consumed label always has a unit behind it, so this
    // subtraction cannot exceed `received` unless the two were read from
    // different points in time. Clamped rather than trusted, because a negative
    // "vendor serials" figure would be read as a bug in the goods count.
    receivedOnVendorSerials: Math.max(0, received - consumed),
    generated,
    consumed,
    outstanding,
    voided,
  };
}

/**
 * The next serial this line would produce, for the read-only preview.
 *
 * ── A PREVIEW, NOT A PROMISE, AND THE DIFFERENCE MATTERS ──────────────────
 * The authority is `inv_generate_serials`, which allocates from an atomic
 * counter and SKIPS any number already taken by a hand-typed or vendor serial.
 * This function cannot see that skip, so the number it shows is what the
 * counter would hand out next if nothing were in the way. Anyone else
 * generating first, or an existing serial occupying that slot, moves it on.
 *
 * It exists so the operator sees the SHAPE of what they are about to mint
 * before they mint it. It must never be used to construct a serial that is
 * then written anywhere — that would be a second generator, and a second
 * generator is how two conventions start.
 */
export async function previewNextSerial(
  moveId: string,
): Promise<{ preview: string; exact: boolean } | null> {
  const { data: move, error: mErr } = await supabase
    .from('inv_move')
    .select('product_id, operation_id')
    .eq('id', moveId)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!move) return null;

  const [prodRes, opRes] = await Promise.all([
    supabase.from('products').select('sku').eq('id', move.product_id).maybeSingle(),
    supabase.from('inv_operation').select('number').eq('id', move.operation_id).maybeSingle(),
  ]);
  if (prodRes.error) throw prodRes.error;
  if (opRes.error) throw opRes.error;

  const sku = prodRes.data?.sku;
  const number = opRes.data?.number;
  if (!sku || !number) return null;

  // The financial year comes from the DOCUMENT, never from today's date — a
  // receipt opened in 2627 and received in 2628 still mints 2627 serials. This
  // mirrors what the RPC does by parsing the operation's own number.
  const fy = number.split('/')[1];
  if (!fy) return null;

  const { data: seq, error: sErr } = await supabase
    .from('inv_serial_sequence')
    .select('current_number, padding, separator')
    .eq('product_id', move.product_id)
    .eq('fy_label', fy)
    .maybeSingle();
  if (sErr) throw sErr;

  const next = (seq?.current_number ?? 0) + 1;
  const pad = seq?.padding ?? 4;
  const sep = seq?.separator ?? '-';

  return {
    preview: `${sku}${sep}${fy}${sep}${String(next).padStart(pad, '0')}`,
    // False once anything might occupy the slot, so the screen can say "next,
    // if it is free" rather than stating a number it cannot guarantee.
    exact: false,
  };
}

/* ----------------------------------------------------------------- writes */

/**
 * Mint `count` new numbers for a line.
 *
 * ADDITIVE, ALWAYS. There is no "replace" and there must never be one: the
 * numbers already generated may be printed and stuck to furniture, so
 * discarding them would orphan physical labels. Generating again simply
 * appends.
 */
export async function generateSerials(
  moveId: string,
  count: number,
): Promise<{ pending_id: string; serial_number: string }[]> {
  const { data, error } = await supabase.rpc('inv_generate_serials', {
    p_move_id: moveId,
    p_count: count,
  });
  if (error) throw error;
  return (data ?? []) as { pending_id: string; serial_number: string }[];
}

/**
 * Retire numbers that will never be received.
 *
 * FOR CANCELLATION, NOT FOR MISPRINTS. A bad print is reprinted under the same
 * number (see `recordSerialPrint`); voiding is for the goods that never came.
 * The reason is required by the RPC, and the RPC refuses a number that has
 * already been received.
 */
export async function voidPendingSerials(
  pendingIds: string[],
  reason: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('inv_void_pending_serials', {
    p_pending_ids: pendingIds,
    p_reason: reason,
  });
  if (error) throw error;
  return (data ?? 0) as number;
}

/**
 * Record that labels were printed, so a reprint is visible rather than silent.
 *
 * Called by the print path. A voided number is refused by the RPC; a consumed
 * one is allowed, because a label on a real unit can still fall off.
 */
export async function recordSerialPrint(pendingIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('inv_record_serial_print', {
    p_pending_ids: pendingIds,
  });
  if (error) throw error;
  return (data ?? 0) as number;
}
