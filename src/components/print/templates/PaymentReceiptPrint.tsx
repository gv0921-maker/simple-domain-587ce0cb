import { PrintableDocument } from '../PrintableDocument';
import { fmtINR, numberToIndianWords } from './_helpers';

interface Props {
  payment: any;
  isDraft?: boolean;
}

export function PaymentReceiptPrint({ payment, isDraft = false }: Props) {
  const amount = Number(payment?.amount ?? 0);

  return (
    <PrintableDocument
      documentType="payment_receipt"
      documentNumber={payment?.reference ?? payment?.payment_reference ?? '—'}
      documentDate={payment?.payment_date ?? payment?.created_at ?? ''}
      isDraft={isDraft}
    >
      <div className="mb-6 text-xs grid grid-cols-2 gap-6">
        <div>
          <div className="text-gray-500 uppercase tracking-wide mb-1">Received From</div>
          <div className="font-semibold">{payment?.customer_name || payment?.payer_name || '—'}</div>
        </div>
        <div>
          <div className="text-gray-500 uppercase tracking-wide mb-1">Payment Method</div>
          <div className="font-semibold">{(payment?.payment_method ?? '—').toString().replace('_', ' ')}</div>
          {payment?.payment_reference && (
            <div className="text-gray-700">Ref: {payment.payment_reference}</div>
          )}
        </div>
      </div>

      <div className="border-y-2 border-black py-6 my-6 text-center">
        <div className="text-xs uppercase tracking-wide text-gray-500">Amount Received</div>
        <div className="text-3xl font-bold my-2">{fmtINR(amount)}</div>
        <div className="text-xs italic">{numberToIndianWords(amount)}</div>
      </div>

      {payment?.against_reference && (
        <div className="mb-6 text-xs">
          <span className="text-gray-500">Against:</span>{' '}
          <span className="font-mono font-semibold">{payment.against_reference}</span>
        </div>
      )}

      {payment?.notes && (
        <div className="mb-6 text-xs">
          <div className="text-gray-500 uppercase tracking-wide mb-1">Notes</div>
          <div className="whitespace-pre-line text-gray-700">{payment.notes}</div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-12 mt-16 text-xs">
        <div>
          <div className="border-b border-black h-12">&nbsp;</div>
          <div className="text-gray-600 mt-1">Received By</div>
        </div>
        <div>
          <div className="border-b border-black h-12">&nbsp;</div>
          <div className="text-gray-600 mt-1">Authorized Signatory</div>
        </div>
      </div>
    </PrintableDocument>
  );
}