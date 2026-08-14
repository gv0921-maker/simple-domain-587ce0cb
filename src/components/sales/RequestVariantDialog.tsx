/**
 * Sales — request a version that does not exist yet. Pass 10C.
 *
 * CREATE ONLY, and provisional. A salesperson meets a customer who wants a
 * combination nobody has catalogued; this puts it in the catalogue so Inventory
 * can order it from the factory. No editing, no archiving, no management —
 * those live in Inventory, and RLS enforces the same split independently
 * (product_variants_insert_write admits sales_rep, _update_inv does not).
 *
 * WHAT THIS DOES NOT DO, and why the dialog says so out loud:
 * it does not attach the new version to this order line. order_lines has no
 * variant_id column yet — that arrives in 10F — so the line goes on recording
 * the combination in its customization_* text fields exactly as it does today.
 * Two things end up describing the same chair, and a salesperson who was not
 * told that would reasonably assume something had gone wrong. So the dialog
 * states it plainly rather than leaving it to be discovered.
 *
 * Confined to Sales' own component tree on purpose: SalesOrderForm and
 * QuotationForm are on the shared-boundary list in CLAUDE.md and neither is
 * touched. OrderLinesTable already owns the customization state, so the dialog
 * needs nothing from its parents.
 */
import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Info, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useInv2AssignedAttributes, useInv2Variants, useCreateVariant,
} from '@/hooks/inventory2/variants';
import { errorText } from '@/lib/inventory2/errorText';

export interface RequestVariantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName?: string;
}

export function RequestVariantDialog({
  open, onOpenChange, productId, productName,
}: RequestVariantDialogProps) {
  const { data: scope, isLoading } = useInv2AssignedAttributes(open ? productId : undefined);
  const attributes = useMemo(() => scope?.attributes ?? [], [scope]);
  const { data: existing = [] } = useInv2Variants(open ? productId : undefined);
  const create = useCreateVariant();
  const { toast } = useToast();

  const [values, setValues] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const chosenLabels = useMemo(
    () =>
      attributes
        .map((a) => a.values.find((v) => v.id === values[a.id])?.value)
        .filter((v): v is string => !!v),
    [attributes, values],
  );

  const duplicate = useMemo(() => {
    const chosen = attributes.map((a) => values[a.id]).filter(Boolean).sort().join(':');
    if (!chosen) return null;
    return existing.find((v) => v.values.map((x) => x.value_id).sort().join(':') === chosen) ?? null;
  }, [attributes, values, existing]);

  const allChosen = attributes.length > 0 && attributes.every((a) => !!values[a.id]);

  function reset() {
    setValues({});
    setFailure(null);
    setCreated(null);
  }

  async function submit() {
    setFailure(null);
    const suffix = chosenLabels
      .map((v) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6))
      .filter(Boolean)
      .join('-');
    try {
      const variant = await create.mutateAsync({
        product_id: productId,
        sku: suffix,
        name: `${productName ?? 'Product'} (${chosenLabels.join(', ')})`,
        barcode: null,
        sale_price: 0,
        cost_price: 0,
        // Provisional, always. Sales creates versions that have not yet earned
        // their place; an order confirmed against one promotes it (10F), and
        // physical units of one promote it regardless.
        status: 'provisional',
        values,
      });
      setCreated(variant.sku);
      toast({
        title: 'Version added to the catalogue',
        description: `${variant.name} — Inventory can now order it.`,
      });
    } catch (e) {
      // Rule 5 — the database's sentence, verbatim.
      setFailure(errorText(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Request a version that doesn't exist yet</DialogTitle>
          <DialogDescription>
            Adds the combination to the catalogue so Inventory can order it from the
            factory. It does not change this order line.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3">
            <Alert>
              <Check className="h-4 w-4" />
              <AlertDescription>
                <span className="font-medium">{created}</span> has been added to the catalogue
                as a <Badge variant="secondary">provisional</Badge> version, so Inventory can
                order it from the factory.
                <span className="mt-2 block text-muted-foreground">
                  This order line is unchanged — it still carries the customization you entered
                  above, exactly as before. The two will be linked once versions can be picked
                  directly on a line.
                </span>
              </AlertDescription>
            </Alert>
            <div className="flex justify-end">
              <Button onClick={() => { reset(); onOpenChange(false); }}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {failure && (
              <Alert variant="destructive">
                <AlertDescription className="whitespace-pre-wrap">{failure}</AlertDescription>
              </Alert>
            )}

            {isLoading || !scope ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : scope.categoryId === null ? (
              /*
                Pass C. A product with no category offers no values at all, so
                there is nothing for a salesperson to pick. Saying "no
                attributes" here would send them to the wrong person.
              */
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  This product has no category, and the values a version can be built from
                  are declared on the category. Ask Inventory to categorise it before
                  requesting a version.
                </AlertDescription>
              </Alert>
            ) : attributes.length === 0 ? (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  This product has no attributes set up, so there is no combination to
                  request. Ask Inventory to assign attributes to it first.
                </AlertDescription>
              </Alert>
            ) : attributes.every((a) => a.values.length === 0) ? (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  {scope.categoryName ?? 'This product’s category'} declares no values for{' '}
                  {attributes.map((a) => a.name).join(', ')}, so there is no combination to
                  request. Ask Inventory to declare them on the category.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {attributes.map((a) => (
                  <div key={a.id} className="space-y-1">
                    <Label className="text-xs">{a.name}</Label>
                    <Select
                      value={values[a.id] ?? undefined}
                      onValueChange={(v) => setValues((p) => ({ ...p, [a.id]: v }))}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder={`Select ${a.name.toLowerCase()}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {a.values.map((v) => (
                          <SelectItem key={v.id} value={v.id}>{v.value}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}

                {duplicate && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      That version already exists as <strong>{duplicate.sku}</strong>, so there
                      is nothing to request. Inventory can already order it.
                    </AlertDescription>
                  </Alert>
                )}

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Sales can add a version but not price or name it — Inventory completes it.
                  </AlertDescription>
                </Alert>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                  <Button
                    onClick={() => void submit()}
                    disabled={!allChosen || !!duplicate || create.isPending}
                  >
                    {create.isPending ? 'Adding…' : 'Add to catalogue'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
