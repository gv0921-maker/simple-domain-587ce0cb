import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
} from '@/components/ui/dropdown-menu';
import {
  Search, Plus, MoreHorizontal, Pencil, Archive, ArchiveRestore,
  MapPin, ChevronRight, ChevronDown,
} from 'lucide-react';
import { useWarehouses } from '@/hooks/inventory';
import {
  useLocationsQuery,
  useCreateLocation,
  useUpdateLocation,
  useArchiveLocation,
  useUnarchiveLocation,
  buildLocationTree,
  migrateLegacyLocations,
} from '@/hooks/inventory/useLocations';
import type { Location, LocationType } from '@/lib/data/inventory/types';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type RemovalStrategy = NonNullable<Location['removalStrategy']>;

const LOCATION_TYPES: { value: LocationType; label: string }[] = [
  { value: 'internal',   label: 'Internal Storage' },
  { value: 'customer',   label: 'Customer Location' },
  { value: 'vendor',     label: 'Vendor Location' },
  { value: 'transit',    label: 'In Transit' },
  { value: 'virtual',    label: 'Virtual / Adjustment' },
  { value: 'production', label: 'Factory / Production' },
];

const REMOVAL_STRATEGIES: { value: RemovalStrategy; label: string; hint: string }[] = [
  { value: 'fifo',    label: 'First In First Out (FIFO)', hint: 'Oldest stock leaves first — recommended for furniture' },
  { value: 'lifo',    label: 'Last In First Out (LIFO)',  hint: 'Newest stock leaves first' },
  { value: 'closest', label: 'Closest Location',          hint: 'Nearest bin/shelf goes first for pickers' },
  { value: 'manual',  label: 'Manual',                    hint: 'Operator chooses at pick time' },
];

interface FormState {
  name: string;
  code: string;
  warehouseId: string;
  parentId: string;
  type: LocationType;
  barcode: string;
  aisle: string;
  shelf: string;
  bin: string;
  removalStrategy: RemovalStrategy;
  cyclicCountFrequencyDays: number;
  lastCountDate: string;
  notes: string;
  isActive: boolean;
}

const blankForm = (warehouseId = ''): FormState => ({
  name: '', code: '', warehouseId, parentId: '',
  type: 'internal', barcode: '', aisle: '', shelf: '', bin: '',
  removalStrategy: 'fifo', cyclicCountFrequencyDays: 0,
  lastCountDate: '', notes: '', isActive: true,
});

function suggestCode(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
}
function computeNextCount(last: string, freq: number): string {
  if (!freq || freq <= 0) return '';
  const base = last ? new Date(last) : new Date();
  if (isNaN(base.getTime())) return '';
  base.setDate(base.getDate() + freq);
  return base.toISOString().slice(0, 10);
}

export default function WarehouseLocations() {
  const { toast } = useToast();
  const { data: warehouses = [] } = useWarehouses();
  const { data: locations = [], isLoading } = useLocationsQuery();
  const createMut = useCreateLocation();
  const updateMut = useUpdateLocation();
  const archiveMut = useArchiveLocation();
  const unarchiveMut = useUnarchiveLocation();

  // One-shot migration of any leftover localStorage locations.
  useEffect(() => { migrateLegacyLocations().catch(() => undefined); }, []);

  const [search, setSearch] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState<FormState>(blankForm());
  const [codeTouched, setCodeTouched] = useState(false);

  const warehouseName = (id: string) => warehouses.find((w) => w.id === id)?.name || '—';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return locations.filter((l) => {
      if (!showArchived && !l.isActive) return false;
      if (selectedWarehouse !== 'all' && l.warehouseId !== selectedWarehouse) return false;
      if (!q) return true;
      return (
        l.name.toLowerCase().includes(q) ||
        (l.code || '').toLowerCase().includes(q) ||
        (l.barcode || '').toLowerCase().includes(q)
      );
    });
  }, [locations, search, selectedWarehouse, showArchived]);

  const grouped = useMemo(() => {
    const byWh = new Map<string, Location[]>();
    filtered.forEach((l) => {
      const arr = byWh.get(l.warehouseId) || [];
      arr.push(l);
      byWh.set(l.warehouseId, arr);
    });
    return Array.from(byWh.entries()).map(([whId, locs]) => ({
      warehouseId: whId,
      warehouseName: warehouseName(whId),
      tree: buildLocationTree(locs),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, warehouses]);

  function openNew() {
    setEditing(null);
    setForm(blankForm(warehouses[0]?.id || ''));
    setCodeTouched(false);
    setDialogOpen(true);
  }
  function openEdit(l: Location) {
    setEditing(l);
    setForm({
      name: l.name, code: l.code || '', warehouseId: l.warehouseId,
      parentId: l.parentId || '', type: l.type, barcode: l.barcode || '',
      aisle: l.aisle || '', shelf: l.shelf || '', bin: l.bin || '',
      removalStrategy: l.removalStrategy || 'fifo',
      cyclicCountFrequencyDays: l.cyclicCountFrequencyDays || 0,
      lastCountDate: l.lastCountDate || '', notes: l.notes || '',
      isActive: l.isActive,
    });
    setCodeTouched(true);
    setDialogOpen(true);
  }

  function onNameChange(v: string) {
    setForm((f) => ({ ...f, name: v, code: codeTouched ? f.code : suggestCode(v) }));
  }

  async function handleSave() {
    if (!form.name.trim()) { toast({ title: 'Name is required', variant: 'destructive' }); return; }
    if (!form.warehouseId) { toast({ title: 'Warehouse is required', variant: 'destructive' }); return; }
    const nextCountDate = computeNextCount(form.lastCountDate, form.cyclicCountFrequencyDays);
    const payload: Partial<Location> = {
      name: form.name.trim(),
      code: (form.code || suggestCode(form.name)).trim(),
      warehouseId: form.warehouseId,
      parentId: form.parentId || undefined,
      type: form.type,
      barcode: form.barcode || undefined,
      aisle: form.aisle || undefined,
      shelf: form.shelf || undefined,
      bin: form.bin || undefined,
      removalStrategy: form.removalStrategy,
      cyclicCountFrequencyDays: form.cyclicCountFrequencyDays || 0,
      lastCountDate: form.lastCountDate || undefined,
      nextCountDate: nextCountDate || undefined,
      notes: form.notes || undefined,
      isActive: form.isActive,
    };
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, patch: payload });
        toast({ title: 'Location updated' });
      } else {
        await createMut.mutateAsync(payload as Omit<Location, 'id'>);
        toast({ title: 'Location created' });
      }
      setDialogOpen(false);
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
    }
  }

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Locations</h1>
          <p className="text-muted-foreground">
            Physical sub-locations inside each warehouse — shelves, racks, showroom bays, transit.
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder=""
                aria-label="Search locations"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Warehouses</SelectItem>
                {warehouses.map((wh) => (
                  <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 text-sm">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} id="archived" />
              <Label htmlFor="archived" className="cursor-pointer">Show archived</Label>
            </div>
          </div>
          <Button onClick={openNew} className="gap-2" disabled={!warehouses.length}>
            <Plus className="h-4 w-4" /> New Location
          </Button>
        </div>

        {/* Tree table grouped by warehouse */}
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Removal</TableHead>
                <TableHead>Cyclic</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
              ) : grouped.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {warehouses.length === 0
                      ? 'Create a warehouse first to add locations.'
                      : 'No locations yet. Click "New Location" to add one.'}
                  </TableCell>
                </TableRow>
              ) : (
                grouped.map((g) => (
                  <TreeGroup
                    key={g.warehouseId}
                    warehouseName={g.warehouseName}
                    nodes={g.tree}
                    expanded={expanded}
                    setExpanded={setExpanded}
                    onEdit={openEdit}
                    onArchive={(id) => archiveMut.mutate(id)}
                    onUnarchive={(id) => unarchiveMut.mutate(id)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </Card>

        {/* Location Dialog — Odoo-style form */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Location' : 'New Location'}</DialogTitle>
            </DialogHeader>

            <div className="space-y-6 py-2">
              {/* Header block */}
              <div className="space-y-4">
                <div>
                  <Label>Location Name *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => onNameChange(e.target.value)}
                    className="text-lg"
                    placeholder=""
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Warehouse *</Label>
                    <Select value={form.warehouseId} onValueChange={(v) => setForm({ ...form, warehouseId: v, parentId: '' })}>
                      <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                      <SelectContent>
                        {warehouses.map((wh) => (
                          <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Parent Location</Label>
                    <Select
                      value={form.parentId || '__none__'}
                      onValueChange={(v) => setForm({ ...form, parentId: v === '__none__' ? '' : v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None (root)</SelectItem>
                        {locations
                          .filter((l) => l.warehouseId === form.warehouseId && l.id !== editing?.id)
                          .map((l) => (<SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Two-column body */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Additional Information */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                    Additional Information
                  </h3>
                  <div>
                    <Label>Location Type</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as LocationType })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LOCATION_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Code</Label>
                    <Input
                      value={form.code}
                      onChange={(e) => { setCodeTouched(true); setForm({ ...form, code: e.target.value }); }}
                      placeholder=""
                    />
                  </div>
                  <div>
                    <Label>Barcode</Label>
                    <Input
                      value={form.barcode}
                      onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                      placeholder=""
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label>Aisle</Label>
                      <Input value={form.aisle} onChange={(e) => setForm({ ...form, aisle: e.target.value })} placeholder="" />
                    </div>
                    <div>
                      <Label>Shelf</Label>
                      <Input value={form.shelf} onChange={(e) => setForm({ ...form, shelf: e.target.value })} placeholder="" />
                    </div>
                    <div>
                      <Label>Bin</Label>
                      <Input value={form.bin} onChange={(e) => setForm({ ...form, bin: e.target.value })} placeholder="" />
                    </div>
                  </div>
                </div>

                {/* Cyclic Counting */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                    Cyclic Counting
                  </h3>
                  <div>
                    <Label>Inventory Frequency (days)</Label>
                    <Input
                      type="number" min={0}
                      value={form.cyclicCountFrequencyDays}
                      onChange={(e) => setForm({ ...form, cyclicCountFrequencyDays: Number(e.target.value) || 0 })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Set 0 to disable cyclic counting.</p>
                  </div>
                  <div>
                    <Label>Last Count Date</Label>
                    <Input
                      type="date"
                      value={form.lastCountDate}
                      onChange={(e) => setForm({ ...form, lastCountDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Next Expected Count</Label>
                    <Input
                      type="date"
                      value={computeNextCount(form.lastCountDate, form.cyclicCountFrequencyDays)}
                      readOnly disabled
                    />
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <Label htmlFor="active-switch">Active</Label>
                    <Switch
                      id="active-switch"
                      checked={form.isActive}
                      onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Logistics */}
              <div className="space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  Logistics
                </h3>
                <Label>Removal Strategy</Label>
                <RadioGroup
                  value={form.removalStrategy}
                  onValueChange={(v) => setForm({ ...form, removalStrategy: v as RemovalStrategy })}
                  className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                >
                  {REMOVAL_STRATEGIES.map((s) => (
                    <label
                      key={s.value}
                      className={cn(
                        'flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors',
                        form.removalStrategy === s.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/40',
                      )}
                    >
                      <RadioGroupItem value={s.value} id={`rs-${s.value}`} className="mt-0.5" />
                      <div>
                        <div className="text-sm font-medium">{s.label}</div>
                        <div className="text-xs text-muted-foreground">{s.hint}</div>
                      </div>
                    </label>
                  ))}
                </RadioGroup>
              </div>

              <Separator />

              <div>
                <Label>Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  placeholder=""
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
                {editing ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}

// ---------- Tree renderer ----------
function TreeGroup({
  warehouseName, nodes, expanded, setExpanded, onEdit, onArchive, onUnarchive,
}: {
  warehouseName: string;
  nodes: ReturnType<typeof buildLocationTree>;
  expanded: Record<string, boolean>;
  setExpanded: (u: Record<string, boolean>) => void;
  onEdit: (l: Location) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
}) {
  return (
    <>
      <TableRow className="bg-muted/40">
        <TableCell colSpan={7} className="font-medium text-sm">{warehouseName}</TableCell>
      </TableRow>
      {nodes.map((n) => (
        <TreeRow
          key={n.id}
          node={n}
          depth={0}
          expanded={expanded}
          setExpanded={setExpanded}
          onEdit={onEdit}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
        />
      ))}
    </>
  );
}

function TreeRow({
  node, depth, expanded, setExpanded, onEdit, onArchive, onUnarchive,
}: {
  node: ReturnType<typeof buildLocationTree>[number];
  depth: number;
  expanded: Record<string, boolean>;
  setExpanded: (u: Record<string, boolean>) => void;
  onEdit: (l: Location) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded[node.id] ?? true;
  return (
    <>
      <TableRow className={cn(!node.isActive && 'opacity-60')}>
        <TableCell>
          <div className="flex items-center gap-1" style={{ paddingLeft: depth * 20 }}>
            {hasChildren ? (
              <button
                type="button"
                className="p-0.5 hover:bg-muted rounded"
                onClick={() => setExpanded({ ...expanded, [node.id]: !isOpen })}
              >
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            ) : <span className="w-5" />}
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{node.name}</span>
          </div>
        </TableCell>
        <TableCell><Badge variant="outline" className="capitalize">{node.type}</Badge></TableCell>
        <TableCell className="text-muted-foreground text-sm">{node.code || '—'}</TableCell>
        <TableCell className="text-sm uppercase">{node.removalStrategy || 'fifo'}</TableCell>
        <TableCell className="text-sm">
          {node.cyclicCountFrequencyDays ? `${node.cyclicCountFrequencyDays}d` : '—'}
        </TableCell>
        <TableCell>
          <Badge className={cn(node.isActive ? 'bg-success/20 text-success border-success' : 'bg-muted text-muted-foreground')}>
            {node.isActive ? 'Active' : 'Archived'}
          </Badge>
        </TableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(node)}>
                <Pencil className="h-4 w-4 mr-2" /> Edit
              </DropdownMenuItem>
              {node.isActive ? (
                <DropdownMenuItem onClick={() => onArchive(node.id)} className="text-destructive">
                  <Archive className="h-4 w-4 mr-2" /> Archive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => onUnarchive(node.id)}>
                  <ArchiveRestore className="h-4 w-4 mr-2" /> Restore
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
      {isOpen && node.children.map((c) => (
        <TreeRow
          key={c.id}
          node={c}
          depth={depth + 1}
          expanded={expanded}
          setExpanded={setExpanded}
          onEdit={onEdit}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
        />
      ))}
    </>
  );
}
