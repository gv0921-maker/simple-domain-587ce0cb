import { useMemo, useRef, useState } from 'react';
import { useProductCustomizationOptions } from '@/hooks/products/customizationOptions';
import { useProductAssignedAttributes } from '@/hooks/inventory/config';
import { useInv2ProductValueScope } from '@/hooks/inventory2/valueScope';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Upload, X, Image as ImageIcon, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type {
  ProductCustomizationOption,
  ProductCustomizationOptionType,
} from '@/lib/data/sales/types';

export interface CustomizationValue {
  size?: string;
  colour?: string;
  fabric?: string;
  polish?: string;
  notes?: string;
  referenceImages?: string[];
  /** Sum of additionalPrice from chosen predefined options. */
  priceAdjustment?: number;
  /** Freeform choices keyed by attribute name (for global attributes assigned to the product). */
  attributes?: Record<string, string>;
}

interface Props {
  productId?: string;
  value: CustomizationValue;
  onChange: (next: CustomizationValue) => void;
  disabled?: boolean;
}

const TYPES: { key: keyof CustomizationValue; type: ProductCustomizationOptionType; label: string }[] = [
  { key: 'size', type: 'size', label: 'Size' },
  { key: 'colour', type: 'colour', label: 'Colour' },
  { key: 'fabric', type: 'fabric', label: 'Fabric' },
  { key: 'polish', type: 'polish', label: 'Polish' },
];

const CUSTOM_SENTINEL = '__custom__';
const BUCKET = 'sales-order-images';

const fmtPrice = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);

export function CustomizationPicker({ productId, value, onChange, disabled }: Props) {
  const { data: options = [] } = useProductCustomizationOptions(productId);
  const { data: assignedAttrs = [] } = useProductAssignedAttributes(productId);
  /*
   * PASS C. Values are now scoped to the product's category and priced by the
   * category link, so `v.extraPrice` below is the per-category figure — the
   * global product_attribute_values.extra_price no longer reaches this screen.
   * Repointed inside listAttributesForProduct so this component did not have to
   * change to follow it.
   *
   * The scope read is only for EXPLAINING an empty list. An uncategorised
   * product legitimately offers nothing, and without a reason on screen that
   * looks like a broken dropdown.
   */
  const { data: valueScope } = useInv2ProductValueScope(productId);
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const grouped = useMemo(() => {
    const m = new Map<ProductCustomizationOptionType, ProductCustomizationOption[]>();
    for (const o of options) {
      if (!o.isActive) continue;
      const arr = m.get(o.optionType) ?? [];
      arr.push(o);
      m.set(o.optionType, arr);
    }
    return m;
  }, [options]);

  const recomputeAdjustment = (next: CustomizationValue): number => {
    let total = 0;
    for (const { key, type } of TYPES) {
      const v = next[key] as string | undefined;
      const match = (grouped.get(type) ?? []).find((o) => o.optionValue === v);
      if (match) total += match.additionalPrice || 0;
    }
    // Global attribute assignments: add extra_price from selected values.
    const attrChoices = next.attributes ?? {};
    for (const a of assignedAttrs) {
      const chosen = attrChoices[a.name];
      if (!chosen) continue;
      const val = (a.values ?? []).find((v) => v.value === chosen);
      if (val) total += val.extraPrice || 0;
    }
    return total;
  };

  const updateField = (key: keyof CustomizationValue, newValue: string | undefined) => {
    const next: CustomizationValue = { ...value, [key]: newValue };
    next.priceAdjustment = recomputeAdjustment(next);
    onChange(next);
  };

  const updateAttribute = (attrName: string, newValue: string | undefined) => {
    const nextAttrs = { ...(value.attributes ?? {}) };
    if (newValue == null || newValue === '') delete nextAttrs[attrName];
    else nextAttrs[attrName] = newValue;
    const next: CustomizationValue = { ...value, attributes: nextAttrs };
    next.priceAdjustment = recomputeAdjustment(next);
    onChange(next);
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const urls: string[] = [...(value.referenceImages ?? [])];
    try {
      for (const file of Array.from(files)) {
        const path = `${productId ?? 'misc'}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
        if (error) throw error;
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
        if (data?.publicUrl) urls.push(data.publicUrl);
      }
      onChange({ ...value, referenceImages: urls });
    } catch (e) {
      toast({
        title: 'Upload failed',
        description: e?.message ?? 'Ensure the "sales-order-images" Storage bucket exists and is public.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeImage = (url: string) => {
    onChange({ ...value, referenceImages: (value.referenceImages ?? []).filter((u) => u !== url) });
  };

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-3 bg-muted/20">
      {/*
        Pass C: the product has attributes but its category offers no values for
        them, so every dropdown below would be empty. Say which of the two
        reasons it is — they need different people to fix them.
      */}
      {assignedAttrs.length > 0 &&
        assignedAttrs.every((a) => (a.values ?? []).length === 0) &&
        valueScope && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="text-xs">
              <p className="font-semibold text-amber-700 dark:text-amber-500">
                {valueScope.categoryId === null
                  ? 'This product has no category, so no options are available'
                  : `${valueScope.categoryName ?? 'This category'} offers no options for this product`}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {valueScope.categoryId === null
                  ? 'The choices a product offers are declared on its category. Ask Inventory to categorise it.'
                  : 'The category declares none of this product’s attribute values. Ask Inventory to declare them on the category or one of its parents.'}
              </p>
            </div>
          </div>
        )}

      {assignedAttrs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {assignedAttrs.map((a) => {
            const current = (value.attributes ?? {})[a.name] ?? '';
            const vals = a.values ?? [];
            return (
              <div key={a.id} className="space-y-1">
                <Label className="text-xs">{a.name}</Label>
                <Select
                  value={current || undefined}
                  onValueChange={(v) => updateAttribute(a.name, v === CUSTOM_SENTINEL ? '' : v)}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder={`Select ${a.name.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {vals.map((v) => (
                      <SelectItem key={v.id} value={v.value}>
                        {a.displayType === 'color' && v.colorHex && (
                          <span
                            className="inline-block h-3 w-3 rounded border align-middle mr-2"
                            style={{ backgroundColor: v.colorHex }}
                          />
                        )}
                        {v.value}
                        {v.extraPrice > 0 && ` (+₹${fmtPrice(v.extraPrice)})`}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_SENTINEL}>Clear</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      )}

      {assignedAttrs.length === 0 && (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {TYPES.map(({ key, type, label }) => {
          const opts = grouped.get(type) ?? [];
          const current = (value[key] as string | undefined) ?? '';
          const isCustom =
            !!current && !opts.some((o) => o.optionValue === current);
          const selectValue = isCustom ? CUSTOM_SENTINEL : (current || '');
          return (
            <div key={key} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              {opts.length > 0 ? (
                <Select
                  value={selectValue || undefined}
                  onValueChange={(v) => updateField(key, v === CUSTOM_SENTINEL ? '' : v)}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {opts.map((o) => (
                      <SelectItem key={o.id} value={o.optionValue}>
                        {o.optionValue}
                        {o.additionalPrice > 0 && ` (+₹${fmtPrice(o.additionalPrice)})`}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_SENTINEL}>Custom…</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
              {(opts.length === 0 || isCustom) && (
                <Input
                  className="h-8 text-xs"
                  value={current}
                  onChange={(e) => updateField(key, e.target.value)}
                  disabled={disabled}
                  placeholder=""
                />
              )}
            </div>
          );
        })}
      </div>
      )}

      {(value.priceAdjustment ?? 0) > 0 && (
        <div className="text-xs text-muted-foreground">
          Customization adjustment: <span className="font-medium text-foreground">+₹{fmtPrice(value.priceAdjustment ?? 0)}</span>
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Customization Notes</Label>
        <Textarea
          rows={2}
          value={value.notes ?? ''}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          disabled={disabled}
          className="text-xs min-h-[48px]"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Reference Images</Label>
        <div className="flex flex-wrap items-center gap-2">
          {(value.referenceImages ?? []).map((url) => (
            <div key={url} className="relative group">
              <img src={url} alt="ref" className="h-14 w-14 object-cover rounded border" />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeImage(url)}
                  className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100"
                  aria-label="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {!disabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-14 w-14 flex-col text-[10px] gap-0.5"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <ImageIcon className="h-4 w-4 animate-pulse" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              <span>{uploading ? 'Uploading' : 'Upload'}</span>
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
        </div>
      </div>
    </div>
  );
}