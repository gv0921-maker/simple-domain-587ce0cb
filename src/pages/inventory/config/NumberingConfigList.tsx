/**
 * Document Numbering — list view (rebuilt on the design system).
 *
 * One row per (document_type, fy_label) counter in `numbering_sequences`.
 *
 * Honest about what is configurable. The Prefix column is marked read-only
 * because it is NOT a column on this table — it is a hardcoded CASE inside
 * generate_document_number / preview_next_document_number, so it cannot be
 * changed from here. The Next Number column comes from the
 * preview_next_document_number RPC, i.e. the database's own answer rather than a
 * client-side guess.
 *
 * Reads through the existing numbering service (src/lib/services/numbering/api.ts
 * + src/hooks/numbering). The legacy NumberingSettings page at /settings/numbering
 * is untouched and still routed.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import {
  useNumberingSequences,
  useNumberingSettings,
  useCurrentFY,
  numberingApi,
  numberingKeys,
} from '@/hooks/numbering';
import type { NumberingSequence } from '@/lib/services/numbering/api';
import { DocumentList, StatusPill, type ListColumn } from '@/design-system';
import '@/design-system/tokens.css';
import { documentTypeLabel, prefixFor } from './numberingMeta';

const PAGE_SIZE = 20;

export default function NumberingConfigList() {
  const navigate = useNavigate();
  const sequencesQuery = useNumberingSequences();
  const settingsQuery = useNumberingSettings();
  const fyQuery = useCurrentFY();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const sequences = useMemo(() => sequencesQuery.data ?? [], [sequencesQuery.data]);
  const currentFy = fyQuery.data ?? '';

  // Authoritative next-number previews, straight from the RPC — one call per
  // distinct document type, resolved together. Deliberately not computed
  // client-side: the prefix lives in SQL and must not be second-guessed here.
  const documentTypes = useMemo(
    () => Array.from(new Set(sequences.map((s) => s.document_type))).sort(),
    [sequences],
  );

  const previewsQuery = useQuery({
    queryKey: [...numberingKeys.all, 'previews', documentTypes],
    enabled: documentTypes.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        documentTypes.map(async (t) => {
          // A failed preview must not blank the whole table.
          try {
            return [t, await numberingApi.previewNextNumber(t)] as const;
          } catch {
            return [t, null] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as Record<string, string | null>;
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sequences;
    return sequences.filter(
      (s) =>
        s.document_type.toLowerCase().includes(q) ||
        documentTypeLabel(s.document_type).toLowerCase().includes(q) ||
        s.fy_label.toLowerCase().includes(q) ||
        prefixFor(s.document_type).toLowerCase().includes(q),
    );
  }, [sequences, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const columns: ListColumn<NumberingSequence>[] = [
    {
      key: 'type',
      label: 'Document Type',
      className: 'w-[30%] min-w-[150px]',
      render: (s) => (
        <span className="font-medium text-[hsl(var(--ds-link))] group-hover:underline">
          {documentTypeLabel(s.document_type)}
        </span>
      ),
    },
    {
      key: 'fy',
      label: 'Financial Year',
      className: 'w-[16%] min-w-[110px]',
      render: (s) => (
        <span className="flex items-center gap-1.5">
          <span className="tabular-nums text-[hsl(var(--ds-ink))]">{s.fy_label}</span>
          {s.fy_label === currentFy && <StatusPill tone="green">Current</StatusPill>}
        </span>
      ),
    },
    {
      key: 'prefix',
      label: 'Prefix',
      className: 'w-[14%] min-w-[90px]',
      render: (s) => (
        <span
          className="font-mono text-[hsl(var(--ds-ink-muted))]"
          title="Fixed in generate_document_number — not configurable here"
        >
          {prefixFor(s.document_type)}
        </span>
      ),
    },
    {
      key: 'issued',
      label: 'Issued',
      className: 'w-[12%] min-w-[80px]',
      render: (s) => (
        <span className="tabular-nums text-[hsl(var(--ds-ink-muted))]">{s.last_number}</span>
      ),
    },
    {
      key: 'next',
      label: 'Next Number',
      className: 'w-[28%] min-w-[150px]',
      render: (s) => {
        const preview = previewsQuery.data?.[s.document_type];
        // Previews are per document type for the CURRENT financial year, so a
        // past-year row would be shown a number it will never issue.
        if (s.fy_label !== currentFy) {
          return <span className="text-[hsl(var(--ds-ink-subtle))] italic">past year</span>;
        }
        if (preview === undefined) {
          return <span className="text-[hsl(var(--ds-ink-subtle))]">…</span>;
        }
        if (preview === null) {
          return <span className="text-[hsl(var(--ds-red))]">preview unavailable</span>;
        }
        return <span className="font-mono text-[hsl(var(--ds-ink))]">{preview}</span>;
      },
    },
  ];

  const loadError = sequencesQuery.error ?? settingsQuery.error ?? fyQuery.error;

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="ds-root bg-[hsl(var(--ds-canvas))] min-h-full p-4">
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex items-center gap-1 text-[var(--ds-fs-xs)]">
            <li className="font-semibold text-[hsl(var(--ds-ink))]" aria-current="page">
              Numbering
            </li>
          </ol>
        </nav>

        {loadError && (
          <div
            role="alert"
            className="mb-3 rounded-[var(--ds-radius)] border border-[hsl(var(--ds-red)/0.4)] bg-[hsl(var(--ds-red-bg))] px-3 py-2 text-[var(--ds-fs-sm)] text-[hsl(var(--ds-red))]"
          >
            {loadError instanceof Error ? loadError.message : String(loadError)}
          </div>
        )}

        <p className="mb-3 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
          Counters are per document type and financial year. Prefixes are fixed in the
          database function that issues numbers; the separator and number length are
          global settings shared by every module.
        </p>

        <DocumentList<NumberingSequence>
          title="Document Sequences"
          rows={visible}
          columns={columns}
          getRowLabel={(s) => `${documentTypeLabel(s.document_type)} ${s.fy_label}`}
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          searchPlaceholder="Search document types…"
          onNew={() => navigate('/inventory/config/numbering/new')}
          onRowClick={(s) => navigate(`/inventory/config/numbering/${s.id}`)}
          page={{
            from: filtered.length ? safePage * PAGE_SIZE + 1 : 0,
            to: safePage * PAGE_SIZE + visible.length,
            total: filtered.length,
          }}
          onPrevPage={() => setPage((p) => Math.max(0, p - 1))}
          onNextPage={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          prevDisabled={safePage === 0}
          nextDisabled={safePage >= pageCount - 1}
          showViewSwitcher={false}
          minTableWidth={680}
          emptyMessage={
            sequencesQuery.isLoading ? 'Loading…' : 'No sequences match your search.'
          }
        />
      </div>
    </AppLayout>
  );
}
