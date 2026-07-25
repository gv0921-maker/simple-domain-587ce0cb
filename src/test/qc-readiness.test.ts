import { describe, it, expect } from 'vitest';
import {
  validateReadyToComplete,
  type QCExpectedLine,
  type QCInspection,
} from '@/lib/services/inventory/qcEngine';

/**
 * §6.2 rule 2: an operation with no scannable pool must never be "ready to
 * complete". The prior version returned ready:true for an empty expectedLines
 * array (totalExpected 0, nothing missing, nothing pending), which enabled the
 * Complete button with zero units scanned.
 */

const line = (serials: string[], expectedQty = serials.length): QCExpectedLine => ({
  lineId: 'l1',
  productId: 'p1',
  productName: 'Chair',
  expectedQty,
  serials,
});

const inspection = (
  serial: string,
  qcStatus: QCInspection['qcStatus'],
  photoUrls: string[] = [],
): QCInspection =>
  ({
    id: serial,
    documentType: 'ito',
    documentId: 'd1',
    documentLineId: 'l1',
    serialNumber: serial,
    productId: 'p1',
    qcStatus,
    qcNotes: null,
    photoUrls,
    inspectedBy: null,
    inspectedAt: null,
  }) as unknown as QCInspection;

describe('validateReadyToComplete — empty pool', () => {
  it('is NOT ready when there are no expected lines', () => {
    const r = validateReadyToComplete([], []);
    expect(r.ready).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/no stock/i);
  });

  it('is NOT ready when lines exist but none carry serials', () => {
    const r = validateReadyToComplete([line([], 2)], []);
    expect(r.ready).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/no stock/i);
  });
});

describe('validateReadyToComplete — normal flow', () => {
  it('is NOT ready while units remain unscanned', () => {
    const r = validateReadyToComplete([line(['SN-1', 'SN-2'])], [inspection('SN-1', 'pass')]);
    expect(r.ready).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/not yet scanned/i);
  });

  it('is NOT ready while a scanned unit is still pending QC', () => {
    const r = validateReadyToComplete(
      [line(['SN-1'])],
      [inspection('SN-1', 'pending')],
    );
    expect(r.ready).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/awaiting qc/i);
  });

  it('is NOT ready when a failed unit lacks a required photo', () => {
    const r = validateReadyToComplete(
      [line(['SN-1'])],
      [inspection('SN-1', 'fail', [])],
      { requirePhotosOnFail: true },
    );
    expect(r.ready).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/photo/i);
  });

  it('IS ready when every expected unit is scanned and QC-resolved', () => {
    const r = validateReadyToComplete(
      [line(['SN-1', 'SN-2'])],
      [inspection('SN-1', 'pass'), inspection('SN-2', 'fail', ['x.jpg'])],
      { requirePhotosOnFail: true },
    );
    expect(r.ready).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });
});
