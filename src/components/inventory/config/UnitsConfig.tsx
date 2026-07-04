import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import {
  useUnitsOfMeasure, useSaveUnitOfMeasure, useDeleteUnitOfMeasure,
} from '@/hooks/inventory/config';
import type { UnitOfMeasure, UomType } from '@/lib/services/inventory/unitsOfMeasure';
import { useToast } from '@/hooks/use-toast';

export function UnitsConfig() {
  const { data: units = [], isLoading } = useUnitsOfMeasure();
  const saveMut = useSaveUnitOfMeasure();
  const delMut = useDeleteUnitOfMeasure();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UnitOfMeasure | null>(null);
  const [form, setForm] = useState({
    name: '', abbreviation: '', uomType: 'unit' as UomType, ratio: 1, isActive: true,
  });

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', abbreviation: '', uomType: 'unit', ratio: 1, isActive: true });
    setOpen(true);
  };
  const openEdit = (u: UnitOfMeasure) => {
    setEditing(u);
    setForm({ name: u.name, abbreviation: u.abbreviation, uomType: u.uomType, ratio: u.ratio, isActive: u.isActive });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim() || !form.abbreviation.trim()) {
      toast({ title: 'Name and abbreviation required', variant: 'destructive' });
      return;
    }
    try {
      await saveMut.mutateAsync({
        id: editing?.id,
        name: form.name.trim(),
        abbreviation: form.abbreviation.trim(),
        uomType: form.uomType,
        ratio: Number(form.ratio) || 1,
        isActive: form.isActive,
      });
      toast({ title: editing ? 'Unit updated' : 'Unit created' });
      setOpen(false);
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
    }
  };

  const del = async (id: string) => {
    if (!confirm('Delete this unit?')) return;
    try {
      await delMut.mutateAsync(id);
      toast({ title: 'Unit deleted' });
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e?.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium">Units of Measure</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" onClick={openNew}><Plus className="h-4 w-4" /> New Unit</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? 'Edit Unit' : 'New Unit'}</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Name *</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Abbreviation *</Label>
                  <Input value={form.abbreviation} onChange={(e) => setForm({ ...form, abbreviation: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={form.uomType} onValueChange={(v) => setForm({ ...form, uomType: v as UomType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reference">Reference</SelectItem>
                      <SelectItem value="unit">Unit</SelectItem>
                      <SelectItem value="bigger">Bigger than reference</SelectItem>
                      <SelectItem value="smaller">Smaller than reference</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Ratio</Label>
                  <Input type="number" step="0.0001" value={form.ratio} onChange={(e) => setForm({ ...form, ratio: Number(e.target.value) })} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={saveMut.isPending}>{editing ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Abbrev.</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Ratio</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : units.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No units yet</TableCell></TableRow>
            ) : units.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell>{u.abbreviation}</TableCell>
                <TableCell className="capitalize">{u.uomType}</TableCell>
                <TableCell className="text-right">{u.ratio}</TableCell>
                <TableCell>{u.isActive ? 'Yes' : 'No'}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(u)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => del(u.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}