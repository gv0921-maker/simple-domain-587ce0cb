// CRM Leads List Page
import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Search,
  Plus,
  MoreHorizontal,
  Trash2,
  IndianRupee,
  Sparkles,
  User,
} from 'lucide-react';
import {
  getLeads,
  deleteLead,
  convertLeadToOpportunity,
  type Lead,
  type LeadPriority,
} from '@/lib/data/crm';
import { CRM_NAV } from '@/lib/navigation/crm';
import { CRMExportButton } from '@/components/crm/CRMImportExport';
import { CRMFilterPopover, type FilterOption, type ActiveFilter } from '@/components/crm/CRMFilterPopover';
import { useToast } from '@/hooks/use-toast';
import { useCRMPermissions } from '@/hooks/useCRMPermissions';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

const LEAD_FILTER_OPTIONS: FilterOption[] = [
  { id: 'status:new', label: 'New', group: 'Status' },
  { id: 'status:contacted', label: 'Contacted', group: 'Status' },
  { id: 'status:qualified', label: 'Qualified', group: 'Status' },
  { id: 'priority:high', label: 'High Priority', group: 'Priority' },
  { id: 'priority:urgent', label: 'Urgent', group: 'Priority' },
  { id: 'source:website', label: 'Website', group: 'Source' },
  { id: 'source:referral', label: 'Referral', group: 'Source' },
  { id: 'source:social_media', label: 'Social Media', group: 'Source' },
];

const PRIORITY_COLORS: Record<LeadPriority, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-accent/20 text-accent-foreground',
  high: 'bg-warning/20 text-warning-foreground',
  urgent: 'bg-destructive/20 text-destructive',
};

export default function CRMLeadsList() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { canCreateLeads, canDeleteLeads, canConvertLeads, filterByScope } = useCRMPermissions();
  const [leads, setLeads] = useState<Lead[]>(() => getLeads());
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);

  const isSearching = search.trim().length > 0;
  const scopedLeads = useMemo(() => filterByScope(leads), [leads, filterByScope]);

  const filteredLeads = useMemo(() => {
    const base = isSearching
      ? scopedLeads
      : scopedLeads.filter((l) => l.status !== 'converted');
    
    let filtered = base.filter(
      (l) =>
        l.title.toLowerCase().includes(search.toLowerCase()) ||
        l.contactName.toLowerCase().includes(search.toLowerCase()) ||
        (l.companyName?.toLowerCase().includes(search.toLowerCase()) ?? false)
    );

    if (activeFilters.length > 0) {
      filtered = filtered.filter(l => {
        return activeFilters.every(f => {
          const [type, value] = f.id.split(':');
          if (type === 'status') return l.status === value;
          if (type === 'priority') return l.priority === value;
          if (type === 'source') return l.source === value;
          return true;
        });
      });
    }

    return filtered;
  }, [scopedLeads, search, isSearching, activeFilters]);

  const handleToggleFilter = useCallback((filter: FilterOption) => {
    setActiveFilters(prev => {
      const exists = prev.some(f => f.id === filter.id);
      if (exists) return prev.filter(f => f.id !== filter.id);
      return [...prev, { id: filter.id, label: filter.label }];
    });
  }, []);

  const stats = useMemo(() => {
    const activeLeads = leads.filter((l) => l.status !== 'converted');
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const convertedToday = leads.filter(
      (l) => l.status === 'converted' && l.convertedAt && format(parseISO(l.convertedAt), 'yyyy-MM-dd') === todayStr
    ).length;
    return {
      total: activeLeads.length,
      new: activeLeads.filter((l) => l.status === 'new').length,
      completed: convertedToday,
      pending: activeLeads.length,
    };
  }, [leads]);

  const handleConvert = (id: string) => {
    const opportunity = convertLeadToOpportunity(id);
    if (opportunity) {
      setLeads(getLeads());
      toast({ title: 'Lead converted to opportunity' });
      navigate(`/crm/opportunities/${opportunity.id}`);
    }
  };

  const handleDelete = (id: string) => {
    deleteLead(id);
    setLeads(getLeads());
    toast({ title: 'Lead deleted' });
  };

  return (
    <AppLayout title="CRM" moduleNav={CRM_NAV}>
      <div className="p-6 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Leads</h1>
            <p className="text-muted-foreground">Track and qualify your sales leads</p>
          </div>
          <div className="flex gap-2">
            {canCreateLeads && (
              <Button onClick={() => navigate('/crm/leads/new')}>
                <Plus className="h-4 w-4 mr-2" />
                New
              </Button>
            )}
            <CRMExportButton type="leads" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card className="animate-slide-up">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Leads</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card className="animate-slide-up" style={{ animationDelay: '50ms' }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">New</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-info">{stats.new}</div>
            </CardContent>
          </Card>
          <Card className="animate-slide-up" style={{ animationDelay: '100ms' }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-success">{stats.completed}</div>
            </CardContent>
          </Card>
          <Card className="animate-slide-up" style={{ animationDelay: '150ms' }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-warning">{stats.pending}</div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search leads..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <CRMFilterPopover
              options={LEAD_FILTER_OPTIONS}
              activeFilters={activeFilters}
              onToggleFilter={handleToggleFilter}
              onClearAll={() => setActiveFilters([])}
            />
          </div>
        </div>

        <Card className="animate-fade-in">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLeads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No leads found
                  </TableCell>
                </TableRow>
              ) : (
                filteredLeads.map((lead, index) => (
                  <TableRow
                    key={lead.id}
                    className="animate-fade-in cursor-pointer hover:bg-muted/50"
                    style={{ animationDelay: `${index * 30}ms` }}
                    onClick={() => navigate(`/crm/leads/${lead.id}`)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{lead.title}</p>
                        {lead.companyName && (
                          <p className="text-xs text-muted-foreground">{lead.companyName}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3 text-muted-foreground" />
                        {lead.contactName}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">
                        {lead.source.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn('text-xs capitalize', PRIORITY_COLORS[lead.priority])}>
                        {lead.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 font-medium">
                        <IndianRupee className="h-3 w-3" />
                        {lead.expectedRevenue.toLocaleString('en-IN')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm">{lead.createdBy || 'Unknown'}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canConvertLeads && (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleConvert(lead.id); }}>
                              <Sparkles className="h-4 w-4 mr-2" />
                              Convert to Opportunity
                            </DropdownMenuItem>
                          )}
                          {canDeleteLeads && (
                            <>
                              {canConvertLeads && <DropdownMenuSeparator />}
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handleDelete(lead.id); }}
                                className="text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </AppLayout>
  );
}
