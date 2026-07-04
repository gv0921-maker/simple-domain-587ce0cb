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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import {
  useOperationTypes, useSaveOperationType, useDeleteOperationType,
} from '@/hooks/inventory/config';
import { useLocationsQuery } from '@/hooks/inventory/useLocations';
import type { OperationType, OperationKind, BackorderPolicy } from '@/lib/services/inventory/operationTypes';
import { useToast } from '@/hooks/use-toast';

const KIND_LABEL: Record<OperationKind, string> = {
  receipt: 'Receipt',
  delivery: 'Delivery',
  internal_transfer: 'Internal Transfer',
  manufacturing: 'Manufacturing',
};

const CARD_COLORS: { value: string; label: string; className: string }[] = [
  { value: 'gray', label: 'Gray', className: 'bg-muted' },
  { value: 'blue', label: 'Blue', className: 'bg-blue-500' },
  { value: 'green', label: 'Green', className: 'bg-green-500' },
  { value: 'amber', label: 'Amber', className: 'bg-amber-500' },
  { value: 'red', label: 'Red', className: 'bg-red-500' },
  { value: 'purple', label: 'Purple', className: 'bg-purple-500' },
  { value: 'teal', label: 'Teal', className: 'bg-teal-500' },
];

export function OperationTypesConfig() {
  const { data: ops = [], isLoading } = useOperationTypes();
  const { data: locations = [] } = useLocationsQuery();
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
    cardColor: 'gray',
    defaultSourceLocationId: '' as string,
    defaultDestLocationId: '' as string,
    returnsOperationTypeId: '' as string,
    printDeliverySlip: false,
    printProductLabels: false,
    printLotSerialLabels: false,
    mandatoryScanProduct: false,
    mandatoryScanLotSerial: false,
    allowExtraProducts: true,
  });

  const openNew = () => {
    setEditing(null);
    setForm({
      name: '', operationKind: 'receipt', sequencePrefix: '',
      createBackorder: 'ask', useExistingLots: true, createNewLots: true, isActive: true,
      cardColor: 'gray',
      defaultSourceLocationId: '', defaultDestLocationId: '', returnsOperationTypeId: '',
      printDeliverySlip: false, printProductLabels: false, printLotSerialLabels: false,
      mandatoryScanProduct: false, mandatoryScanLotSerial: false, allowExtraProducts: true,
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
      cardColor: o.cardColor ?? 'gray',
      defaultSourceLocationId: o.defaultSourceLocationId ?? '',
      defaultDestLocationId: o.defaultDestLocationId ?? '',
      returnsOperationTypeId: o.returnsOperationTypeId ?? '',
      printDeliverySlip: !!o.printDeliverySlip,
      printProductLabels: !!o.printProductLabels,
      printLotSerialLabels: !!o.printLotSerialLabels,
      mandatoryScanProduct: !!o.mandatoryScanProduct,
      mandatoryScanLotSerial: !!o.mandatoryScanLotSerial,
      allowExtraProducts: o.allowExtraProducts ?? true,
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
        cardColor: form.cardColor,
        defaultSourceLocationId: form.defaultSourceLocationId || null,
        defaultDestLocationId: form.defaultDestLocationId || null,
        returnsOperationTypeId: form.returnsOperationTypeId || null,
        printDeliverySlip: form.printDeliverySlip,
        printProductLabels: form.printProductLabels,
        printLotSerialLabels: form.printLotSerialLabels,
        mandatoryScanProduct: form.mandatoryScanProduct,
        mandatoryScanLotSerial: form.mandatoryScanLotSerial,
        allowExtraProducts: form.allowExtraProducts,
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

  const activeLocations = locations.filter((l) => l.isActive !== false);
  const returnableTypes = ops.filter((o) => o.id !== editing?.id);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium">Operation Types</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" onClick={openNew}><Plus className="h-4 w-4" /> New Operation Type</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>{editing ? 'Edit Operation Type' : 'New Operation Type'}</DialogTitle></DialogHeader>
            <div className="py-2">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Receipts, Deliveries, Factory Transfer"
                className="text-xl font-semibold border-0 border-b rounded-none focus-visible:ring-0 px-0 mb-4 h-12"
              />
              <Tabs defaultValue="general">
                <TabsList>
                  <TabsTrigger value="general">General</TabsTrigger>
                  <TabsTrigger value="hardware">Hardware</TabsTrigger>
                  <TabsTrigger value="barcode">Barcode</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="pt-4">
                  <div className="grid grid-cols-2 gap-x-8 gap-y-4">
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
                    <div className="grid gap-2 col-span-2">
                      <Label>Card Color</Label>
                      <div className="flex gap-2 flex-wrap">
                        {CARD_COLORS.map((c) => (
                          <button
                            type="button"
                            key={c.value}
                            onClick={() => setForm({ ...form, cardColor: c.value })}
                            className={`h-8 w-8 rounded-full border-2 ${c.className} ${form.cardColor === c.value ? 'border-foreground ring-2 ring-ring ring-offset-2' : 'border-transparent'}`}
                            title={c.label}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="col-span-2 border-t pt-4">
                      <div className="text-sm font-medium mb-3">Lots/Serial Numbers</div>
                      <div className="flex items-center gap-6">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox checked={form.createNewLots} onCheckedChange={(v) => setForm({ ...form, createNewLots: !!v })} />
                          <span className="text-sm">Create New</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox checked={form.useExistingLots} onCheckedChange={(v) => setForm({ ...form, useExistingLots: !!v })} />
                          <span className="text-sm">Use Existing ones</span>
                        </label>
                      </div>
                    </div>
                    <div className="col-span-2 border-t pt-4">
                      <div className="text-sm font-medium mb-3">Locations</div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>Default Source Location</Label>
                          <Select value={form.defaultSourceLocationId || 'none'} onValueChange={(v) => setForm({ ...form, defaultSourceLocationId: v === 'none' ? '' : v })}>
                            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">—</SelectItem>
                              {activeLocations.map((l) => (
                                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label>Default Destination Location</Label>
                          <Select value={form.defaultDestLocationId || 'none'} onValueChange={(v) => setForm({ ...form, defaultDestLocationId: v === 'none' ? '' : v })}>
                            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">—</SelectItem>
                              {activeLocations.map((l) => (
                                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label>Returns Type</Label>
                      <Select value={form.returnsOperationTypeId || 'none'} onValueChange={(v) => setForm({ ...form, returnsOperationTypeId: v === 'none' ? '' : v })}>
                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {returnableTypes.map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                    <div className="col-span-2 flex items-center justify-between border-t pt-4">
                      <Label>Active</Label>
                      <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="hardware" className="pt-4">
                  <div className="text-sm font-medium mb-3">Print on Validation</div>
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={form.printDeliverySlip} onCheckedChange={(v) => setForm({ ...form, printDeliverySlip: !!v })} />
                      <span className="text-sm">Print Delivery Slip</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={form.printProductLabels} onCheckedChange={(v) => setForm({ ...form, printProductLabels: !!v })} />
                      <span className="text-sm">Print Product Labels</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={form.printLotSerialLabels} onCheckedChange={(v) => setForm({ ...form, printLotSerialLabels: !!v })} />
                      <span className="text-sm">Print Lot/Serial Labels</span>
                    </label>
                  </div>
                </TabsContent>

                <TabsContent value="barcode" className="pt-4">
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm font-medium mb-3">Mandatory Scan</div>
                      <div className="space-y-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox checked={form.mandatoryScanProduct} onCheckedChange={(v) => setForm({ ...form, mandatoryScanProduct: !!v })} />
                          <span className="text-sm">Product</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox checked={form.mandatoryScanLotSerial} onCheckedChange={(v) => setForm({ ...form, mandatoryScanLotSerial: !!v })} />
                          <span className="text-sm">Lot/Serial</span>
                        </label>
                      </div>
                    </div>
                    <div className="border-t pt-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Checkbox checked={form.allowExtraProducts} onCheckedChange={(v) => setForm({ ...form, allowExtraProducts: !!v })} />
                        <span className="text-sm">Allow extra products</span>
                      </label>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
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
              <TableHead className="w-8" />
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
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : ops.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No operation types yet</TableCell></TableRow>
            ) : ops.map((o) => (
              <TableRow key={o.id}>
                <TableCell><span className={`inline-block h-3 w-3 rounded-full ${CARD_COLORS.find((c) => c.value === (o.cardColor ?? 'gray'))?.className ?? 'bg-muted'}`} /></TableCell>
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