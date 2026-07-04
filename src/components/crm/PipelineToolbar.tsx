// Shared toolbar for the CRM Pipeline — rendered identically above both the
// Kanban board and the List view so the two views can only ever differ in
// their content area, never in their controls.
import { Loader2, LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FilterBar } from '@/components/filters/FilterBar';
import { crmOpportunitiesFilterConfig } from '@/lib/filters/modules/crmOpportunities';
import { ImportExportButton } from '@/components/importExport/ImportExportButton';
import type { FilterState } from '@/lib/filters/types';
import type { Opportunity } from '@/lib/services/crm';
import { cn } from '@/lib/utils';

interface PipelineToolbarProps {
  onNewOpportunity?: () => void;
  canCreate: boolean;
  isFetching?: boolean;
  view: 'kanban' | 'list';
  onViewChange: (view: 'kanban' | 'list') => void;
  filterState: FilterState;
  onFilterChange: (s: FilterState) => void;
  filteredRecords: Opportunity[];
  allRecords: Opportunity[];
}

export function PipelineToolbar({
  onNewOpportunity, canCreate, isFetching,
  view, onViewChange,
  filterState, onFilterChange,
  filteredRecords, allRecords,
}: PipelineToolbarProps) {
  const viewButtons = [
    { icon: LayoutGrid, id: 'kanban' as const, title: 'Kanban' },
    { icon: List, id: 'list' as const, title: 'List' },
  ];

  return (
    <div className="border-b border-border bg-card px-3 md:px-4 py-2">
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        {/* Left: New + Pipeline label */}
        <div className="flex items-center gap-2 min-w-0 order-1">
          <Button
            size="sm"
            onClick={onNewOpportunity}
            className="gap-1 bg-[#875A7B] hover:bg-[#6e4a64] text-white h-8 text-xs font-semibold rounded"
            disabled={!canCreate}
          >
            New
          </Button>
          <span className="text-sm font-semibold text-foreground truncate">Pipeline</span>
          {isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>

        {/* Right: Import/Export + view toggle */}
        <div className="flex items-center gap-1 order-2 md:order-3 ml-auto">
          <ImportExportButton
            schema="crm_opportunities"
            currentRecords={filteredRecords as unknown as Record<string, unknown>[]}
            allRecords={allRecords as unknown as Record<string, unknown>[]}
          />
          {viewButtons.map(({ icon: Icon, id, title }) => (
            <Tooltip key={title}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onViewChange(id)}
                  className={cn(
                    'h-8 w-8 flex items-center justify-center rounded transition-colors',
                    view === id
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                  aria-label={title}
                >
                  <Icon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">{title}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Center: search / filter bar. Wraps to full-width on mobile. */}
        <div className="order-3 md:order-2 w-full md:flex-1 md:max-w-3xl">
          <FilterBar
            config={crmOpportunitiesFilterConfig}
            value={filterState}
            onChange={onFilterChange}
          />
        </div>
      </div>
    </div>
  );
}