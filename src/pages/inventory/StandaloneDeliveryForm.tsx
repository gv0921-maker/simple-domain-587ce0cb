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
import { useCreateStandaloneDelivery } from '@/hooks/inventory/deliveryNotes';
import {
  suggestSerialsAtTransit, type TransitSerialSuggestion,
} from '@/lib/services/inventory/deliveryNotes';
import { toast } from '@/hooks/use-toast';

export default function StandaloneDeliveryForm() {
  const navigate = useNavigate();
  const { data: products = [] } = useProducts();
  const { data: warehouses = [] } = useWarehouses();
  const createMut = useCreateStandaloneDelivery();

  const [warehouseId, setWarehouseId] = useState('');
  const [productId, setProductId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [reference, setReference] = useState('');
  const [picked, setPicked] = useState<TransitSerialSuggestion[]>([]);
  const [finding, setFinding] = useState(false);

  const find = async () => {
    if (!warehouseId || !productId) {
      toast({ title: 'Pick a warehouse and product', variant: 'destructive' });
      return;
    }
    setFinding(true);
    try {
      const rows = await suggestSerialsAtTransit(warehouseId, productId);
      if (rows.length === 0) {
        toast({ title: 'Nothing at transit', description: 'No units of this product are waiting at transit.', variant: 'destructive' });
      }
      setPicked(rows);
    } catch (e: any) {
      toast({ title: 'Could not load transit stock', description: e?.message, variant: 'destructive' });
    } finally {
      setFinding(false);
    }
  };

  const removeSerial = (id: string) =>
    setPicked((prev) => prev.filter((s) => s.goods_receipt_serial_id !== id));

  const create = async () => {
    if (picked.length === 0) {
      toast({ title: 'Add at least one unit to deliver', variant: 'destructive' });
      return;
    }
    const product = products.find((p) => p.id === productId);
    try {
      const dn = await createMut.mutateAsync({
        warehouseId,
        customerName: customerName || undefined,
        externalReference: reference || undefined,
        products: [{
          product_id: productId,
          product_name: product?.name ?? 'Product',
          quantity: picked.length,
          unit: 'Unit',
          serial_numbers: picked.map((s) => s.serial_number),
          warehouse_location: 'Transit',
        }],
      });
      toast({ title: 'Delivery created', description: 'Scan and QC each unit, then complete the handoff.' });
      navigate(`/inventory/delivery-notes/${dn.id}`);
    } catch (e: any) {
      toast({ title: 'Could not create delivery', description: e?.message, variant: 'destructive' });
    }
  };

  return (
    <AppLayout title="Delivery Notes" subtitle="New Delivery" moduleNav={INVENTORY_NAV}>
      <div className="p-6 space-y-6 max-w-4xl">
        <Button variant="ghost" size="sm" onClick={() => navigate('/inventory/delivery-notes')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" /> New Delivery (from transit)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Warehouse</Label>
                <Select value={warehouseId} onValueChange={(v) => { setWarehouseId(v); setPicked([]); }}>
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
                <Label>Customer Name (optional)</Label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="" />
              </div>
              <div>
                <Label>Reference (optional)</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="" />
              </div>
            </div>
            <Button variant="outline" onClick={find} disabled={finding || !warehouseId || !productId}>
              {finding ? 'Loading…' : 'Load Units at Transit'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Units to Deliver</span>
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
                    Load units waiting at transit for this product.
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
            Create Delivery
          </Button>
          <Button variant="outline" onClick={() => navigate('/inventory/delivery-notes')}>Cancel</Button>
        </div>
      </div>
    </AppLayout>
  );
}
