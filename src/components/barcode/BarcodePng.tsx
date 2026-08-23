import { useEffect, useState } from 'react';
import JsBarcode from 'jsbarcode';

/**
 * A CODE128 barcode as a raster <img>, for anything that will be RASTERISED —
 * which in this codebase means anything printed through `pdfGenerator`.
 *
 * ── WHY THIS EXISTS ALONGSIDE BarcodeSvg ──────────────────────────────────
 * `BarcodeSvg` emits an inline <svg> and is right for the screen: it is
 * resolution-independent and `LabelsPage` prints it through `window.print()`,
 * where the browser rasterises it natively and perfectly.
 *
 * The PDF path is different. `pdfGenerator` rasterises through html2canvas,
 * and html2canvas rasterises inline SVG ITSELF rather than letting the browser
 * do it. That turned out to be lossy in a way that is invisible to the eye:
 *
 *   - the bars LOOK correct — magnified 6x with smoothing off they are crisp,
 *     with sharp edges and no merging;
 *   - a scanline run-length read of the output gives the right proportions
 *     (1, 2 and 3 module bars all present at the expected widths);
 *   - and yet ZXing decoded it 0 times out of 4, reproducibly, across three
 *     independent captures and every crop framing tried.
 *
 * The same barcodes, rasterised by the BROWSER instead (serialise the SVG,
 * draw it via an Image onto a canvas), decoded 4 of 4 every time. Same DOM,
 * same options, same decoder — only the rasteriser differed.
 *
 * SO THE RULE IS: do not hand html2canvas an SVG barcode. Hand it a PNG.
 * html2canvas copies an <img> through verbatim, so the bars that reach the PDF
 * are exactly the bars JsBarcode drew.
 *
 * ── IT LOOKED FINE, WHICH IS THE POINT ────────────────────────────────────
 * This is the failure the whole investigation was aimed at: a barcode that is
 * perfect on screen, perfect in the PDF to a human eye, and unreadable to the
 * scanner at the bay. Nothing short of decoding would have caught it. If this
 * component is ever changed, RE-DECODE — do not look at it and judge.
 *
 * ── OVERSAMPLING ─────────────────────────────────────────────────────────
 * The canvas is drawn at OVERSAMPLE times the display size and the <img> is
 * then constrained to the natural CSS width. pdfGenerator captures at scale 2,
 * so rendering at 3x means the PDF downsamples a denser image rather than
 * stretching a sparser one, and bar edges stay on clean boundaries.
 *
 * ── maxWidth: 'none' IS LOAD-BEARING ─────────────────────────────────────
 * Not styling. Tailwind's PREFLIGHT carries a global `img, video { max-width:
 * 100% }`, so dropping the `max-w-full` CLASS does not remove the constraint —
 * the base rule still applies to every <img> in the app. Measured in the
 * shipped PDF it was still shrinking a 317px barcode to the 312px cell (x0.984)
 * and putting every bar back on a fractional pixel: the run-length histogram
 * showed 1-module bars landing on 3 AND 4 image px, 2-module on 6 AND 7.
 *
 * That is the SAME defect as the 293px->209px (x0.71) downscale this component
 * was created to fix, just small enough to survive. It decoded either way, which
 * is exactly why it needed measuring rather than looking at.
 *
 * An overlong serial must OVERFLOW VISIBLY rather than silently shrink below
 * scannable — a barcode that is too wide is a layout bug someone fixes, a
 * barcode that is quietly 30% too fine is a scanner failure at the bay.
 */
const OVERSAMPLE = 3;

export interface BarcodePngProps {
  value: string;
  /** Module width in CSS px. 1.6 keeps a 16-char serial near 0.4mm on A4. */
  width?: number;
  height?: number;
  fontSize?: number;
  displayValue?: boolean;
  className?: string;
}

export function BarcodePng({
  value,
  width = 1.6,
  height = 50,
  fontSize = 12,
  displayValue = true,
  className,
}: BarcodePngProps) {
  const [png, setPng] = useState<{ src: string; cssWidth: number } | null>(null);

  useEffect(() => {
    if (!value) { setPng(null); return; }
    try {
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, value, {
        format: 'CODE128',
        width: width * OVERSAMPLE,
        height: height * OVERSAMPLE,
        fontSize: fontSize * OVERSAMPLE,
        displayValue,
        // The quiet zone travels WITH the image. Relying on the surrounding
        // layout for it is how a barcode ends up flush against a cell border.
        margin: 10 * width * OVERSAMPLE,
      });
      setPng({ src: canvas.toDataURL('image/png'), cssWidth: canvas.width / OVERSAMPLE });
    } catch {
      // An unencodable value is not worth crashing a print sheet over; the
      // serial is printed as text beside it either way.
      setPng(null);
    }
  }, [value, width, height, fontSize, displayValue]);

  if (!png) return null;
  return (
    <img
      src={png.src}
      alt={`Barcode ${value}`}
      aria-label={`Barcode ${value}`}
      // maxWidth defeats Tailwind preflight's img{max-width:100%}; see above.
      style={{ width: png.cssWidth, maxWidth: 'none' }}
      className={className}
    />
  );
}

export default BarcodePng;
