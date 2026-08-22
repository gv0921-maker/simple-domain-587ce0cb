import { PrintableDocument } from '../PrintableDocument';
import type { ReceiptDetail } from '@/lib/services/inventory2/receipts';

/**
 * The Goods Receipt Note — the branded document printed AFTER completion.
 *
 * Fills the `goods_receipt` slot that has been declared in
 * PrintableDocument's union, and titled, since the print framework landed —
 * with no template behind it. Navigating to /print/goods_receipt/:id rendered
 * "Document not available for printing" until now.
 *
 * ── THE LETTERHEAD IS CONFIG, NOT CODE ────────────────────────────────────
 * PrintableDocument draws PrintLetterhead, which reads the single
 * `company_settings` row: name, address, GSTIN, logo, footer. Nothing about
 * "GOODLIFE FURNITURE" is written down here or anywhere else in this file.
 * The row currently holds placeholder data ("GLF" / "Goods Logistics &
 * Fulfilment"), so that is what this prints until V edits it in Settings.
 * Hardcoding the real name would put the company identity in two places and
 * guarantee they drift.
 *
 * ── "SALESPERSON" IS OPERATOR ─────────────────────────────────────────────
 * The Odoo reference footer reads Salesperson. A receipt has no salesperson:
 * it has a vendor it came from and an operator who booked it in. Printing a
 * label with nothing behind it is worse than printing the right label, so per
 * V this is OPERATOR, resolved from inv_operation.created_by.
 *
 * ── ORDERED VS DELIVERED ──────────────────────────────────────────────────
 * Straight from the line: `demand_qty` and `received_qty`. A short delivery
 * and an over-delivery are both stated rather than smoothed, because the GRN
 * is the document a vendor is paid against and a silent discrepancy in it is
 * an argument three weeks later.
 */
export function GoodsReceiptPrint({
  detail, operatorName, isDraft = false,
}: {
  detail: ReceiptDetail;
  /** Resolved upstream — templates have no data layer of their own. */
  operatorName: string | null;
  isDraft?: boolean;
}) {
  const r = detail.receipt;

  const totalOrdered = detail.lines.reduce((n, l) => n + l.demand_qty, 0);
  const totalReceived = detail.lines.reduce((n, l) => n + l.received_qty, 0);

  const shippingDate = r.done_at ?? r.scheduled_at ?? r.created_at;

  return (
    <PrintableDocument
      documentType="goods_receipt"
      documentNumber={r.number}
      documentDate={r.created_at}
      isDraft={isDraft}
    >
      <div className="mb-4 text-center">
        <div className="text-lg font-bold uppercase tracking-wider">Goods Receipt Note</div>
        <div className="text-xs text-gray-500">{r.number}</div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-6 text-xs">
        <div>
          <div className="text-gray-500 uppercase tracking-wide mb-1">Received From</div>
          <div className="font-semibold">{r.vendor_name ?? r.source_location_name ?? '—'}</div>
          {/*
            Each line is conditional. A vendor with no GSTIN prints no GSTIN row
            rather than a labelled blank, which on a tax document reads as a
            missing value rather than an absent one.
          */}
          {r.vendor_contact_person && <div>{r.vendor_contact_person}</div>}
          {r.vendor_address && <div className="whitespace-pre-wrap">{r.vendor_address}</div>}
          {r.vendor_phone && <div>Phone: {r.vendor_phone}</div>}
          {r.vendor_email && <div>{r.vendor_email}</div>}
          {r.vendor_gstin && <div>GSTIN: {r.vendor_gstin}</div>}
        </div>

        <div className="text-right">
          <div className="text-gray-500 uppercase tracking-wide mb-1">Order</div>
          <div className="font-semibold">
            {r.purchase_order_number ?? r.source_document ?? '—'}
          </div>
          <div className="mt-2 text-gray-500">
            Shipping Date:{' '}
            <span className="font-semibold text-black">{fmtDate(shippingDate)}</span>
          </div>
          <div className="mt-1 text-gray-500">
            Operator: <span className="font-semibold text-black">{operatorName ?? '—'}</span>
          </div>
          <div className="mt-1 text-gray-500">
            Destination: <span className="font-semibold text-black">{r.dest_location_name ?? '—'}</span>
          </div>
        </div>
      </div>

      <table className="w-full border-collapse text-xs mb-6">
        <thead>
          <tr className="border-y-2 border-black">
            <th className="text-left py-2">#</th>
            <th className="text-left py-2">Product</th>
            <th className="text-left py-2">SKU</th>
            <th className="text-right py-2">Ordered</th>
            <th className="text-right py-2">Delivered</th>
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((l, i) => (
            <tr key={l.move_id} className="border-b align-top">
              <td className="py-2">{i + 1}</td>
              <td className="py-2">{l.product_name ?? '—'}</td>
              <td className="py-2 font-mono text-[10px]">{l.product_sku ?? '—'}</td>
              <td className="py-2 text-right tabular-nums">{l.demand_qty}</td>
              <td className="py-2 text-right tabular-nums">
                {l.received_qty}
                {/*
                  Stated, not smoothed. This is the document the vendor is paid
                  against; a discrepancy the paperwork hides becomes an argument
                  three weeks later.
                */}
                {l.received_qty !== l.demand_qty && (
                  <span className="ml-1 text-[9px] uppercase text-gray-500">
                    {l.received_qty > l.demand_qty ? 'over' : 'short'}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-semibold">
            <td className="py-2" colSpan={3}>Total</td>
            <td className="py-2 text-right tabular-nums">{totalOrdered}</td>
            <td className="py-2 text-right tabular-nums">{totalReceived}</td>
          </tr>
        </tfoot>
      </table>

      {r.notes && (
        <div className="mb-6 text-xs">
          <div className="text-gray-500 uppercase tracking-wide mb-1">Notes</div>
          <div className="whitespace-pre-wrap">{r.notes}</div>
        </div>
      )}

      <div className="mt-12 grid grid-cols-2 gap-12 text-xs">
        <div>
          <div className="border-t border-black pt-2">Operator</div>
          {operatorName && <div className="mt-1 text-gray-600">{operatorName}</div>}
        </div>
        <div>
          <div className="border-t border-black pt-2">MNGT</div>
        </div>
      </div>
    </PrintableDocument>
  );
}

function fmtDate(value: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch {
    return value;
  }
}
