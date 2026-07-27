/**
 * Dummy data for the design preview. IN-FILE ONLY.
 *
 * Nothing here touches Supabase, hooks, or services. Content is furniture-ERP
 * flavoured so the layout is judged at realistic string lengths — long contact
 * names and reference codes are what break a dense table, not lorem ipsum.
 */
import type { Bar } from './components/BarChart';
import type { OverviewStat } from './components/OverviewCard';
import type { DocumentRow, ListFilter } from './components/DocumentList';
import type { ChatterEntry } from './components/Chatter';
import type { RibbonStage } from './components/primitives';
import type { ScanLineItem } from './components/BarcodeScanList';

/* ------------------------------------------------------------ overview */

export interface DemoOverviewCard {
  id: string;
  title: string;
  subtitle: string;
  actionLabel: string;
  accent: 'primary' | 'blue' | 'green' | 'amber';
  stats: OverviewStat[];
  bars: Bar[];
}

export const demoOverviewCards: DemoOverviewCard[] = [
  {
    id: 'receipts',
    title: 'Receipts',
    subtitle: 'Main Warehouse — Inbound',
    actionLabel: '5 To Process',
    accent: 'primary',
    stats: [
      { key: 'late', label: 'Late', value: 2, alert: true },
      { key: 'ops', label: 'Operations', value: 14 },
      { key: 'waiting', label: 'Waiting', value: 3 },
      { key: 'back', label: 'Back Orders', value: 1 },
    ],
    bars: [
      { key: 'late', label: 'Late', value: 2 },
      { key: 'today', label: 'Today', value: 5 },
      { key: 'week', label: 'This Wk', value: 9 },
      { key: 'next', label: 'Next Wk', value: 6 },
      { key: 'later', label: 'Later', value: 3 },
    ],
  },
  {
    id: 'delivery',
    title: 'Delivery Orders',
    subtitle: 'Main Warehouse — Outbound',
    accent: 'blue',
    actionLabel: '12 To Deliver',
    stats: [
      { key: 'late', label: 'Late', value: 4, alert: true },
      { key: 'ops', label: 'Operations', value: 27 },
      { key: 'waiting', label: 'Waiting', value: 8 },
      { key: 'back', label: 'Back Orders', value: 2 },
    ],
    bars: [
      { key: 'late', label: 'Late', value: 4 },
      { key: 'today', label: 'Today', value: 12 },
      { key: 'week', label: 'This Wk', value: 18 },
      { key: 'next', label: 'Next Wk', value: 7 },
      { key: 'later', label: 'Later', value: 4 },
    ],
  },
  {
    id: 'internal',
    title: 'Internal Transfers',
    subtitle: 'Factory ↔ Showroom',
    accent: 'green',
    actionLabel: '3 To Move',
    stats: [
      { key: 'late', label: 'Late', value: 0 },
      { key: 'ops', label: 'Operations', value: 9 },
      { key: 'waiting', label: 'Waiting', value: 1 },
      { key: 'back', label: 'Back Orders', value: 0 },
    ],
    bars: [
      { key: 'late', label: 'Late', value: 0 },
      { key: 'today', label: 'Today', value: 3 },
      { key: 'week', label: 'This Wk', value: 6 },
      { key: 'next', label: 'Next Wk', value: 2 },
      { key: 'later', label: 'Later', value: 1 },
    ],
  },
  {
    id: 'qc',
    title: 'Quality Control',
    subtitle: 'Pre-delivery inspection',
    accent: 'amber',
    actionLabel: '7 To Inspect',
    stats: [
      { key: 'late', label: 'Late', value: 1, alert: true },
      { key: 'ops', label: 'Operations', value: 11 },
      { key: 'waiting', label: 'Waiting', value: 4 },
      { key: 'back', label: 'Back Orders', value: 0 },
    ],
    bars: [
      { key: 'late', label: 'Late', value: 1 },
      { key: 'today', label: 'Today', value: 7 },
      { key: 'week', label: 'This Wk', value: 8 },
      { key: 'next', label: 'Next Wk', value: 3 },
      { key: 'later', label: 'Later', value: 2 },
    ],
  },
];

/** Human labels for the filter a bar click applies. */
export const barFilterLabels: Record<string, string> = {
  late: 'Late',
  today: 'Scheduled: Today',
  week: 'Scheduled: This Week',
  next: 'Scheduled: Next Week',
  later: 'Scheduled: Later',
};

/* ---------------------------------------------------------------- list */

export const demoFilters: ListFilter[] = [
  { key: 'optype', label: 'Operation Type', value: 'Delivery Orders' },
  { key: 'ready', value: 'Waiting or Ready' },
  { key: 'after', label: 'After', value: '01/07/2026' },
];

export const demoRows: DocumentRow[] = [
  {
    id: '1', reference: 'WH/OUT/00142', contact: 'Ashwin Furnishings Pvt Ltd',
    responsible: 'Priya Nair', scheduled: '28/07/2026', sourceDocument: 'SO/2026/0311',
    status: 'Waiting', statusTone: 'amber',
  },
  {
    id: '2', reference: 'WH/OUT/00141', contact: 'Meridian Hotels — Kochi',
    responsible: 'Rahul Menon', scheduled: '24/07/2026', sourceDocument: 'SO/2026/0308',
    status: 'Late', statusTone: 'red', late: true,
  },
  {
    id: '3', reference: 'WH/OUT/00140', contact: 'Sunrise Interiors',
    responsible: 'Priya Nair', scheduled: '29/07/2026', sourceDocument: 'SO/2026/0305',
    status: 'Ready', statusTone: 'green',
  },
  {
    id: '4', reference: 'WH/IN/00088', contact: 'Teakwood Supplies Co.',
    responsible: 'Deepak Iyer', scheduled: '30/07/2026', sourceDocument: 'PO/2026/0074',
    status: 'Draft', statusTone: 'grey',
  },
  {
    id: '5', reference: 'WH/OUT/00139', contact: 'Grand Plaza Residency',
    responsible: 'Sneha Raj', scheduled: '31/07/2026', sourceDocument: 'SO/2026/0299',
    status: 'In Progress', statusTone: 'blue',
  },
  {
    id: '6', reference: 'WH/INT/00021', contact: 'Factory Floor B',
    responsible: 'Deepak Iyer', scheduled: '23/07/2026', sourceDocument: '',
    status: 'Late', statusTone: 'red', late: true,
  },
  {
    id: '7', reference: 'WH/OUT/00138', contact: 'Kaveri Home Decor',
    responsible: 'Rahul Menon', scheduled: '01/08/2026', sourceDocument: 'SO/2026/0294',
    status: 'Waiting', statusTone: 'amber',
  },
  {
    id: '8', reference: 'WH/IN/00087', contact: 'Nilgiri Timber Traders',
    responsible: 'Sneha Raj', scheduled: '02/08/2026', sourceDocument: 'PO/2026/0071',
    status: 'Ready', statusTone: 'green',
  },
];

/* ------------------------------------------------------------- barcode */

export const demoScanReference = 'GLF/ORDER/25-26/00755';
export const demoScanPerson = 'Deepak Iyer · Main Warehouse';

export const demoScanLines: ScanLineItem[] = [
  {
    id: 'sl1',
    code: 'GLF-TBL-1800-TK',
    description: 'Teak Dining Table — 1800mm, natural polish, tapered leg',
    tags: [
      { key: 't1', label: 'Photo Attached', tone: 'link' },
      { key: 't2', label: 'Polish TK GLF-11', tone: 'muted' },
      { key: 't3', label: 'Modified Pattern', tone: 'warn' },
    ],
    partnerLabel: 'Partners/Vendors',
    scanned: 0,
    total: 6,
  },
  {
    id: 'sl2',
    code: 'GLF-CHR-DIN-CHR',
    description: 'Upholstered Dining Chair — charcoal weave, solid frame',
    tags: [
      { key: 't1', label: 'Polish TK GLF-04', tone: 'muted' },
      { key: 't2', label: 'Fabric Approved', tone: 'link' },
    ],
    scanned: 4,
    total: 12,
  },
  {
    id: 'sl3',
    code: 'GLF-SBD-1800-WN',
    description: 'Sideboard — walnut veneer, 1800mm, soft-close runners',
    tags: [
      { key: 't1', label: 'Photo Attached', tone: 'link' },
      { key: 't2', label: 'Handle Variant B', tone: 'muted' },
    ],
    partnerLabel: 'Partners/Vendors',
    scanned: 1,
    total: 1,
  },
  {
    id: 'sl4',
    code: 'GLF-BED-KNG-TK',
    description: 'King Bed Frame — teak, with headboard upholstery',
    tags: [
      { key: 't1', label: 'Assembly Required', tone: 'warn' },
      { key: 't2', label: 'Polish TK GLF-11', tone: 'muted' },
      { key: 't3', label: 'Modified Pattern', tone: 'warn' },
    ],
    scanned: 0,
    total: 2,
  },
  {
    id: 'sl5',
    code: 'GLF-NTS-450-TK',
    description: 'Bedside Table — 450mm, two drawers',
    tags: [{ key: 't1', label: 'Polish TK GLF-11', tone: 'muted' }],
    scanned: 3,
    total: 4,
  },
];

/* ------------------------------------------------------------ document */

export const demoStages: RibbonStage[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

export const demoChatter: ChatterEntry[] = [
  {
    id: 'c1', author: 'Priya Nair', time: '14:32', day: 'Today', kind: 'message',
    body: 'Customer confirmed the delivery window — 28th between 10am and 1pm. Loading bay 2 reserved.',
  },
  {
    id: 'c2', author: 'Rahul Menon', time: '11:05', day: 'Today', kind: 'note',
    body: 'Two of the dining chairs have a minor finish defect. Flagged for QC before dispatch.',
  },
  {
    id: 'c3', author: 'System', time: '09:14', day: 'Today', kind: 'log',
    body: 'Stage changed from Draft to In Progress.',
  },
  {
    id: 'c4', author: 'Deepak Iyer', time: '17:48', day: 'Yesterday', kind: 'message',
    body: 'Serials scanned and reserved against the sales order. 14 of 16 units allocated.',
  },
  {
    id: 'c5', author: 'System', time: '17:40', day: 'Yesterday', kind: 'log',
    body: 'Reservation created for 14 units from Main Warehouse / Stock.',
  },
  {
    id: 'c6', author: 'Sneha Raj', time: '10:22', day: '24 July 2026', kind: 'note',
    body: 'Transfer created from SO/2026/0311. Awaiting stock from the factory.',
  },
];
