/**
 * /design-preview — standalone review page for the design system.
 *
 * DUMMY DATA ONLY. No Supabase, no hooks, no services, no routing side
 * effects. Safe to delete wholesale; nothing else imports it.
 */
import * as React from 'react';
import './tokens.css';
import {
  Button, Card, StatusPill, StatusRibbon, FilterChip, Avatar, SectionLabel,
  OverviewCard, OverviewGrid, DocumentHeader, DocumentFields, DocumentTabs,
  Chatter, DocumentList, CogMenu,
  BarcodeScanList, BarcodeSettingsSheet, BarcodeStatusScreen,
  type ListFilter, type ListViewMode, type DocumentField, type ScanLineItem,
} from './index';
import {
  demoOverviewCards, demoRows, demoFilters, demoStages, demoChatter,
  barFilterLabels, demoScanLines, demoScanReference, demoScanPerson,
} from './demoData';

/* --------------------------------------------------------------- shell */

function Section({
  n, title, note, children, bleed = false,
}: {
  n: number;
  title: string;
  note?: string;
  children: React.ReactNode;
  bleed?: boolean;
}) {
  return (
    <section className="mb-8 scroll-mt-4" id={`s${n}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <SectionLabel>
          {String(n).padStart(2, '0')} — {title}
        </SectionLabel>
        {note && (
          <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
            {note}
          </span>
        )}
      </div>
      <div className={bleed ? '' : ''}>{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------- page */

export default function DesignPreview() {
  // Bar-click interaction: clicking a bar switches the page to the list with
  // a filter chip applied. Pure in-page state — no routing, no data.
  const [filters, setFilters] = React.useState<ListFilter[]>(demoFilters);
  const [viewMode, setViewMode] = React.useState<ListViewMode>('list');
  const [segment, setSegment] = React.useState('moves');
  const [flash, setFlash] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Barcode workspace state — proves the +N quick-add is live, not a mock.
  const [scanLines, setScanLines] = React.useState<ScanLineItem[]>(demoScanLines);
  const [showSettings, setShowSettings] = React.useState(false);

  const quickAdd = (id: string, amount: number) =>
    setScanLines((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, scanned: Math.min(l.total, l.scanned + amount) } : l,
      ),
    );
  const resetScan = () => setScanLines(demoScanLines);

  // Separate from `flash` so barcode actions never render under section 7's
  // "Filter applied from chart" label.
  const [scanNote, setScanNote] = React.useState<string | null>(null);
  const notifyScan = (msg: string) => {
    setScanNote(msg);
    window.setTimeout(() => setScanNote(null), 2600);
  };

  const applyBarFilter = (source: string, filterKey: string) => {
    const label = barFilterLabels[filterKey] ?? filterKey;
    const key = `bar:${source}:${filterKey}`;
    setFilters((prev) => [
      ...prev.filter((f) => !f.key.startsWith('bar:')),
      { key, label: source, value: label },
    ]);
    setFlash(`${source} → ${label}`);
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => setFlash(null), 2600);
  };

  const removeFilter = (key: string) =>
    setFilters((prev) => prev.filter((f) => f.key !== key));

  // Rows are filtered only enough to prove the interaction is live.
  const visibleRows = React.useMemo(() => {
    const barFilter = filters.find((f) => f.key.startsWith('bar:'));
    if (!barFilter) return demoRows;
    if (barFilter.key.endsWith(':late')) return demoRows.filter((r) => r.late);
    return demoRows;
  }, [filters]);

  const fieldsLeft: DocumentField[] = [
    { key: 'contact', label: 'Delivery Address', value: 'Ashwin Furnishings Pvt Ltd', link: true },
    { key: 'optype', label: 'Operation Type', value: 'Main Warehouse: Delivery Orders' },
    { key: 'srcloc', label: 'Source Location', value: 'WH/Stock' },
    { key: 'destloc', label: 'Destination Location', value: 'Partner Locations/Customers' },
  ];
  const fieldsRight: DocumentField[] = [
    { key: 'sched', label: 'Scheduled Date', value: '28/07/2026 10:00:00' },
    { key: 'deadline', label: 'Deadline', value: '28/07/2026', muted: false },
    { key: 'source', label: 'Source Document', value: 'SO/2026/0311', link: true },
    { key: 'responsible', label: 'Responsible', value: (
      <span className="inline-flex items-center gap-1.5">
        <Avatar name="Priya Nair" size={18} /> Priya Nair
      </span>
    ) },
  ];

  return (
    <div className="ds-root min-h-screen bg-[hsl(var(--ds-canvas))]">
      {/* preview banner — not part of the design language */}
      <div className="border-b border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-surface))] px-4 py-2.5">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[15px] font-semibold">Design System Preview</span>
          <StatusPill tone="amber">Dummy data</StatusPill>
          <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
            Odoo-Enterprise density · app maroon{' '}
            <code className="rounded bg-[hsl(var(--ds-surface-sunken))] px-1">
              hsl(0 70% 35.3%)
            </code>
          </span>
          <span className="ml-auto text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
            Narrow the window to check the responsive behaviour
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-[1180px] px-4 py-5">
        {/* 1 + 2 — Overview */}
        <Section
          n={1}
          title="OverviewCard + OverviewGrid"
          note="Click any bar → jumps to the list below with a filter chip applied"
        >
          <OverviewGrid>
            {demoOverviewCards.map((c) => (
              <OverviewCard
                key={c.id}
                title={c.title}
                subtitle={c.subtitle}
                actionLabel={c.actionLabel}
                accent={c.accent}
                stats={c.stats.map((s) => ({
                  ...s,
                  onClick: () => applyBarFilter(c.title, s.key === 'late' ? 'late' : 'today'),
                }))}
                bars={c.bars}
                onBarClick={(k) => applyBarFilter(c.title, k)}
                menu={<CogMenu />}
              />
            ))}
          </OverviewGrid>
        </Section>

        {/* 3 — DocumentHeader */}
        <Section n={3} title="DocumentHeader" note="breadcrumb · actions · segmented toggle · pager · status ribbon">
          <DocumentHeader
            breadcrumb={['Inventory', 'Transfers', 'WH/OUT/00142']}
            title="WH/OUT/00142"
            actions={[
              { key: 'todo', label: 'Mark as To-do', variant: 'primary' },
              { key: 'validate', label: 'Validate', variant: 'outline' },
              { key: 'print', label: 'Print', variant: 'outline' },
              { key: 'cancel', label: 'Cancel', variant: 'danger' },
            ]}
            segments={[
              { key: 'moves', label: 'Moves' },
              { key: 'barcode', label: 'Barcode' },
            ]}
            activeSegment={segment}
            onSegmentChange={setSegment}
            stages={demoStages}
            currentStage="progress"
            pager={{ index: 1, total: 14 }}
          />

          {/* 4 + 5 — the header's body, shown attached as it would be in situ */}
          <div className="border-x border-b border-[hsl(var(--ds-border))] bg-[hsl(var(--ds-surface))]">
            <DocumentFields columns={[fieldsLeft, fieldsRight]} />
            <div className="border-t border-[hsl(var(--ds-border))]">
              <DocumentTabs
                tabs={[
                  {
                    key: 'ops',
                    label: 'Operations',
                    badge: 3,
                    content: (
                      <div className="ds-scroll-x">
                        <table className="w-full min-w-[520px] text-[var(--ds-fs-sm)]">
                          <thead>
                            <tr className="bg-[hsl(var(--ds-surface-alt))] text-[var(--ds-fs-xs)] uppercase tracking-wide text-[hsl(var(--ds-ink-subtle))]">
                              <th className="border-b border-[hsl(var(--ds-border))] px-2 py-1.5 text-left">Product</th>
                              <th className="border-b border-[hsl(var(--ds-border))] px-2 py-1.5 text-left">From</th>
                              <th className="border-b border-[hsl(var(--ds-border))] px-2 py-1.5 text-right">Demand</th>
                              <th className="border-b border-[hsl(var(--ds-border))] px-2 py-1.5 text-right">Reserved</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              ['Teak Dining Table — 6 Seater', 'WH/Stock/A-01', 2, 2],
                              ['Upholstered Dining Chair — Charcoal', 'WH/Stock/A-04', 12, 10],
                              ['Sideboard — Walnut 1800mm', 'WH/Stock/B-02', 1, 1],
                            ].map(([p, loc, d, r]) => (
                              <tr key={String(p)} className="border-b border-[hsl(var(--ds-border)/0.6)]">
                                <td className="px-2 py-1.5">{p}</td>
                                <td className="px-2 py-1.5 text-[hsl(var(--ds-ink-muted))]">{loc}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">{d}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">
                                  {Number(r) < Number(d) ? (
                                    <span className="font-semibold text-[hsl(var(--ds-amber))]">{r}</span>
                                  ) : r}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ),
                  },
                  {
                    key: 'info',
                    label: 'Additional Info',
                    content: (
                      <DocumentFields
                        className="px-0 py-0"
                        columns={[[
                          { key: 'carrier', label: 'Carrier', value: 'In-house fleet' },
                          { key: 'weight', label: 'Shipping Weight', value: '212.5 kg' },
                        ], [
                          { key: 'policy', label: 'Shipping Policy', value: 'As soon as possible' },
                          { key: 'company', label: 'Company', value: 'Furniture Co.' },
                        ]]}
                      />
                    ),
                  },
                  {
                    key: 'note',
                    label: 'Note',
                    content: (
                      <p className="text-[var(--ds-fs-sm)] italic text-[hsl(var(--ds-ink-subtle))]">
                        Deliver to the service entrance on the north side. Building
                        manager must be notified 30 minutes ahead.
                      </p>
                    ),
                  },
                ]}
              />
            </div>
          </div>
        </Section>

        {/* 6 — Chatter */}
        <Section n={6} title="Chatter" note="presentation only — grouped by day; toolbar is visual">
          <Chatter entries={demoChatter} followers={4} />
        </Section>

        {/* 7 — DocumentList */}
        <div ref={listRef}>
          <Section
            n={7}
            title="DocumentList"
            note={flash ? undefined : 'filter chips · search · view switcher · pager · status pills'}
          >
            {flash && (
              <div
                role="status"
                className="mb-2 inline-flex items-center gap-2 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-primary)/0.3)] bg-[hsl(var(--ds-primary)/0.07)] px-2.5 py-1.5 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-primary))]"
              >
                <span className="font-semibold">Filter applied from chart:</span>
                {flash}
              </div>
            )}
            <DocumentList
              title="Transfers"
              rows={visibleRows}
              filters={filters}
              onRemoveFilter={removeFilter}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              page={{ from: 1, to: visibleRows.length, total: 87 }}
            />
            {viewMode !== 'list' && (
              <p className="mt-2 text-[var(--ds-fs-xs)] italic text-[hsl(var(--ds-ink-subtle))]">
                {viewMode} view is not part of this pass — the switcher is here to show the control.
              </p>
            )}
          </Section>
        </div>

        {/* 8 — CogMenu */}
        <Section n={8} title="CogMenu" note="click the gear — Print opens a submenu">
          <Card className="flex flex-wrap items-center gap-6 p-3">
            <div className="flex items-center gap-2">
              <span className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">Bare:</span>
              <CogMenu align="left" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[var(--ds-fs-sm)] text-[hsl(var(--ds-ink-muted))]">Bordered:</span>
              <CogMenu align="left" bordered />
            </div>
          </Card>
        </Section>

        {/* 9 — Barcode */}
        <Section
          n={9}
          title="Barcode workspace"
          note="deliberately different — dark chrome, light list body; +N buttons are live"
        >
          {scanNote && (
            <div
              role="status"
              className="mb-2 inline-flex items-center gap-2 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-primary)/0.3)] bg-[hsl(var(--ds-primary)/0.07)] px-2.5 py-1.5 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-primary))]"
            >
              {scanNote}
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[var(--ds-fs-xs)] font-semibold text-[hsl(var(--ds-ink-muted))]">
                9a · BarcodeScanList — the working screen
              </p>
              <BarcodeScanList
                reference={demoScanReference}
                person={demoScanPerson}
                lines={scanLines}
                onQuickAdd={quickAdd}
                onOpenSettings={() => setShowSettings(true)}
                onValidate={() => notifyScan('Validate pressed (dummy)')}
              />
              <button
                type="button"
                onClick={resetScan}
                className="mt-1.5 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-link))] hover:underline"
              >
                Reset scan counts
              </button>
            </div>

            <div>
              <p className="mb-1.5 text-[var(--ds-fs-xs)] font-semibold text-[hsl(var(--ds-ink-muted))]">
                9b · BarcodeSettingsSheet — the cog page
                {showSettings && ' (opened from 9a)'}
              </p>
              <BarcodeSettingsSheet
                reference={demoScanReference}
                person={demoScanPerson}
                onClose={() => setShowSettings(false)}
                onApplyBarcode={(v) => notifyScan(v ? `Barcode applied: ${v}` : 'Enter a barcode first')}
              />
            </div>
          </div>

          <p className="mb-1.5 mt-4 text-[var(--ds-fs-xs)] font-semibold text-[hsl(var(--ds-ink-muted))]">
            9c · BarcodeStatusScreen — terminal states (was BarcodeScanScreen)
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <BarcodeStatusScreen
              reference="WH/OUT/00142"
              person="Priya Nair"
              message="This picking is already done"
              hint="Nothing left to scan. Go back to the transfer to review the moves."
              tone="warning"
            />
            <BarcodeStatusScreen
              reference="WH/IN/00088"
              person="Deepak Iyer"
              message="14 of 16 units scanned"
              hint="Scan the remaining two serials to complete this receipt."
              tone="info"
            />
          </div>
        </Section>

        {/* 10 — primitives */}
        <Section n={10} title="Primitives" note="tokens defined once in tokens.css">
          <div className="grid gap-3 md:grid-cols-2">
            <Card className="p-3">
              <SectionLabel>Buttons</SectionLabel>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button variant="primary">Primary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="subtle">Subtle</Button>
                <Button variant="danger">Cancel</Button>
                <Button variant="link">Link</Button>
                <Button variant="primary" disabled>Disabled</Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary">Small</Button>
                <Button size="sm" variant="outline">Small</Button>
              </div>
            </Card>

            <Card className="p-3">
              <SectionLabel>Status pills</SectionLabel>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusPill tone="grey">Draft</StatusPill>
                <StatusPill tone="amber">Waiting</StatusPill>
                <StatusPill tone="blue">In Progress</StatusPill>
                <StatusPill tone="green">Done</StatusPill>
                <StatusPill tone="red">Late</StatusPill>
              </div>
            </Card>

            <Card className="p-3">
              <SectionLabel>Status ribbon</SectionLabel>
              <div className="mt-2 space-y-2">
                <StatusRibbon stages={demoStages} current="draft" />
                <StatusRibbon stages={demoStages} current="progress" />
                <StatusRibbon stages={demoStages} current="done" />
              </div>
            </Card>

            <Card className="p-3">
              <SectionLabel>Filter chips · avatars</SectionLabel>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <FilterChip label="Operation Type" value="Delivery Orders" onRemove={() => {}} />
                <FilterChip value="Waiting or Ready" onRemove={() => {}} />
                <FilterChip label="After" value="01/07/2026" onRemove={() => {}} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {['Priya Nair', 'Rahul Menon', 'Deepak Iyer', 'Sneha Raj'].map((n) => (
                  <span key={n} className="inline-flex items-center gap-1.5 text-[var(--ds-fs-sm)]">
                    <Avatar name={n} size={22} /> {n}
                  </span>
                ))}
              </div>
            </Card>

            <Card className="p-3 md:col-span-2">
              <SectionLabel>Colour tokens</SectionLabel>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {[
                  ['Primary', 'hsl(var(--ds-primary))'],
                  ['Primary hover', 'hsl(var(--ds-primary-hover))'],
                  ['Canvas', 'hsl(var(--ds-canvas))'],
                  ['Surface', 'hsl(var(--ds-surface))'],
                  ['Border', 'hsl(var(--ds-border))'],
                  ['Link', 'hsl(var(--ds-link))'],
                  ['Amber', 'hsl(var(--ds-amber))'],
                  ['Green', 'hsl(var(--ds-green))'],
                  ['Blue', 'hsl(var(--ds-blue))'],
                  ['Red', 'hsl(var(--ds-red))'],
                  ['Ink', 'hsl(var(--ds-ink))'],
                  ['Navy', 'hsl(var(--ds-navy))'],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <div
                      className="h-9 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-border))]"
                      style={{ background: value }}
                    />
                    <div className="mt-1 truncate text-[10px] text-[hsl(var(--ds-ink-subtle))]">
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </Section>

        <p className="pb-6 text-center text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
          Dummy data only · no Supabase calls · no existing screen touched
        </p>
      </div>
    </div>
  );
}
