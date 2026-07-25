import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useProducts, useLocations, useSaveAdjustment } from '@/hooks/inventory';
import { useAuth } from '@/contexts/AuthContext';
import type { AdjustmentReason, AdjustmentLine, InventoryAdjustment } from '@/lib/data/inventory/types';
import { toast } from '@/hooks/use-toast';

const REASONS: { value: AdjustmentReason; label: string }[] = [
  { value: 'count', label: 'Count Correction' },
  { value: 'damage', label: 'Damage' },
  { value: 'theft', label: 'Theft / Loss' },
  { value: 'expiry', label: 'Expiry' },
  { value: 'correction', label: 'Correction' },
  { value: 'other', label: 'Other' },
];

type DraftLine = {
  key: string;
  productId: string;
  theoreticalQty: number;
  countedQty: number;
};

export default function AdjustmentForm() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: products = [] } = useProducts();
  const { data: locations = [] } = useLocations();
  const saveMut = useSaveAdjustment();

  const [locationId, setLocationId] = useState('');
  const [reason, setReason] = useState<AdjustmentReason>('count');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);

  const addLine = () =>
    setLines((p) => [...p, { key: crypto.randomUUID(), productId: '', theoreticalQty: 0, countedQty: 0 }]);
  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((p) => p.filter((l) => l.key !== key));

  const onProduct = (key: string, productId: string) => {
    // Seed the theoretical quantity from the product's current on-hand.
    const prod = products.find((p) => p.id === productId);
    updateLine(key, { productId, theoreticalQty: prod?.stockOnHand ?? 0 });
  };

  const save = async () => {
    if (!locationId) { toast({ title: 'Select a location', variant: 'destructive' }); return; }
    const valid = lines.filter((l) => l.productId);
    if (valid.length === 0) { toast({ title: 'Add at least one product line', variant: 'destructive' }); return; }

    const location = locations.find((l) => l.id === locationId);
    const adjLines: AdjustmentLine[] = valid.map((l) => {
      const prod = products.find((p) => p.id === l.productId)!;
      const difference = l.countedQty - l.theoreticalQty;
      return {
        id: crypto.randomUUID(),
        productId: l.productId,
        productName: prod.name,
        productSku: prod.sku,
        theoreticalQty: l.theoreticalQty,
        countedQty: l.countedQty,
        difference,
        unitCost: prod.costPrice,
        valueDifference: difference * prod.costPrice,
      };
    });

    const adjustment: InventoryAdjustment = {
      id: '',
      reference: '',
      locationId,
      locationName: location?.name ?? '',
      reason,
      // Goes straight to the approval queue; an admin approves to post it.
      status: 'pending_approval',
      lines: adjLines,
      notes: notes || undefined,
      createdBy: user?.name ?? 'Unknown',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await saveMut.mutateAsync(adjustment);
      toast({ title: 'Adjustment submitted for approval' });
      navigate('/inventory/adjustments');
    } catch (e: any) {
      toast({ title: 'Could not save', description: e?.message, variant: 'destructive' });
    }
  };

  return (
    <AppLayout title="Inventory" subtitle="New Adjustment" moduleNav={INVENTORY_NAV}>
      <div className="p-6 space-y-6 max-w-4xl">
        <Button variant="ghost" size="sm" onClick={() => navigate('/inventory/adjustments')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>

        <Card>
          <CardHeader><CardTitle>New Inventory Adjustment</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Location</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reason</Label>
                <Select value={reason} onValueChange={(v) => setReason(v as AdjustmentReason)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Lines</CardTitle>
            <Button variant="outline" size="sm" onClick={addLine} className="gap-2">
              <Plus className="h-4 w-4" /> Add Line
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Product</TableHead>
                    <TableHead className="text-right">Theoretical</TableHead>
                    <TableHead className="text-right">Counted</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                      Add a line to record a counted quantity.
                    </TableCell></TableRow>
                  ) : lines.map((l) => {
                    const diff = l.countedQty - l.theoreticalQty;
                    return (
                      <TableRow key={l.key}>
                        <TableCell>
                          <Select value={l.productId} onValueChange={(v) => onProduct(l.key, v)}>
                            <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                            <SelectContent>
                              {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input type="number" className="w-24 ml-auto text-right"
                            value={l.theoreticalQty}
                            onChange={(e) => updateLine(l.key, { theoreticalQty: parseFloat(e.target.value) || 0 })} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input type="number" className="w-24 ml-auto text-right"
                            value={l.countedQty}
                            onChange={(e) => updateLine(l.key, { countedQty: parseFloat(e.target.value) || 0 })} />
                        </TableCell>
                        <TableCell className={`text-right font-medium ${diff < 0 ? 'text-destructive' : diff > 0 ? 'text-success' : ''}`}>
                          {diff > 0 ? `+${diff}` : diff}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => removeLine(l.key)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saveMut.isPending}>Submit for Approval</Button>
          <Button variant="outline" onClick={() => navigate('/inventory/adjustments')}>Cancel</Button>
        </div>
      </div>
    </AppLayout>
  );
}
