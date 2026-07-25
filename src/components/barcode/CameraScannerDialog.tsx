import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertCircle, Camera } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScanned: (text: string) => void;
}

export function CameraScannerDialog({ open, onOpenChange, onScanned }: Props) {
  const elId = useRef(`html5-qr-${Math.random().toString(36).slice(2, 9)}`);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const describeError = (e: unknown): string => {
    const err = e as { name?: string; message?: string };
    const name = err?.name || '';
    const msg = err?.message || '';
    if (name === 'NotAllowedError' || /Permission|denied/i.test(msg)) {
      return 'Camera permission denied. Enable camera access in your browser settings and retry.';
    }
    if (name === 'NotFoundError' || /No camera|not found|no device/i.test(msg)) {
      return 'No camera was found on this device.';
    }
    if (name === 'NotReadableError' || /in use|busy/i.test(msg)) {
      return 'The camera is being used by another app. Close it and retry.';
    }
    return msg || 'Unable to start the camera.';
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    const start = async () => {
      try {
        scannerRef.current = new Html5Qrcode(elId.current);
        await scannerRef.current.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 150 } },
          (decoded) => {
            if (cancelled) return;
            onScanned(decoded);
            void scannerRef.current?.stop().catch(() => undefined);
            onOpenChange(false);
          },
          () => undefined,
        );
      } catch (e) {
        if (!cancelled) setError(describeError(e));
      }
    };
    void start();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        Promise.resolve(s.stop()).catch(() => undefined).finally(() => {
          try { s.clear(); } catch { /* ignore */ }
        });
      }
    };
  }, [open, onScanned, onOpenChange, attempt]);

  const retry = useCallback(() => setAttempt(a => a + 1), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Camera Scan</DialogTitle>
          <DialogDescription>Point your camera at a barcode.</DialogDescription>
        </DialogHeader>
        <div id={elId.current} className="w-full rounded-md overflow-hidden bg-black min-h-[200px]" />
        {error && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <div className="flex items-start gap-2 text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1">{error}</div>
            </div>
            <div className="mt-3 flex justify-end">
              <Button size="sm" variant="outline" onClick={retry}>
                <Camera className="h-3.5 w-3.5 mr-1.5" /> Retry
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default CameraScannerDialog;