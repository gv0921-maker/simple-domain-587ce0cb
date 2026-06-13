import { PrintableDocument } from '../PrintableDocument';
import { fmtINR } from './_helpers';
import { useCompanySettings } from '@/hooks/companySettings';

interface Props {
  order: any;
  lines?: any[];
  isDraft?: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  warehouse: 'Warehouse',
  display: 'Display',
  vendor: 'Vendor',
  factory: 'Factory',
};

function customizationSummary(l: any): string {
  const bits: string[] = [];
  if (l.customization_size || l.customizationSize) bits.push(`Size: ${l.customization_size || l.customizationSize}`);
  if (l.customization_colour || l.customizationColour) bits.push(`Colour: ${l.customization_colour || l.customizationColour}`);
  if (l.customization_fabric || l.customizationFabric) bits.push(`Fabric: ${l.customization_fabric || l.customizationFabric}`);
  if (l.customization_polish || l.customizationPolish) bits.push(`Polish: ${l.customization_polish || l.customizationPolish}`);
  return bits.join(' · ');
}

export function SalesOrderPrint({ order, lines = [], isDraft = false }: Props) {
  const { data: company } = useCompanySettings();
  const items = lines.length ? lines : order?.order_lines ?? [];
  const advancePct = Number(order?.advance_percent_required ?? order?.advancePercentRequired ?? 40);
  const advanceAmount = (Number(order?.total ?? 0) * advancePct) / 100;
  const isNoQuote = !!(order?.no_quote_flag ?? order?.noQuoteFlag);

  return (
    <PrintableDocument
      documentType="sales_order"
      documentNumber={order?.reference ?? '—'}
      documentDate={order?.order_date ?? order?.created_at ?? ''}
      isDraft={isDraft}
    >
      <div className="flex justify-between items-start mb-4 text-xs gap-4">
        <div className="space-y-0.5">
          <div>
            <span className="text-gray-500">Advance Required:</span>{' '}
            <span className="font-medium">{advancePct}% ({fmtINR(advanceAmount)})</span>
          </div>
        </div>
        {isNoQuote && (
          <div className="border border-orange-500 text-orange-700 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide">
            No-Quote Order
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6 text-xs">
        <div>
          <div className="text-gray-500 uppercase tracking-wide mb-1">Bill To</div>
          <div className="font-semibold">{order?.billing_name || order?.customer_name || '—'}</div>
          <div className="whitespace-pre-line text-gray-700">{order?.billing_address || '—'}</div>
          {order?.billing_state && <div className="text-gray-700">{order.billing_state}</div>}
          {order?.billing_gstin && <div className="text-gray-700">GSTIN: {order.billing_gstin}</div>}
        </div>
        <div>
          <div className="text-gray-500 uppercase tracking-wide mb-1">Ship To</div>
          <div className="font-semibold">{order?.delivery_name || order?.billing_name || '—'}</div>
          <div className="whitespace-pre-line text-gray-700">{order?.delivery_address || order?.billing_address || '—'}</div>
        </div>
      </div>

      <table className="w-full border-collapse text-xs mb-6">
        <thead>
          <tr className="border-y-2 border-black">
            <th className="text-left py-2">#</th>
            <th className="text-left py-2">Product</th>
            <th className="text-left py-2">Customization</th>
            <th className="text-left py-2">Source</th>
            <th className="text-left py-2">Line ETA</th>
            <th className="text-right py-2">Qty</th>
            <th className="text-right py-2">Unit Price</th>
            <th className="text-right py-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l: any, i: number) => (
            <tr key={l.id ?? i} className="border-b">
              <td className="py-2 align-top">{i + 1}</td>
              <td className="py-2 align-top">
                <div className="font-medium">{l.product_name || l.description || '—'}</div>
                {l.customization_notes && (
                  <div className="text-[10px] text-gray-600 italic">{l.customization_notes}</div>
                )}
              </td>
              <td className="py-2 align-top text-[10px] text-gray-700 max-w-[180px]">
                {customizationSummary(l) || '—'}
                {l.customization_notes && (
                  <div className="text-[10px] italic mt-0.5">Notes: {l.customization_notes}</div>
                )}
                {Array.isArray(l.customization_reference_images) && l.customization_reference_images.length > 0 && (
                  <div className="text-[10px] mt-0.5">+ {l.customization_reference_images.length} reference image(s) attached</div>
                )}
              </td>
              <td className="py-2 align-top text-[10px]">
                {SOURCE_LABEL[l.product_source ?? l.productSource ?? 'warehouse']}
              </td>
              <td className="py-2 align-top text-[10px]">
                {l.line_eta || l.lineEta || '—'}
              </td>
              <td className="py-2 text-right align-top">{Number(l.quantity ?? 0)}</td>
              <td className="py-2 text-right align-top">{fmtINR(Number(l.unit_price ?? 0))}</td>
              <td className="py-2 text-right align-top font-medium">
                {fmtINR(Number(l.final_amount ?? l.subtotal ?? 0))}
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={8} className="text-center py-4 text-gray-500">No line items</td></tr>
          )}
        </tbody>
      </table>

      <div className="flex justify-end mb-6">
        <div className="w-full max-w-xs text-xs space-y-1">
          <Row label="Subtotal" value={fmtINR(order?.subtotal)} />
          {Number(order?.discount_amount) > 0 && (
            <Row label="Discount" value={`-${fmtINR(order?.discount_amount)}`} />
          )}
          <Row label="Tax" value={fmtINR(order?.tax_amount)} />
          <div className="flex justify-between border-t pt-1 font-bold text-base">
            <span>Grand Total</span>
            <span>{fmtINR(order?.total)}</span>
          </div>
          {Number(order?.paid_amount) > 0 && (
            <Row label="Paid" value={fmtINR(order?.paid_amount)} />
          )}
        </div>
      </div>

      {company?.standard_terms && (
        <div className="page-break-avoid mb-6">
          <div className="text-xs font-semibold uppercase tracking-wide mb-1">Terms &amp; Conditions</div>
          <div className="text-[10px] text-gray-700 whitespace-pre-line">{company.standard_terms}</div>
        </div>
      )}

      <div className="page-break-avoid mb-4 text-[10px] text-gray-800 border-t border-gray-300 pt-2">
        I confirm the order details and accept that <strong>NO CANCELLATION</strong> is permitted once advance payment is made.
      </div>

      <div className="grid grid-cols-2 gap-12 mt-12 text-xs">
        <SignatureBlock label="Customer Signature & Date" />
        <SignatureBlock label="Authorized Signatory" />
      </div>
    </PrintableDocument>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-600">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function SignatureBlock({ label }: { label: string }) {
  return (
    <div>
      <div className="border-b border-black h-12">&nbsp;</div>
      <div className="text-gray-600 mt-1">{label}</div>
    </div>
  );
}