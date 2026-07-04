import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  useOperationTypes, useSaveOperationType, useDeleteOperationType,
} from '@/hooks/inventory/config';
import type { OperationType, OperationKind, BackorderPolicy } from '@/lib/services/inventory/operationTypes';
import { useToast } from '@/hooks/use-toast';

const KIND_LABEL: Record<OperationKind, string> = {
  receipt: 'Receipt',
  delivery: 'Delivery',
  internal_transfer: 'Internal Transfer',
  manufacturing: 'Manufacturing',
};

export function OperationTypesConfig() {
  const { data: ops = [], isLoading } = useOperationTypes();
  const saveMut = useSaveOperationType();
  const delMut = useDeleteOperationType();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OperationType | null>(null);
  const [form, setForm] = useState({
    name: '',
    operationKind: 'receipt' as OperationKind,
    sequencePrefix: '',
    createBackorder: 'ask' as BackorderPolicy,
    useExistingLots: true,
    createNewLots: true,
    isActive: true,
  });

  const openNew = () => {
    setEditing(null);
    setForm({
      name: '', operationKind: 'receipt', sequencePrefix: '',
      createBackorder: 'ask', useExistingLots: true, createNewLots: true, isActive: true,
    });
    setOpen(true);
  };
  const openEdit = (o: OperationType) => {
    setEditing(o);
    setForm({
      name: o.name,
      operationKind: o.operationKind,
      sequencePrefix: o.sequencePrefix ?? '',
      createBackorder: o.createBackorder,
      useExistingLots: o.useExistingLots,
      createNewLots: o.createNewLots,
      isActive: o.isActive,
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Name required', variant: 'destructive' });
      return;
    }
    try {
      await saveMut.mutateAsync({
        id: editing?.id,
        name: form.name.trim(),
        operationKind: form.operationKind,
        sequencePrefix: form.sequencePrefix || null,
        createBackorder: form.createBackorder,
        useExistingLots: form.useExistingLots,
        createNewLots: form.createNewLots,
        isActive: form.isActive,
      });
      toast({ title: editing ? 'Operation type updated' : 'Operation type created' });
      setOpen(false);
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
    }
  };

  const del = async (id: string) => {
    if (!confirm('Delete this operation type?')) return;
    try {
      await delMut.mutateAsync(id);
      toast({ title: 'Deleted' });
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e?.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium">Operation Types</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" onClick={openNew}><Plus className="h-4 w-4" /> New Operation Type</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? 'Edit Operation Type' : 'New Operation Type'}</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Type of Operation</Label>
                  <Select value={form.operationKind} onValueChange={(v) => setForm({ ...form, operationKind: v as OperationKind })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="receipt">Receipt</SelectItem>
                      <SelectItem value="delivery">Delivery</SelectItem>
                      <SelectItem value="internal_transfer">Internal Transfer</SelectItem>
                      <SelectItem value="manufacturing">Manufacturing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Sequence Prefix</Label>
                  <Input value={form.sequencePrefix} onChange={(e) => setForm({ ...form, sequencePrefix: e.target.value.toUpperCase() })} placeholder="RCP" />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Create Backorder</Label>
                <Select value={form.createBackorder} onValueChange={(v) => setForm({ ...form, createBackorder: v as BackorderPolicy })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ask">Ask</SelectItem>
                    <SelectItem value="always">Always</SelectItem>
                    <SelectItem value="never">Never</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label>Use Existing Lots/Serials</Label>
                <Switch checked={form.useExistingLots} onCheckedChange={(v) => setForm({ ...form, useExistingLots: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Create New Lots/Serials</Label>
                <Switch checked={form.createNewLots} onCheckedChange={(v) => setForm({ ...form, createNewLots: v })} />
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
              <TableHead>Kind</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Backorder</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : ops.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No operation types yet</TableCell></TableRow>
            ) : ops.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.name}</TableCell>
                <TableCell>{KIND_LABEL[o.operationKind]}</TableCell>
                <TableCell>{o.sequencePrefix ? <Badge variant="outline">{o.sequencePrefix}</Badge> : '—'}</TableCell>
                <TableCell className="capitalize">{o.createBackorder}</TableCell>
                <TableCell>{o.isActive ? 'Yes' : 'No'}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(o)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => del(o.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}