/**
 * BarcodeSettingsSheet — the cog/settings page for a scan session.
 *
 * Same split theme as BarcodeScanList: dark header, light body. Reached from
 * the cog in the scan header, so it keeps the document reference visible —
 * the operator must never lose track of which transfer they are in.
 *
 * Destructive action (Cancel Transfer) sits alone at the bottom, separated by
 * a rule, so it can't be hit while reaching for Print.
 *
 * Presentation only.
 */
import * as React from 'react';
import { X, Printer, Package, Ban, Barcode } from 'lucide-react';
import { cn } from '../lib/cn';

export interface BarcodeSettingsSheetProps {
  reference: string;
  person?: string;
  onClose?: () => void;
  onApplyBarcode?: (value: string) => void;
  onPrint?: (key: 'picking' | 'delivery' | 'barcodes') => void;
  onCreateProduct?: () => void;
  onCancelTransfer?: () => void;
  framed?: boolean;
  className?: string;
}

function SheetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-3 py-3">
      <h3 className="mb-2 text-[var(--ds-fs-xs)] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--ds-ink-subtle))]">
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function SheetButton({
  children,
  icon: Icon,
  tone = 'subtle',
  onClick,
}: {
  children: React.ReactNode;
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  tone?: 'subtle' | 'danger';
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-[var(--ds-radius)] border px-3 py-2.5',
        'text-[var(--ds-fs-base)] font-medium transition-colors',
        tone === 'danger'
          ? cn(
              'border-[hsl(var(--ds-red)/0.45)] bg-[hsl(var(--ds-red-bg))] text-[hsl(var(--ds-red))]',
              'hover:bg-[hsl(var(--ds-red))] hover:text-white',
            )
          : cn(
              'border-[hsl(var(--ds-border-strong))] bg-[hsl(var(--ds-surface))] text-[hsl(var(--ds-ink))]',
              'hover:bg-[hsl(var(--ds-surface-sunken))] hover:border-[hsl(var(--ds-primary))]',
            ),
      )}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0 opacity-70" />}
      {children}
    </button>
  );
}

export function BarcodeSettingsSheet({
  reference,
  person,
  onClose,
  onApplyBarcode,
  onPrint,
  onCreateProduct,
  onCancelTransfer,
  framed = true,
  className,
}: BarcodeSettingsSheetProps) {
  const [barcode, setBarcode] = React.useState('');

  const apply = () => {
    onApplyBarcode?.(barcode);
    setBarcode('');
  };

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden',
        framed ? 'h-[560px] rounded-[var(--ds-radius)]' : 'min-h-screen',
        className,
      )}
      style={{ background: 'hsl(var(--ds-navy))' }}
    >
      {/* header */}
      <div
        className="flex shrink-0 items-center gap-2 px-2.5 py-2.5 text-[hsl(var(--ds-navy-fg))]"
        style={{ background: 'hsl(var(--ds-navy-soft))' }}
      >
        <div className="min-w-0 flex-1 pl-1">
          <div className="truncate text-[14px] font-semibold leading-tight">{reference}</div>
          {person && (
            <div className="truncate text-[var(--ds-fs-xs)] leading-tight text-white/55">
              {person}
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Close settings"
          onClick={onClose}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--ds-radius)] hover:bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--ds-surface))]">
        {/* manual barcode entry */}
        <div className="border-b border-[hsl(var(--ds-border))] px-3 py-3">
          <div className="flex gap-1.5">
            <div
              className={cn(
                'flex flex-1 items-center gap-2 rounded-[var(--ds-radius)] border px-2.5',
                'border-[hsl(var(--ds-border-strong))] bg-[hsl(var(--ds-surface))]',
                'focus-within:border-[hsl(var(--ds-primary))]',
              )}
            >
              <Barcode className="h-4 w-4 shrink-0 text-[hsl(var(--ds-ink-subtle))]" />
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
                placeholder="Enter a barcode…"
                aria-label="Enter a barcode"
                className={cn(
                  'w-full bg-transparent py-2.5 text-[var(--ds-fs-base)]',
                  'text-[hsl(var(--ds-ink))] placeholder:text-[hsl(var(--ds-ink-subtle))]',
                  'focus:outline-none',
                )}
              />
            </div>
            <button
              type="button"
              onClick={apply}
              className={cn(
                'shrink-0 rounded-[var(--ds-radius)] px-4 text-[var(--ds-fs-base)] font-semibold',
                'bg-[hsl(var(--ds-primary))] text-[hsl(var(--ds-primary-fg))]',
                'hover:bg-[hsl(var(--ds-primary-hover))]',
              )}
            >
              Apply
            </button>
          </div>
        </div>

        <SheetSection title="Print">
          <SheetButton icon={Printer} onClick={() => onPrint?.('picking')}>
            Print Picking Operations
          </SheetButton>
          <SheetButton icon={Printer} onClick={() => onPrint?.('delivery')}>
            Print Delivery Slip
          </SheetButton>
          <SheetButton icon={Barcode} onClick={() => onPrint?.('barcodes')}>
            Print Barcodes
          </SheetButton>
        </SheetSection>

        <div className="mx-3 h-px bg-[hsl(var(--ds-border))]" />

        <SheetSection title="Operations">
          <SheetButton icon={Package} onClick={onCreateProduct}>
            Create Product
          </SheetButton>
          <SheetButton icon={Ban} tone="danger" onClick={onCancelTransfer}>
            Cancel Transfer
          </SheetButton>
        </SheetSection>
      </div>
    </div>
  );
}
