import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Camera, Check, X, Loader2, ImagePlus, ScanBarcode, Trash2, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import CameraScannerDialog from '@/components/barcode/CameraScannerDialog';
import { feedbackSuccess, feedbackError } from '@/lib/barcode/feedback';
import {
  useQCInspections, useRecordScan, useRecordQCResult, useUploadQCPhoto, useRemoveQCPhoto,
} from '@/hooks/inventory/useQCEngine';
import {
  computeProgress, validateReadyToComplete,
  type QCDocumentType, type QCExpectedLine, type QCInspection,
} from '@/lib/services/inventory/qcEngine';

export interface ScanQCPanelProps {
  documentType: QCDocumentType;
  documentId: string;
  expectedLines: QCExpectedLine[];
  requireQC?: boolean;
  requirePhotos?: boolean; // photos mandatory on fail
  onComplete: () => void | Promise<void>;
  completeButtonLabel?: string;
  completing?: boolean;
  /** Optional line to associate free-form scans with when a serial isn't on any expected list. */
  defaultLineId?: string;
}

export function ScanQCPanel({
  documentType,
  documentId,
  expectedLines,
  requireQC = true,
  requirePhotos = true,
  onComplete,
  completeButtonLabel = 'Complete',
  completing = false,
  defaultLineId,
}: ScanQCPanelProps) {
  const { data: inspections = [], isLoading } = useQCInspections(documentType, documentId);
  const recordScan = useRecordScan(documentType, documentId);
  const recordResult = useRecordQCResult(documentType, documentId);
  const uploadPhoto = useUploadQCPhoto(documentType, documentId);
  const removePhoto = useRemoveQCPhoto(documentType, documentId);

  const [scanValue, setScanValue] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const scanRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { scanRef.current?.focus(); }, []);

  const progress = useMemo(
    () => computeProgress(expectedLines, inspections),
    [expectedLines, inspections],
  );
  const readiness = useMemo(
    () => validateReadyToComplete(expectedLines, inspections, {
      requireQC,
      requirePhotosOnFail: requirePhotos,
    }),
    [expectedLines, inspections, requireQC, requirePhotos],
  );

  const lineById = useMemo(() => {
    const m = new Map<string, QCExpectedLine>();
    expectedLines.forEach(l => m.set(l.lineId, l));
    return m;
  }, [expectedLines]);

  const scannedSerials = useMemo(
    () => new Set(inspections.map(i => (i.serialNumber ?? '').toLowerCase())),
    [inspections],
  );

  const pendingBySerial = useMemo(() => {
    // For each expected line: how many of its serials remain unscanned?
    return expectedLines.map(line => {
      if (line.serials && line.serials.length > 0) {
        const remaining = line.serials.filter(s => !scannedSerials.has(s.toLowerCase()));
        return { line, remaining };
      }
      // No enumerated serials — show how many units still expected on this line
      const scannedForLine = inspections.filter(i => i.documentLineId === line.lineId).length;
      const remaining = Math.max(0, line.expectedQty - scannedForLine);
      return { line, remainingCount: remaining, remaining: [] as string[] };
    });
  }, [expectedLines, inspections, scannedSerials]);

  const handleScanSubmit = useCallback(async (raw: string) => {
    const serial = raw.trim();
    if (!serial) return;
    // Guess the line: first expected line whose serial list contains it,
    // else defaultLineId, else first expected line.
    const explicit = expectedLines.find(
      l => l.serials?.some(s => s.toLowerCase() === serial.toLowerCase()),
    );
    const fallback = defaultLineId
      ? expectedLines.find(l => l.lineId === defaultLineId)
      : expectedLines[0];
    const line = explicit ?? fallback;
    if (!line) {
      feedbackError();
      toast.error('No expected lines to scan against');
      return;
    }
    try {
      await recordScan.mutateAsync({
        documentLineId: line.lineId,
        serialNumber: serial,
        productId: line.productId,
        expectedLines,
      });
      feedbackSuccess();
      setScanValue('');
      scanRef.current?.focus();
    } catch (e: any) {
      feedbackError();
      toast.error(e?.message ?? 'Scan failed');
    }
  }, [expectedLines, defaultLineId, recordScan]);

  const handleResult = async (inspection: QCInspection, status: 'pass' | 'fail') => {
    try {
      await recordResult.mutateAsync({
        inspectionId: inspection.id,
        status,
        notes: notesById[inspection.id],
      });
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save result');
    }
  };

  const handleUpload = async (inspection: QCInspection, file: File | undefined) => {
    if (!file) return;
    try {
      await uploadPhoto.mutateAsync({ inspection, file });
    } catch (e: any) {
      toast.error(e?.message ?? 'Upload failed');
    }
  };

  return (
    <div className="space-y-4">
      {/* Progress header */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-medium">
              Scanned {progress.scanned} / {progress.totalExpected}
              <span className="text-muted-foreground">
                {' · '}Passed {progress.passed} · Failed {progress.failed} · Pending {progress.pending}
              </span>
            </div>
            <div className="flex gap-2">
              <Badge variant="secondary">{documentType.replace('_', ' ')}</Badge>
            </div>
          </div>
          <Progress
            value={progress.totalExpected === 0 ? 0 : (progress.scanned / progress.totalExpected) * 100}
          />
        </CardContent>
      </Card>

      {/* Scan input */}
      <Card>
        <CardContent className="p-4">
          <form
            onSubmit={e => { e.preventDefault(); void handleScanSubmit(scanValue); }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div className="flex-1 flex items-center gap-2">
              <ScanBarcode className="h-5 w-5 text-muted-foreground shrink-0" />
              <Input
                ref={scanRef}
                value={scanValue}
                onChange={e => setScanValue(e.target.value)}
                placeholder="Scan or type serial, press Enter"
                className="h-11 text-base"
                autoFocus
                inputMode="text"
                autoComplete="off"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="h-11" disabled={recordScan.isPending}>
                {recordScan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setCameraOpen(true)}
              >
                <Camera className="h-4 w-4 mr-2" /> Camera
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Scanned list */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 pb-2 text-sm font-medium">Scanned units</div>
          {isLoading && (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          )}
          {!isLoading && inspections.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">No units scanned yet.</div>
          )}
          <ul className="divide-y">
            {inspections.map(i => {
              const line = i.documentLineId ? lineById.get(i.documentLineId) : undefined;
              const missingPhoto = requirePhotos && i.qcStatus === 'fail' && i.photoUrls.length === 0;
              return (
                <li
                  key={i.id}
                  className={cn(
                    'p-4 space-y-3',
                    missingPhoto && 'bg-destructive/5 border-l-4 border-destructive',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-sm font-semibold">{i.serialNumber}</div>
                      <div className="text-xs text-muted-foreground">
                        {line?.productName ?? '—'}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={i.qcStatus === 'pass' ? 'default' : 'outline'}
                        className={cn(
                          'h-10 px-4',
                          i.qcStatus === 'pass' && 'bg-emerald-600 hover:bg-emerald-700 text-white',
                        )}
                        onClick={() => handleResult(i, 'pass')}
                        disabled={recordResult.isPending}
                      >
                        <Check className="h-4 w-4 mr-1" /> Pass
                      </Button>
                      <Button
                        size="sm"
                        variant={i.qcStatus === 'fail' ? 'destructive' : 'outline'}
                        className="h-10 px-4"
                        onClick={() => handleResult(i, 'fail')}
                        disabled={recordResult.isPending}
                      >
                        <X className="h-4 w-4 mr-1" /> Fail
                      </Button>
                    </div>
                  </div>

                  {i.qcStatus === 'fail' && (
                    <Textarea
                      value={notesById[i.id] ?? i.qcNotes ?? ''}
                      onChange={e => setNotesById(m => ({ ...m, [i.id]: e.target.value }))}
                      onBlur={() => {
                        const v = notesById[i.id];
                        if (v != null && v !== (i.qcNotes ?? '')) {
                          recordResult.mutate({ inspectionId: i.id, status: 'fail', notes: v });
                        }
                      }}
                      placeholder="Reason for failure"
                      className="text-sm"
                    />
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {i.photoUrls.map(url => (
                      <div key={url} className="relative">
                        <img
                          src={url}
                          alt="QC"
                          className="h-16 w-16 rounded object-cover border"
                        />
                        <button
                          type="button"
                          className="absolute -top-1 -right-1 bg-background border rounded-full p-0.5"
                          onClick={() => removePhoto.mutate({ inspection: i, url })}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <label className="inline-flex items-center gap-2 h-16 w-16 border-2 border-dashed rounded cursor-pointer justify-center text-muted-foreground hover:bg-muted">
                      <ImagePlus className="h-5 w-5" />
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          void handleUpload(i, f ?? undefined);
                        }}
                      />
                    </label>
                    {missingPhoto && (
                      <span className="text-xs text-destructive inline-flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Photo required
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Expected-but-not-scanned */}
          {pendingBySerial.some(p =>
            ('remaining' in p && p.remaining.length > 0) ||
            ('remainingCount' in p && (p.remainingCount ?? 0) > 0),
          ) && (
            <>
              <Separator />
              <div className="p-4">
                <div className="text-sm font-medium mb-2">Awaiting scan</div>
                <ul className="space-y-2">
                  {pendingBySerial.flatMap(p => {
                    if (p.remaining.length > 0) {
                      return p.remaining.map(s => (
                        <li key={`${p.line.lineId}-${s}`} className="flex items-center justify-between text-sm text-muted-foreground">
                          <span className="font-mono">{s}</span>
                          <span className="text-xs">{p.line.productName}</span>
                        </li>
                      ));
                    }
                    const remaining = (p as any).remainingCount as number;
                    if (!remaining) return [];
                    return [
                      <li key={p.line.lineId} className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>{p.line.productName}</span>
                        <span className="text-xs">{remaining} remaining</span>
                      </li>,
                    ];
                  })}
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Complete */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sticky bottom-0 bg-background p-3 border-t">
        <div className="text-xs text-muted-foreground">
          {readiness.ready ? 'Ready to complete.' : readiness.reasons.join(' · ')}
        </div>
        <Button
          size="lg"
          onClick={() => void onComplete()}
          disabled={!readiness.ready || completing}
        >
          {completing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {completeButtonLabel}
        </Button>
      </div>

      <CameraScannerDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onScanned={value => { setScanValue(value); void handleScanSubmit(value); }}
      />
    </div>
  );
}

export default ScanQCPanel;