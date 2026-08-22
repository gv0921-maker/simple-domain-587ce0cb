import { PrintableDocument } from '../PrintableDocument';
import { BarcodeSvg } from '@/components/barcode/BarcodeSvg';
import type { ReceiptDetail } from '@/lib/services/inventory2/receipts';
import type { PendingSerial } from '@/lib/services/inventory2/serials';

/**
 * Picking Operations — the operational sheet, one barcode per serial.
 *
 * This is the document V's workflow actually depends on: quantities →
 * GENERATE SERIALS → **print this** → stick the labels on the goods → scan
 * them in. Without it the units cannot be labelled before they are received,
 * which is why serial generation had to land before printing could.
 *
 * ── PRINTED BEFORE COMPLETION, ON PURPOSE ─────────────────────────────────
 * Every other document here prints a record of something that happened. This
 * one prints numbers for goods that have not arrived yet, so its rows come
 * from `inv_pending_serial` and NOT from `inv_stock_item`. A unit does not
 * exist until it is scanned in; that is exactly why pending serials live in
 * their own table.
 *
 * ── THE BARCODE PATH WAS PROVEN BEFORE THIS WAS WRITTEN ───────────────────
 * `BarcodeSvg` emits an inline <svg>, and `pdfGenerator` rasterises through
 * html2canvas, which is documented as unreliable with SVG. That was tested
 * first rather than assumed: a real JsBarcode SVG through the real
 * html2canvas produced a capture that ZXing decoded back to the exact serial.
 * html2canvas's SVG weaknesses are foreignObject and external references,
 * neither of which JsBarcode emits.
 *
 * DO NOT SWAP BarcodeSvg FOR A CANVAS OR data: URI "to be safe". It was
 * checked; a rewrite would be churn against evidence.
 *
 * ── WHY 3-UP ─────────────────────────────────────────────────────────────
 * A CODE128 needs its narrowest bar (the X-dimension) to survive printing —
 * roughly 0.19mm minimum, comfortable at 0.33mm. The page renders to ~190mm
 * of usable width, so a three-column grid leaves each barcode ~60mm and an
 * X-dimension near 0.44mm. Going to four columns pushes it toward the floor.
 * If this grid is ever widened, re-check by DECODING a real PDF, not by
 * looking at it.
 *
 * ── ONLY LIVE NUMBERS ARE PRINTED ─────────────────────────────────────────
 * Voided serials are excluded: a voided number is never reissued, so a label
 * bearing one could never be received and would be a trap on the shop floor.
 * Consumed serials are INCLUDED, because a label can fall off a unit that was
 * already booked in and reprinting it is the sanctioned fix.
 */
export function PickingOperationsPrint({
  detail, pending, isDraft = false,
}: {
  detail: ReceiptDetail;
  pending: PendingSerial[];
  isDraft?: boolean;
}) {
  const r = detail.receipt;
  const productOf = new Map(detail.lines.map((l) => [l.move_id, l]));

  // See the header: voided numbers must never reach a label.
  const printable = pending.filter((p) => p.state !== 'voided');

  return (
    <PrintableDocument
      documentType="picking_operations"
      documentNumber={r.number}
      documentDate={r.created_at}
      isDraft={isDraft}
    >
      <div className="mb-4 text-center">
        <div className="text-lg font-bold uppercase tracking-wider">Picking Operations</div>
        <div className="text-xs text-gray-500">{r.number}</div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-4 text-xs">
        <div>
          <div className="text-gray-500 uppercase tracking-wide">From</div>
          <div className="font-semibold">{r.vendor_name ?? r.source_location_name ?? '—'}</div>
        </div>
        <div>
          <div className="text-gray-500 uppercase tracking-wide">To</div>
          <div className="font-semibold">{r.dest_location_name ?? '—'}</div>
        </div>
        <div>
          <div className="text-gray-500 uppercase tracking-wide">Labels</div>
          <div className="font-semibold tabular-nums">{printable.length}</div>
        </div>
      </div>

      {printable.length === 0 ? (
        /*
          Reachable only if every generated number was voided, since the Print
          action is gated on labels existing. Says which of the two it is,
          because "no labels" and "all labels voided" call for different next
          steps.
        */
        <p className="text-xs text-gray-600">
          {pending.length === 0
            ? 'No serial numbers have been generated for this receipt yet.'
            : 'Every generated serial number on this receipt has been voided, so there is nothing to label.'}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {printable.map((p) => {
            const line = productOf.get(p.move_id);
            return (
              <div
                key={p.id}
                /*
                  break-inside-avoid keeps a label whole across a page break. A
                  barcode split down the middle is not a barcode, and this is
                  the one document where the page break lands mid-grid.
                */
                className="border border-black/70 p-2 text-center break-inside-avoid"
              >
                <div className="truncate text-[10px] font-semibold" title={line?.product_name ?? ''}>
                  {line?.product_name ?? '—'}
                </div>
                <div className="text-[9px] text-gray-600">{line?.product_sku ?? ''}</div>
                <BarcodeSvg
                  value={p.serial}
                  height={38}
                  fontSize={9}
                  className="mx-auto mt-1 max-w-full"
                />
                {/*
                  A reprint is the sanctioned response to a misprint, so the
                  count is stated rather than flagged — an operator holding two
                  labels for one unit should be able to tell they are the same
                  number reprinted, not two different units.
                */}
                {p.print_count > 0 && (
                  <div className="text-[8px] text-gray-500">reprint #{p.print_count + 1}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[10px] text-gray-600">
        Stick one label on each unit, then scan them in against {r.number}. A unit that
        arrives under the vendor&rsquo;s own serial does not need a label from this sheet —
        scan the vendor&rsquo;s number and it will be received normally.
      </p>
    </PrintableDocument>
  );
}
