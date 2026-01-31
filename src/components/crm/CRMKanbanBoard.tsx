// CRM Kanban Board with drag-and-drop for opportunities
import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  DollarSign,
  Calendar,
  Building,
  User,
  MoreHorizontal,
  ArrowRight,
  GripVertical,
  Plus,
  Search,
  Filter,
} from 'lucide-react';
import {
  getOpportunities,
  getDefaultPipeline,
  updateOpportunityStage,
  type Opportunity,
  type Pipeline,
  type PipelineStage,
  type OpportunityStage,
} from '@/lib/data/crm';
import { useToast } from '@/hooks/use-toast';
import { useCRMPermissions } from '@/hooks/useCRMPermissions';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

interface KanbanCardProps {
  opportunity: Opportunity;
  stages: PipelineStage[];
  onMove: (stageId: string, stage: OpportunityStage) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
}

function KanbanCard({ opportunity, stages, onMove, onDragStart }: KanbanCardProps) {
  const navigate = useNavigate();
  const { canEditOpportunities } = useCRMPermissions();
  
  return (
    <Card
      draggable={canEditOpportunities}
      onDragStart={(e) => onDragStart(e, opportunity.id)}
      className={cn(
        'p-3 cursor-pointer card-hover animate-scale-in group',
        canEditOpportunities && 'cursor-grab active:cursor-grabbing'
      )}
      onClick={() => navigate(`/crm/opportunities/${opportunity.id}`)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {canEditOpportunities && (
            <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
          )}
          <div className="min-w-0 flex-1">
            <h4 className="font-medium text-sm text-foreground line-clamp-2">{opportunity.name}</h4>
            {opportunity.companyName && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                <Building className="h-3 w-3" />
                <span className="truncate">{opportunity.companyName}</span>
              </div>
            )}
          </div>
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreHorizontal className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {stages
              .filter((s) => s.id !== opportunity.stageId)
              .map((stage) => (
                <DropdownMenuItem
                  key={stage.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    const stageMap: Record<string, OpportunityStage> = {
                      qual: 'qualification',
                      needs: 'needs_analysis',
                      proposal: 'proposal',
                      nego: 'negotiation',
                      closed_won: 'closed_won',
                      closed_lost: 'closed_lost',
                    };
                    onMove(stage.id, stageMap[stage.id] || 'qualification');
                  }}
                >
                  <ArrowRight className="mr-2 h-4 w-4" />
                  Move to {stage.name}
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-3 flex items-center gap-1 text-sm text-muted-foreground">
        <User className="h-3 w-3" />
        <span className="truncate">{opportunity.contactName}</span>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1 font-semibold text-foreground">
          <DollarSign className="h-3.5 w-3.5" />
          {opportunity.expectedRevenue.toLocaleString()}
        </div>
        <Badge variant="secondary" className="text-xs">
          {opportunity.probability}%
        </Badge>
      </div>

      <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Calendar className="h-3 w-3" />
        {format(parseISO(opportunity.expectedCloseDate), 'MMM d, yyyy')}
      </div>

      {opportunity.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {opportunity.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs px-1.5 py-0">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

interface KanbanColumnProps {
  stage: PipelineStage;
  opportunities: Opportunity[];
  allStages: PipelineStage[];
  onMoveOpportunity: (oppId: string, stageId: string, stage: OpportunityStage) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, stageId: string) => void;
  isDragOver: boolean;
}

function KanbanColumn({
  stage,
  opportunities,
  allStages,
  onMoveOpportunity,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
}: KanbanColumnProps) {
  const totalValue = opportunities.reduce((sum, o) => sum + o.expectedRevenue, 0);
  
  return (
    <div
      className={cn(
        'w-80 flex flex-col bg-muted/30 rounded-lg shrink-0 transition-colors',
        isDragOver && 'bg-accent/20 ring-2 ring-accent ring-inset'
      )}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, stage.id)}
    >
      {/* Column header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: stage.color }}
          />
          <h3 className="font-medium text-sm text-foreground">{stage.name}</h3>
          <Badge variant="secondary" className="ml-auto text-xs">
            {opportunities.length}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          ${totalValue.toLocaleString()} • {stage.probability}% probability
        </p>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[200px]">
        {opportunities.map((opp) => (
          <KanbanCard
            key={opp.id}
            opportunity={opp}
            stages={allStages}
            onMove={(stageId, stageType) => onMoveOpportunity(opp.id, stageId, stageType)}
            onDragStart={onDragStart}
          />
        ))}
        {opportunities.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No opportunities
          </div>
        )}
      </div>
    </div>
  );
}

interface CRMKanbanBoardProps {
  onNewOpportunity?: () => void;
}

export function CRMKanbanBoard({ onNewOpportunity }: CRMKanbanBoardProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { canCreateOpportunities, canEditOpportunities } = useCRMPermissions();
  
  const [opportunities, setOpportunities] = useState<Opportunity[]>(() => getOpportunities());
  const [pipeline] = useState<Pipeline>(() => getDefaultPipeline());
  const [search, setSearch] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const filteredOpportunities = useMemo(() => {
    return opportunities.filter(
      (o) =>
        o.name.toLowerCase().includes(search.toLowerCase()) ||
        o.contactName.toLowerCase().includes(search.toLowerCase()) ||
        (o.companyName?.toLowerCase().includes(search.toLowerCase()) ?? false)
    );
  }, [opportunities, search]);

  const opportunitiesByStage = useMemo(() => {
    const grouped: Record<string, Opportunity[]> = {};
    pipeline.stages.forEach((stage) => {
      grouped[stage.id] = filteredOpportunities.filter((o) => o.stageId === stage.id);
    });
    return grouped;
  }, [filteredOpportunities, pipeline.stages]);

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    setDraggedId(id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDragEnter = useCallback((stageId: string) => {
    setDragOverStage(stageId);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, stageId: string) => {
      e.preventDefault();
      const oppId = e.dataTransfer.getData('text/plain');
      
      if (oppId && canEditOpportunities) {
        const stageMap: Record<string, OpportunityStage> = {
          qual: 'qualification',
          needs: 'needs_analysis',
          proposal: 'proposal',
          nego: 'negotiation',
          closed_won: 'closed_won',
          closed_lost: 'closed_lost',
        };
        
        const stage = stageMap[stageId] || 'qualification';
        updateOpportunityStage(oppId, stageId, stage);
        setOpportunities(getOpportunities());
        
        const stageName = pipeline.stages.find((s) => s.id === stageId)?.name;
        toast({
          title: 'Opportunity updated',
          description: `Moved to ${stageName}`,
        });
      }
      
      setDraggedId(null);
      setDragOverStage(null);
    },
    [canEditOpportunities, pipeline.stages, toast]
  );

  const handleMoveOpportunity = useCallback(
    (oppId: string, stageId: string, stage: OpportunityStage) => {
      if (canEditOpportunities) {
        updateOpportunityStage(oppId, stageId, stage);
        setOpportunities(getOpportunities());
        
        const stageName = pipeline.stages.find((s) => s.id === stageId)?.name;
        toast({
          title: 'Opportunity updated',
          description: `Moved to ${stageName}`,
        });
      }
    },
    [canEditOpportunities, pipeline.stages, toast]
  );

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 shrink-0 px-4 pt-4">
        <h1 className="text-lg font-medium text-foreground">Opportunity Pipeline</h1>

        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search opportunities..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon">
            <Filter className="h-4 w-4" />
          </Button>
          {canCreateOpportunities && (
            <Button onClick={onNewOpportunity} className="gap-1">
              <Plus className="h-4 w-4" />
              New Opportunity
            </Button>
          )}
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto px-4 pb-4">
        <div className="flex gap-4 h-full min-w-max">
          {pipeline.stages.map((stage) => (
            <div
              key={stage.id}
              onDragEnter={() => handleDragEnter(stage.id)}
            >
              <KanbanColumn
                stage={stage}
                opportunities={opportunitiesByStage[stage.id] || []}
                allStages={pipeline.stages}
                onMoveOpportunity={handleMoveOpportunity}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                isDragOver={dragOverStage === stage.id && draggedId !== null}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
