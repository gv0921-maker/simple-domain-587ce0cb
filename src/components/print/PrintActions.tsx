import { Button } from '@/components/ui/button';
import { Printer, Download, Mail } from 'lucide-react';
import { generatePDF, buildPrintFilename, type PrintFormat } from '@/lib/print/pdfGenerator';
import { toast } from 'sonner';
import { useState } from 'react';
import { useCompanySettings } from '@/hooks/companySettings';

interface PrintActionsProps {
  elementId: string;
  documentType: string;
  documentNumber: string;
  format?: PrintFormat;
  emailTo?: string;
  /**
   * Called once a print or a PDF download has been STARTED.
   *
   * "Printed" here means the operator asked for it, not that paper came out.
   * There is no honest way to know the latter: window.print() resolves whether
   * the dialog is confirmed or cancelled, and onafterprint fires for both. So
   * this records the attempt, and the count it feeds should be read as "how
   * many times a label was asked for" — which is the useful number anyway, and
   * why a reprint is visible at all.
   *
   * Deliberately NOT fired by Email, which attaches nothing and prints nothing.
   */
  onPrinted?: () => void;
}

export function PrintActions({
  elementId,
  documentType,
  documentNumber,
  format = 'a4',
  emailTo,
  onPrinted,
}: PrintActionsProps) {
  const [downloading, setDownloading] = useState(false);
  const { data: company } = useCompanySettings();

  const filename = buildPrintFilename(documentType, documentNumber);

  async function handleDownload() {
    try {
      setDownloading(true);
      await generatePDF(elementId, filename, format, company?.thermal_width_mm ?? 80);
      // After the PDF actually exists, not before: a failed render is not a print.
      onPrinted?.();
    } catch (e) {
      toast.error((e as Error)?.message ?? 'Failed to generate PDF');
    } finally {
      setDownloading(false);
    }
  }

  function handleEmail() {
    const subject = encodeURIComponent(`${documentType.replace(/_/g, ' ')} ${documentNumber}`);
    const body = encodeURIComponent(
      `Please find ${documentType.replace(/_/g, ' ')} ${documentNumber} attached.\n\n— ${company?.company_name ?? ''}`,
    );
    const to = emailTo ? encodeURIComponent(emailTo) : '';
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
    toast.info('Attach the downloaded PDF to your email manually.');
  }

  return (
    <div className="no-print flex justify-end gap-2 p-4 border-b bg-background sticky top-0 z-10">
      <Button variant="outline" onClick={handleEmail}>
        <Mail className="h-4 w-4 mr-2" /> Email
      </Button>
      <Button variant="outline" onClick={handleDownload} disabled={downloading}>
        <Download className="h-4 w-4 mr-2" />
        {downloading ? 'Generating…' : 'Download PDF'}
      </Button>
      <Button onClick={() => { onPrinted?.(); window.print(); }}>
        <Printer className="h-4 w-4 mr-2" /> Print
      </Button>
    </div>
  );
}