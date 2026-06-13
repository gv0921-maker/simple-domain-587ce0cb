import { PrintableDocument } from '../PrintableDocument';
import { fmtINR } from './_helpers';
import { useCompanySettings } from '@/hooks/companySettings';

interface Props {
  order: any;
  lines?: any[];
  isDraft?: boolean;
}

export function SalesOrderPrint({ order, lines = [], isDraft = false }: Props) {
  const { data: company } = useCompanySettings();
  const items = lines.length ? lines : order?.order_lines ?? [];

  return (
    <PrintableDocument
      documentType="sales_order"
      documentNumber={order?.reference ?? '—'}
      documentDate={order?.order_date ?? order?.created_at ?? ''}
      isDraft={isDraft}
    >
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
              <td className="py-2 text-right align-top">{Number(l.quantity ?? 0)}</td>
              <td className="py-2 text-right align-top">{fmtINR(Number(l.unit_price ?? 0))}</td>
              <td className="py-2 text-right align-top font-medium">
                {fmtINR(Number(l.final_amount ?? l.subtotal ?? 0))}
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={5} className="text-center py-4 text-gray-500">No line items</td></tr>
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

      <div className="grid grid-cols-2 gap-12 mt-12 text-xs">
        <SignatureBlock label="Authorized Signatory" />
        <SignatureBlock label="Customer Signature" />
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