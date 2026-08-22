import { PrintableDocument } from '../PrintableDocument';
import { BarcodePng } from '@/components/barcode/BarcodePng';
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
 * ── BarcodePng, NOT BarcodeSvg, AND THE REASON IS MEASURED ───────────────
 * pdfGenerator rasterises through html2canvas, and html2canvas rasterises
 * inline SVG ITSELF rather than deferring to the browser. On this sheet that
 * was lossy in a way no amount of looking would have caught: the bars were
 * crisp at 6x magnification, a scanline read gave correct module proportions,
 * and ZXing still decoded them 0 times out of 4 across three captures and
 * every crop framing tried. The same barcodes rasterised by the BROWSER
 * decoded 4 of 4, every time.
 *
 * So the SVG never reaches html2canvas: BarcodePng hands it a finished <img>,
 * which it copies through verbatim. See that component for the full account.
 *
 * DO NOT "SIMPLIFY" THIS BACK TO BarcodeSvg. It looks identical on screen and
 * in the PDF, and it does not scan.
 *
 * ── WHY 2-UP, MEASURED RATHER THAN ESTIMATED ─────────────────────────────
 * A CODE128 needs its narrowest bar — the X-dimension — to survive printing:
 * ~0.19mm absolute floor, ~0.33mm to be comfortable.
 *
 * This started as a 3-up grid on an ESTIMATE of ~0.44mm, and the estimate was
 * wrong. Measured on the real sheet: a 16-character serial gives JsBarcode a
 * natural width of 293px, a 3-up cell is ~209px, and `max-w-full` was quietly
 * scaling the SVG by 0.71 to fit. That put the X-dimension at 0.282mm — over
 * the floor, under comfortable — and, worse, landed every bar on a fractional
 * pixel so anti-aliasing smeared the edges. Decoding became crop-dependent:
 * the same barcode read on one capture and failed on the next.
 *
 * A BARCODE THAT DECODES INCONSISTENTLY IN A TEST IS ONE THAT FAILS
 * OCCASIONALLY AT THE BAY, which is worse than one that fails always, because
 * nobody trusts the scanner instead of fixing the sheet.
 *
 * 2-up gives each cell ~370px against a 293px natural width, so the SVG
 * renders at 1:1 with no downscale and the X-dimension is 1.6px × 0.2474mm/px
 * = ~0.40mm.
 *
 * `max-w-full` is deliberately NOT used. Silently shrinking a barcode below
 * scannability is the failure this comment exists to prevent; a serial long
 * enough to overflow should overflow VISIBLY so it gets fixed.
 *
 * ── THE QUIET ZONE IS PART OF THE BARCODE ────────────────────────────────
 * CODE128 needs a blank margin of at least 10x the X-dimension on each side or
 * a scanner cannot find the start and stop patterns. At width 1.6 that is
 * 16px, and JsBarcode's own `margin: 4` supplies only 4 — so the CELL PADDING
 * is load-bearing, not decoration. `p-4` (16px) plus that margin gives 20px of
 * white before the cell border, which clears the requirement.
 *
 * This was found by decoding, not by looking: the sheet rendered handsomely at
 * `p-2` and the barcodes were well formed — they decode 4/4 straight from the
 * SVG — but tight to the bars there was only 12px of white before the black
 * border, and a scanner reads that border as a bar. Do not reduce this padding
 * to fit more labels on a page.
 *
 * If this grid is ever changed, re-measure the X-dimension and re-decode. Do
 * not look at it and judge.
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
        <div className="grid grid-cols-2 gap-3">
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
                className="border border-black/70 p-4 text-center break-inside-avoid"
              >
                <div className="truncate text-[10px] font-semibold" title={line?.product_name ?? ''}>
                  {line?.product_name ?? '—'}
                </div>
                <div className="text-[9px] text-gray-600">{line?.product_sku ?? ''}</div>
                <BarcodePng
                  value={p.serial}
                  height={38}
                  fontSize={9}
                  /* No max-w-full — see the header. Shrinking to fit is what
                     took the X-dimension below scannable. */
                  className="mx-auto mt-1"
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
