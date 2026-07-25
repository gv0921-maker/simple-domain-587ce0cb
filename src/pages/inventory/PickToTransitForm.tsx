import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Truck, Trash2 } from 'lucide-react';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useProducts, useWarehouses } from '@/hooks/inventory';
import { useCreatePickToTransit } from '@/hooks/inventory/internalMovements';
import {
  suggestAvailableSerials, getTransitLocationForWarehouse,
  type AvailableSerialSuggestion,
} from '@/lib/services/inventory/internalMovements';
import { toast } from '@/hooks/use-toast';

export default function PickToTransitForm() {
  const navigate = useNavigate();
  const { data: products = [] } = useProducts();
  const { data: warehouses = [] } = useWarehouses();
  const createMut = useCreatePickToTransit();

  const [warehouseId, setWarehouseId] = useState('');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState(1);
  const [picked, setPicked] = useState<AvailableSerialSuggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);

  const suggest = async () => {
    if (!productId || qty < 1) {
      toast({ title: 'Pick a product and quantity', variant: 'destructive' });
      return;
    }
    setSuggesting(true);
    try {
      const rows = await suggestAvailableSerials(productId, qty, warehouseId || null);
      if (rows.length === 0) {
        toast({ title: 'No available serials', description: 'No Available stock for this product.', variant: 'destructive' });
      } else if (rows.length < qty) {
        toast({ title: `Only ${rows.length} available`, description: `Fewer Available serials than requested (${qty}).` });
      }
      setPicked(rows);
    } catch (e: any) {
      toast({ title: 'Could not suggest serials', description: e?.message, variant: 'destructive' });
    } finally {
      setSuggesting(false);
    }
  };

  const removeSerial = (id: string) =>
    setPicked((prev) => prev.filter((s) => s.goods_receipt_serial_id !== id));

  const create = async () => {
    if (!warehouseId) {
      toast({ title: 'Select a warehouse', variant: 'destructive' });
      return;
    }
    if (picked.length === 0) {
      toast({ title: 'Suggest and confirm at least one serial', variant: 'destructive' });
      return;
    }
    try {
      // §4.2: resolve the warehouse's transit location, hard error if absent.
      const transit = await getTransitLocationForWarehouse(warehouseId);
      // Source = where the picked serials currently sit (they share a location
      // in Available stock); fall back to the first non-null.
      const fromLocationId =
        picked.find((s) => s.current_location)?.current_location ?? '';
      const id = await createMut.mutateAsync({
        warehouseId,
        fromLocationId,
        toLocationId: transit.id,
        items: picked.map((s) => ({
          goods_receipt_serial_id: s.goods_receipt_serial_id,
          product_id: s.product_id,
          serial_number: s.serial_number,
        })),
      });
      toast({ title: 'Pick-to-transit created', description: `Destination: ${transit.name}. Scan and QC each unit.` });
      navigate(`/inventory/internal-movements/${id}`);
    } catch (e: any) {
      toast({ title: 'Could not create', description: e?.message, variant: 'destructive' });
    }
  };

  return (
    <AppLayout title="Inventory" subtitle="Pick to Transit" moduleNav={INVENTORY_NAV}>
      <div className="p-6 space-y-6 max-w-4xl">
        <Button variant="ghost" size="sm" onClick={() => navigate('/inventory/internal-movements')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" /> New Pick to Transit
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Warehouse</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Product</Label>
                <Select value={productId} onValueChange={(v) => { setProductId(v); setPicked([]); }}>
                  <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Quantity</Label>
                <Input type="number" min={1} value={qty} onChange={(e) => setQty(parseInt(e.target.value) || 1)} />
              </div>
            </div>
            <Button variant="outline" onClick={suggest} disabled={suggesting || !productId}>
              {suggesting ? 'Finding…' : 'Suggest Available Serials (FIFO)'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Serials to Move</span>
              {picked.length > 0 && <Badge variant="secondary">{picked.length} selected</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Serial</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {picked.length === 0 ? (
                  <TableRow><TableCell colSpan={2} className="text-center py-6 text-muted-foreground">
                    Suggest serials to build the pick list.
                  </TableCell></TableRow>
                ) : picked.map((s) => (
                  <TableRow key={s.goods_receipt_serial_id}>
                    <TableCell className="font-mono text-xs">{s.serial_number}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => removeSerial(s.goods_receipt_serial_id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex items-center gap-2">
          <Button onClick={create} disabled={createMut.isPending || picked.length === 0}>
            Create &amp; Start Picking
          </Button>
          <Button variant="outline" onClick={() => navigate('/inventory/internal-movements')}>Cancel</Button>
        </div>
      </div>
    </AppLayout>
  );
}
