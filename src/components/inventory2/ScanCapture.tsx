/**
 * Inventory 2 — scan capture. Two input paths, one callback.
 *
 * 1. HANDHELD (the default). Keyboard-emulating scanners type the barcode and
 *    press Enter. There is no device API to bind to, so capture is a hidden
 *    input that keeps the focus. The refocus loop is deliberately polite: it
 *    only reclaims focus when nothing else interactive holds it, so tapping the
 *    cost field or a line button does not fight the scanner. Tap anywhere
 *    neutral and the gun is live again.
 *
 * 2. CAMERA (opt-in). html5-qrcode 2.3.8, already in package.json — no new
 *    dependency. Run PERSISTENTLY: a bay operator scans many units in a row,
 *    so the camera stays live across decodes instead of tearing down per scan.
 *
 *    `formatsToSupport` is restricted to the formats actually in use. Narrowing
 *    the set is what makes 1D decoding quick; handing the decoder every format
 *    it knows makes it hunt.
 *
 *    `useBarCodeDetectorIfSupported: true` opts into the browser's native
 *    BarcodeDetector, which Android Chrome has and which is markedly better on
 *    1D codes than the bundled ZXing port. Note this is html5-qrcode's DEFAULT
 *    when no config object is passed — but we pass one for the formats, and the
 *    library reads the flag off that same object, so setting it explicitly is
 *    what keeps the native path on.
 *
 * NOT the legacy CameraScannerDialog: that one stops the camera and closes
 * itself on the first decode. It was read for information and nothing is
 * imported from it.
 */
import * as React from 'react';
import { Camera, CameraOff, Keyboard, ScanLine } from 'lucide-react';
import { cn } from '@/design-system';
import { errorText } from '@/lib/inventory2/errorText';

/** Elements that legitimately own the focus; the wedge must not fight them. */
const INTERACTIVE = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A']);

/** Two decodes of the same code inside this window are one scan, not two. */
const CAMERA_REPEAT_MS = 1500;

export interface ScanCaptureProps {
  onScan: (code: string) => void;
  /**
   * False while a confirmation is open or the document refuses scanning. The
   * wedge stops reclaiming focus and the camera pauses, so a scan cannot land
   * behind a dialog the operator is still reading.
   */
  enabled: boolean;
  /** Shown in the scan strip: what the next scan will do. */
  hint: string;
}

export function ScanCapture({ onScan, enabled, hint }: ScanCaptureProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [buffer, setBuffer] = React.useState('');
  const [cameraOn, setCameraOn] = React.useState(false);
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState(false);

  /* -- handheld: keep the focus, politely ------------------------------- */

  const reclaim = React.useCallback(() => {
    if (!enabled) return;
    const el = inputRef.current;
    if (!el) return;
    const active = document.activeElement;
    if (active === el) return;
    // Someone else is legitimately typing — leave them alone.
    if (active && active !== document.body) {
      const tag = active.tagName;
      if (INTERACTIVE.has(tag)) return;
      if ((active as HTMLElement).isContentEditable) return;
    }
    el.focus();
  }, [enabled]);

  React.useEffect(() => {
    reclaim();
    const id = window.setInterval(reclaim, 400);
    window.addEventListener('focus', reclaim);
    document.addEventListener('pointerup', reclaim);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', reclaim);
      document.removeEventListener('pointerup', reclaim);
    };
  }, [reclaim]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = buffer.trim();
    setBuffer('');
    if (code) onScan(code);
  }

  /* -- camera: persistent ----------------------------------------------- */

  const lastDecode = React.useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const onScanRef = React.useRef(onScan);
  onScanRef.current = onScan;
  const enabledRef = React.useRef(enabled);
  enabledRef.current = enabled;

  React.useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    let scanner: import('html5-qrcode').Html5Qrcode | null = null;
    setCameraError(null);

    void (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        if (cancelled) return;
        scanner = new Html5Qrcode('inv2-scan-camera', {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
          ],
          useBarCodeDetectorIfSupported: true,
          verbose: false,
        });
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 260, height: 170 } },
          (decoded) => {
            if (cancelled || !enabledRef.current) return;
            const now = Date.now();
            const last = lastDecode.current;
            if (last.code === decoded && now - last.at < CAMERA_REPEAT_MS) return;
            lastDecode.current = { code: decoded, at: now };
            onScanRef.current(decoded);
            // Deliberately no stop() — the camera stays live for the next unit.
          },
          () => undefined,
        );
      } catch (e) {
        if (!cancelled) setCameraError(errorText(e));
      }
    })();

    return () => {
      cancelled = true;
      const s = scanner;
      scanner = null;
      if (!s) return;

      const drop = () => {
        try { s.clear(); } catch { /* element already gone */ }
      };

      // stop() THROWS SYNCHRONOUSLY ("Cannot stop, scanner is not running or
      // paused") when start() never reached the running state — a device with
      // no camera, a denied permission, or a toggle-off while starting. A bare
      // Promise.resolve(s.stop()).catch() does not help: the call is evaluated
      // before the wrapper exists, so the throw escapes the effect cleanup and
      // takes the whole screen to the error boundary. Found exactly that way in
      // the Pass 7 preview.
      if (!s.isScanning) {
        drop();
        return;
      }
      try {
        Promise.resolve(s.stop()).catch(() => undefined).finally(drop);
      } catch {
        drop();
      }
    };
  }, [cameraOn]);

  return (
    <div className="border-y border-white/10" style={{ background: 'hsl(var(--ds-navy))' }}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <ScanLine className="h-5 w-5 shrink-0 text-white/70" aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-white">{hint}</div>
          <div className="flex items-center gap-1.5 text-[var(--ds-fs-xs)] text-white/55">
            <Keyboard className="h-3 w-3 shrink-0" aria-hidden />
            {!enabled
              ? 'Scanning paused'
              : focused
                ? 'Handheld ready — scan now'
                : 'Tap here to arm the handheld scanner'}
            {buffer && (
              <span className="ml-1 font-mono text-white/80">{buffer}</span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setCameraOn((v) => !v)}
          aria-pressed={cameraOn}
          className={cn(
            'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--ds-radius)] px-3',
            'text-[var(--ds-fs-sm)] font-semibold transition-colors',
            cameraOn
              ? 'bg-white/90 text-[hsl(var(--ds-navy))]'
              : 'border border-white/25 text-white/80 hover:bg-white/10',
          )}
        >
          {cameraOn ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
          {cameraOn ? 'Camera off' : 'Camera'}
        </button>
      </div>

      {/*
        The wedge. Offscreen rather than display:none — a hidden input cannot
        hold focus. inputMode="none" keeps the on-screen keyboard down on a
        tablet while still accepting the handheld's keystrokes.
      */}
      <input
        ref={inputRef}
        value={buffer}
        onChange={(e) => setBuffer(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={!enabled}
        inputMode="none"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Barcode scanner input"
        className="absolute left-[-9999px] h-px w-px opacity-0"
      />

      {cameraOn && (
        <div className="px-3 pb-3">
          <div
            id="inv2-scan-camera"
            className="mx-auto w-full max-w-[420px] overflow-hidden rounded-[var(--ds-radius)] bg-black"
            style={{ minHeight: 180 }}
          />
          {cameraError && (
            <p
              role="alert"
              className="mt-2 rounded-[var(--ds-radius)] bg-[hsl(var(--ds-red))] px-3 py-2 text-[var(--ds-fs-sm)] font-medium text-white"
            >
              {cameraError}
            </p>
          )}
          <p className="mt-2 text-center text-[var(--ds-fs-xs)] text-white/50">
            Camera stays on between units. The handheld scanner still works while it runs.
          </p>
        </div>
      )}
    </div>
  );
}
