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
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import {
  useProductAttributes, useSaveProductAttribute, useDeleteProductAttribute,
  useSaveProductAttributeValue, useDeleteProductAttributeValue,
} from '@/hooks/inventory/config';
import type {
  ProductAttribute, AttributeDisplayType, ProductAttributeValue,
} from '@/lib/services/inventory/attributes';
import { useToast } from '@/hooks/use-toast';

export function AttributesConfig() {
  const { data: attributes = [], isLoading } = useProductAttributes();
  const saveAttr = useSaveProductAttribute();
  const delAttr = useDeleteProductAttribute();
  const saveVal = useSaveProductAttributeValue();
  const delVal = useDeleteProductAttributeValue();
  const { toast } = useToast();

  const [attrOpen, setAttrOpen] = useState(false);
  const [editingAttr, setEditingAttr] = useState<ProductAttribute | null>(null);
  const [attrForm, setAttrForm] = useState({
    name: '', displayType: 'radio' as AttributeDisplayType, isActive: true, sortOrder: 0,
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [valOpen, setValOpen] = useState(false);
  const [valAttrId, setValAttrId] = useState<string | null>(null);
  const [editingVal, setEditingVal] = useState<ProductAttributeValue | null>(null);
  const [valForm, setValForm] = useState({
    value: '', extraPrice: 0, colorHex: '', sortOrder: 0,
  });

  const openNewAttr = () => {
    setEditingAttr(null);
    setAttrForm({ name: '', displayType: 'radio', isActive: true, sortOrder: 0 });
    setAttrOpen(true);
  };
  const openEditAttr = (a: ProductAttribute) => {
    setEditingAttr(a);
    setAttrForm({ name: a.name, displayType: a.displayType, isActive: a.isActive, sortOrder: a.sortOrder });
    setAttrOpen(true);
  };
  const submitAttr = async () => {
    if (!attrForm.name.trim()) {
      toast({ title: 'Name required', variant: 'destructive' }); return;
    }
    try {
      await saveAttr.mutateAsync({ id: editingAttr?.id, ...attrForm, name: attrForm.name.trim() });
      toast({ title: editingAttr ? 'Attribute updated' : 'Attribute created' });
      setAttrOpen(false);
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
    }
  };
  const removeAttr = async (id: string) => {
    if (!confirm('Delete this attribute and all its values?')) return;
    try { await delAttr.mutateAsync(id); toast({ title: 'Deleted' }); }
    catch (e: any) { toast({ title: 'Delete failed', description: e?.message, variant: 'destructive' }); }
  };

  const openNewVal = (attrId: string) => {
    setValAttrId(attrId);
    setEditingVal(null);
    setValForm({ value: '', extraPrice: 0, colorHex: '', sortOrder: 0 });
    setValOpen(true);
  };
  const openEditVal = (v: ProductAttributeValue) => {
    setValAttrId(v.attributeId);
    setEditingVal(v);
    setValForm({ value: v.value, extraPrice: v.extraPrice, colorHex: v.colorHex ?? '', sortOrder: v.sortOrder });
    setValOpen(true);
  };
  const submitVal = async () => {
    if (!valForm.value.trim() || !valAttrId) {
      toast({ title: 'Value required', variant: 'destructive' }); return;
    }
    try {
      await saveVal.mutateAsync({
        id: editingVal?.id,
        attributeId: valAttrId,
        value: valForm.value.trim(),
        extraPrice: Number(valForm.extraPrice) || 0,
        colorHex: valForm.colorHex || null,
        sortOrder: Number(valForm.sortOrder) || 0,
      });
      toast({ title: editingVal ? 'Value updated' : 'Value created' });
      setValOpen(false);
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
    }
  };
  const removeVal = async (id: string) => {
    if (!confirm('Delete this value?')) return;
    try { await delVal.mutateAsync(id); toast({ title: 'Deleted' }); }
    catch (e: any) { toast({ title: 'Delete failed', description: e?.message, variant: 'destructive' }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium">Product Attributes</h2>
        <Dialog open={attrOpen} onOpenChange={setAttrOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" onClick={openNewAttr}><Plus className="h-4 w-4" /> New Attribute</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingAttr ? 'Edit Attribute' : 'New Attribute'}</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label>Name *</Label>
                <Input value={attrForm.name} onChange={(e) => setAttrForm({ ...attrForm, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Display Type</Label>
                <Select value={attrForm.displayType} onValueChange={(v) => setAttrForm({ ...attrForm, displayType: v as AttributeDisplayType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="radio">Radio</SelectItem>
                    <SelectItem value="select">Select</SelectItem>
                    <SelectItem value="color">Color</SelectItem>
                    <SelectItem value="pills">Pills</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Sort Order</Label>
                  <Input type="number" value={attrForm.sortOrder} onChange={(e) => setAttrForm({ ...attrForm, sortOrder: Number(e.target.value) })} />
                </div>
                <div className="flex items-end justify-between">
                  <Label>Active</Label>
                  <Switch checked={attrForm.isActive} onCheckedChange={(v) => setAttrForm({ ...attrForm, isActive: v })} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAttrOpen(false)}>Cancel</Button>
              <Button onClick={submitAttr} disabled={saveAttr.isPending}>{editingAttr ? 'Update' : 'Create'}</Button>
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
              <TableHead>Display Type</TableHead>
              <TableHead>Values</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-[140px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : attributes.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No attributes yet</TableCell></TableRow>
            ) : attributes.flatMap((a) => {
              const isOpen = !!expanded[a.id];
              const rows = [
                <TableRow key={a.id}>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setExpanded({ ...expanded, [a.id]: !isOpen })}>
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                  </TableCell>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="capitalize">{a.displayType}</TableCell>
                  <TableCell><Badge variant="secondary">{a.values?.length ?? 0}</Badge></TableCell>
                  <TableCell>{a.isActive ? 'Yes' : 'No'}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openNewVal(a.id)}><Plus className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => openEditAttr(a)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => removeAttr(a.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>,
              ];
              if (isOpen) {
                rows.push(
                  <TableRow key={`${a.id}-values`}>
                    <TableCell colSpan={6} className="bg-muted/30">
                      <div className="p-2 space-y-1">
                        {(a.values ?? []).length === 0 ? (
                          <p className="text-xs text-muted-foreground">No values yet.</p>
                        ) : (a.values ?? []).map((v) => (
                          <div key={v.id} className="flex items-center gap-3 text-sm">
                            {v.colorHex && (
                              <span className="inline-block h-4 w-4 rounded border" style={{ backgroundColor: v.colorHex }} />
                            )}
                            <span className="font-medium">{v.value}</span>
                            {v.extraPrice > 0 && (
                              <span className="text-muted-foreground">+₹{v.extraPrice}</span>
                            )}
                            <div className="ml-auto flex gap-1">
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditVal(v)}><Pencil className="h-3 w-3" /></Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeVal(v.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }
              return rows;
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={valOpen} onOpenChange={setValOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingVal ? 'Edit Value' : 'New Value'}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Value *</Label>
              <Input value={valForm.value} onChange={(e) => setValForm({ ...valForm, value: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Extra Price</Label>
                <Input type="number" value={valForm.extraPrice} onChange={(e) => setValForm({ ...valForm, extraPrice: Number(e.target.value) })} />
              </div>
              <div className="grid gap-2">
                <Label>Sort Order</Label>
                <Input type="number" value={valForm.sortOrder} onChange={(e) => setValForm({ ...valForm, sortOrder: Number(e.target.value) })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Color (hex, e.g. #FF0000)</Label>
              <div className="flex gap-2">
                <Input value={valForm.colorHex} onChange={(e) => setValForm({ ...valForm, colorHex: e.target.value })} placeholder="#000000" />
                {valForm.colorHex && (
                  <span className="inline-block h-9 w-9 rounded border" style={{ backgroundColor: valForm.colorHex }} />
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setValOpen(false)}>Cancel</Button>
            <Button onClick={submitVal} disabled={saveVal.isPending}>{editingVal ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}