/**
 * Labels and option sets for the Operation Types config page.
 *
 * Every option list here mirrors a live CHECK constraint or an established
 * palette — none of it is invented:
 *
 *   operation_kind    CHECK (receipt | delivery | internal_transfer | manufacturing)
 *   create_backorder  CHECK (ask | always | never)
 *   card_color        no CHECK — free text. The swatch set below matches
 *                     COLOR_MAP in InventoryOperationsOverview.tsx and
 *                     CARD_COLORS in the legacy OperationTypesConfig, so a
 *                     colour picked here renders correctly on the overview
 *                     cards instead of silently falling back to gray.
 */
import type { OperationKind, BackorderPolicy } from '@/lib/services/inventory/operationTypes';

export const OPERATION_KIND_OPTIONS: OperationKind[] = [
  'receipt',
  'delivery',
  'internal_transfer',
  'manufacturing',
];

export const OPERATION_KIND_LABELS: Record<OperationKind, string> = {
  receipt: 'Receipt',
  delivery: 'Delivery',
  internal_transfer: 'Internal Transfer',
  manufacturing: 'Manufacturing',
};

export function operationKindLabel(kind: string): string {
  return OPERATION_KIND_LABELS[kind as OperationKind] ?? kind;
}

export const BACKORDER_OPTIONS: BackorderPolicy[] = ['ask', 'always', 'never'];

export const BACKORDER_LABELS: Record<BackorderPolicy, string> = {
  ask: 'Ask',
  always: 'Always',
  never: 'Never',
};

/**
 * Card colours. `swatch` is a raw CSS colour rather than a Tailwind class so the
 * picker renders identically inside `.ds-root`, which does not inherit the
 * app's component palette.
 */
export const CARD_COLOR_OPTIONS: { value: string; label: string; swatch: string }[] = [
  { value: 'gray', label: 'Gray', swatch: 'hsl(215 16% 65%)' },
  { value: 'blue', label: 'Blue', swatch: 'hsl(217 91% 60%)' },
  { value: 'green', label: 'Green', swatch: 'hsl(142 71% 45%)' },
  { value: 'amber', label: 'Amber', swatch: 'hsl(38 92% 50%)' },
  { value: 'red', label: 'Red', swatch: 'hsl(0 84% 60%)' },
  { value: 'purple', label: 'Purple', swatch: 'hsl(271 81% 56%)' },
  { value: 'teal', label: 'Teal', swatch: 'hsl(173 80% 40%)' },
];

export const DEFAULT_CARD_COLOR = 'gray';
