import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSerialsByProduct, useProduct } from '@/hooks/inventory';
import { useCreateReservations, useReservationsBySalesOrder } from '@/hooks/inventory/reservations';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  salesOrderId: string;
  orderLineId: string;
  productId: string;
  productName: string;
  orderedQty: number;
}

export function ReserveStockDialog({
  open, onOpenChange, salesOrderId, orderLineId, productId, productName, orderedQty,
}: Props) {
  const { toast } = useToast();
  const { data: product } = useProduct(productId);
  const { data: serials = [] } = useSerialsByProduct(productId);
  const { data: existing = [] } = useReservationsBySalesOrder(salesOrderId);
  const createMut = useCreateReservations();

  const reservedForThisLine = existing.filter(
    (r) => r.orderLineId === orderLineId && r.status === 'reserved',
  );
  const alreadyReservedQty = reservedForThisLine.reduce((s, r) => s + r.quantity, 0);
  const remaining = Math.max(orderedQty - alreadyReservedQty, 0);

  const availableSerials = useMemo(
    () => serials.filter((s) => s.status === 'available'),
    [serials],
  );

  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [bulkQty, setBulkQty] = useState<number>(remaining);
  const [notes, setNotes] = useState('');

  // GR generates per-unit serials for every product in this app, so if any
  // available serials exist we always use the serial-picking flow — regardless
  // of the `products.track_serials` flag (which is not consistently set).
  const usesSerials = availableSerials.length > 0 || (product?.trackSerials ?? false);

  const toggleSerial = (id: string) => {
    setSelectedSerials((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleConfirm = async () => {
    try {
      if (usesSerials) {
        if (selectedSerials.length === 0) {
          toast({ title: 'Select at least one serial number', variant: 'destructive' });
          return;
        }
        if (selectedSerials.length > remaining) {
          toast({ title: `You can only reserve ${remaining} more unit(s).`, variant: 'destructive' });
          return;
        }
        await createMut.mutateAsync(
          selectedSerials.map((sid) => ({
            salesOrderId, orderLineId, productId,
            serialNumberId: sid, quantity: 1, notes: notes || undefined,
          })),
        );
      } else {
        const qty = Math.min(bulkQty, remaining);
        if (qty <= 0) {
          toast({ title: 'Quantity must be greater than 0', variant: 'destructive' });
          return;
        }
        await createMut.mutateAsync([{
          salesOrderId, orderLineId, productId,
          quantity: qty, notes: notes || undefined,
        }]);
      }
      toast({ title: 'Stock reserved successfully' });
      onOpenChange(false);
      setSelectedSerials([]);
      setNotes('');
    } catch (e: any) {
      toast({ title: 'Failed to reserve stock', description: e?.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reserve Stock — {productName}</DialogTitle>
          <DialogDescription>
            Ordered: {orderedQty} · Already reserved: {alreadyReservedQty} · Remaining: {remaining}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {usesSerials ? (
            <div className="space-y-2">
              <Label>Available Serial Numbers ({availableSerials.length})</Label>
              {availableSerials.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No available serial numbers for this product.
                </p>
              ) : (
                <ScrollArea className="h-64 border rounded-md p-2">
                  <div className="space-y-1">
                    {availableSerials.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-3 p-2 hover:bg-muted/50 rounded cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedSerials.includes(s.id)}
                          onCheckedChange={() => toggleSerial(s.id)}
                          disabled={!selectedSerials.includes(s.id) && selectedSerials.length >= remaining}
                        />
                        <span className="font-mono text-sm flex-1">{s.name}</span>
                        <Badge variant="outline" className="text-success border-success">Available</Badge>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              )}
              <p className="text-xs text-muted-foreground">
                Selected: {selectedSerials.length} / {remaining}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Quantity to Reserve</Label>
              <Input
                type="number"
                min={1}
                max={remaining}
                value={bulkQty}
                onChange={(e) => setBulkQty(parseInt(e.target.value, 10) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                Available on hand: {product?.stockOnHand ?? 0}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={createMut.isPending || remaining <= 0}>
            {createMut.isPending ? 'Reserving…' : 'Confirm Reservation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}