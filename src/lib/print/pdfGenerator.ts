import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export type PrintFormat = 'a4' | 'thermal';

/** Convert a DOM element to a PDF and trigger a download. */
export async function generatePDF(
  elementId: string,
  filename: string,
  format: PrintFormat = 'a4',
  thermalWidthMm = 80,
): Promise<void> {
  const el = document.getElementById(elementId);
  if (!el) throw new Error(`Element #${elementId} not found`);

  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  });
  const imgData = canvas.toDataURL('image/png');

  let pdf: jsPDF;
  let pageWidth: number;
  let pageHeight: number;

  if (format === 'thermal') {
    // mm units, narrow roll
    pageWidth = thermalWidthMm;
    const ratio = canvas.height / canvas.width;
    pageHeight = pageWidth * ratio;
    pdf = new jsPDF({ unit: 'mm', format: [pageWidth, pageHeight], orientation: 'portrait' });
    pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
  } else {
    pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    pageWidth = pdf.internal.pageSize.getWidth();
    pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = margin;

    pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight, undefined, 'FAST');
    heightLeft -= pageHeight - margin * 2;

    while (heightLeft > 0) {
      pdf.addPage();
      position = margin - (imgHeight - heightLeft);
      pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pageHeight - margin * 2;
    }
  }

  pdf.save(filename);
}

export function buildPrintFilename(
  documentType: string,
  documentNumber: string,
): string {
  const safeNumber = documentNumber.replace(/[^\w.-]/g, '_');
  return `${documentType.replace(/_/g, '-')}-${safeNumber}.pdf`;
}