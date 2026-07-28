/**
 * Design system — public surface.
 *
 * Isolated by construction: nothing in this namespace imports from
 * `@/components`, `@/hooks`, `@/lib/services`, or `@/integrations`. It depends
 * only on react, lucide-react, clsx and tailwind-merge.
 *
 * Consumers must import `./tokens.css` and wrap their tree in `.ds-root`.
 */
export { Button, Card, StatusPill, StatusRibbon, FilterChip, Avatar, SectionLabel } from './components/primitives';
export type { ButtonProps, CardProps, StatusTone, RibbonStage } from './components/primitives';

export { BarChart } from './components/BarChart';
export type { Bar } from './components/BarChart';

export { OverviewCard, OverviewGrid } from './components/OverviewCard';
export type { OverviewCardProps, OverviewStat } from './components/OverviewCard';

export { DocumentHeader } from './components/DocumentHeader';
export type { DocumentHeaderProps, HeaderAction, SegmentOption } from './components/DocumentHeader';

export { DocumentFields } from './components/DocumentFields';
export type { DocumentField } from './components/DocumentFields';

export { DocumentTabs } from './components/DocumentTabs';
export type { DocumentTab } from './components/DocumentTabs';

export { Chatter } from './components/Chatter';
export type { ChatterEntry, ChatterKind } from './components/Chatter';

export { DocumentList } from './components/DocumentList';
export type { DocumentListProps, DocumentRow, ListColumn, ListFilter, ListViewMode } from './components/DocumentList';

export { CogMenu } from './components/CogMenu';
export type { CogMenuProps, CogMenuItem } from './components/CogMenu';

export { BarcodeScanList } from './components/BarcodeScanList';
export type { BarcodeScanListProps, ScanLineItem, ScanTag } from './components/BarcodeScanList';

export { BarcodeSettingsSheet } from './components/BarcodeSettingsSheet';
export type { BarcodeSettingsSheetProps } from './components/BarcodeSettingsSheet';

/** Terminal state (was BarcodeScanScreen). The working screen is BarcodeScanList. */
export { BarcodeStatusScreen } from './components/BarcodeStatusScreen';
export type { ScanTone } from './components/BarcodeStatusScreen';

export { cn } from './lib/cn';
