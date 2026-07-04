import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  useProductAttributes,
  useProductAttributeAssignments,
  useSetProductAttributeAssignments,
} from '@/hooks/inventory/config';
import { useToast } from '@/hooks/use-toast';

interface Props { productId: string; }

export function ProductAttributesAssignment({ productId }: Props) {
  const { data: attributes = [], isLoading: loadingAttrs } = useProductAttributes();
  const { data: assignments = [], isLoading: loadingAssign } = useProductAttributeAssignments(productId);
  const setMut = useSetProductAttributeAssignments(productId);
  const { toast } = useToast();

  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    setSelected(assignments.map((a) => a.attributeId));
  }, [assignments]);

  const toggle = (id: string) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const save = async () => {
    try {
      await setMut.mutateAsync(selected);
      toast({ title: 'Attributes updated' });
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product Attributes</CardTitle>
        <p className="text-sm text-muted-foreground">
          Select which global attributes apply to this product. Chosen attributes appear in the
          Sales Order customization picker.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingAttrs || loadingAssign ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : attributes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No attributes defined yet. Go to Inventory → Configuration → Product Attributes to create some.
          </p>
        ) : (
          <div className="space-y-2">
            {attributes.map((a) => (
              <label key={a.id} className="flex items-start gap-3 p-2 border rounded hover:bg-muted/30 cursor-pointer">
                <Checkbox
                  checked={selected.includes(a.id)}
                  onCheckedChange={() => toggle(a.id)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    <Badge variant="outline" className="capitalize">{a.displayType}</Badge>
                    <Badge variant="secondary">{a.values?.length ?? 0} values</Badge>
                  </div>
                  {(a.values ?? []).length > 0 && (
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-1">
                      {(a.values ?? []).map((v) => v.value).join(', ')}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={save} disabled={setMut.isPending}>Save Attributes</Button>
        </div>
      </CardContent>
    </Card>
  );
}