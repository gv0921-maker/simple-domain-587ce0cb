import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { MANUFACTURING_NAV } from '@/lib/navigation/manufacturing';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { useProducts } from '@/hooks/inventory';
import {
  useWorkOrderV2, useCreateWorkOrderV2, useUpdateWorkOrderDraft,
  useSubmitForApproval, useAssignableUsers,
} from '@/hooks/manufacturing/workOrders';
import { uploadReferenceImage } from '@/lib/services/manufacturing/workOrders';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

function useSalesOrdersLite() {
  return useQuery({
    queryKey: ['so-lite'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('sales_orders')
        .select('id, reference, status').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useSOLines(soId: string | null) {
  return useQuery({
    queryKey: ['so-lines', soId],
    queryFn: async () => {
      if (!soId) return [];
      const { data, error } = await (supabase as any).from('order_lines')
        .select('id, product_id, product_name, quantity, product_source')
        .eq('order_id', soId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!soId,
  });
}

export default function WorkOrderForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;
  const [params] = useSearchParams();

  const { data: existing } = useWorkOrderV2(id);
  const { data: products = [] } = useProducts();
  const { data: users = [] } = useAssignableUsers();
  const { data: sos = [] } = useSalesOrdersLite();
  const createMut = useCreateWorkOrderV2();
  const updateMut = useUpdateWorkOrderDraft();
  const submitMut = useSubmitForApproval();

  const [form, setForm] = useState({
    product_id: '',
    quantity: 1,
    size_spec: '',
    colour_polish_spec: '',
    fabric_spec: '',
    customization_notes: '',
    reference_images: [] as string[],
    linked_sales_order_id: null as string | null,
    linked_sales_order_line_id: null as string | null,
    assigned_factory_incharge_id: null as string | null,
    eta_date: '' as string,
    notes: '',
  });
  const [uploading, setUploading] = useState(false);

  const { data: soLines = [] } = useSOLines(form.linked_sales_order_id);

  useEffect(() => {
    if (existing) {
      setForm({
        product_id: existing.product_id,
        quantity: existing.quantity,
        size_spec: existing.size_spec ?? '',
        colour_polish_spec: existing.colour_polish_spec ?? '',
        fabric_spec: existing.fabric_spec ?? '',
        customization_notes: existing.customization_notes ?? '',
        reference_images: existing.reference_images ?? [],
        linked_sales_order_id: existing.linked_sales_order_id,
        linked_sales_order_line_id: existing.linked_sales_order_line_id,
        assigned_factory_incharge_id: existing.assigned_factory_incharge_id,
        eta_date: existing.eta_date ?? '',
        notes: existing.notes ?? '',
      });
    }
  }, [existing]);

  // Pre-fill from query string (from SO line "Create Work Order")
  useEffect(() => {
    if (isEdit) return;
    const so = params.get('sales_order');
    const soLine = params.get('sales_order_line');
    const prod = params.get('product_id');
    const qty = params.get('quantity');
    setForm(f => ({
      ...f,
      linked_sales_order_id: so ?? f.linked_sales_order_id,
      linked_sales_order_line_id: soLine ?? f.linked_sales_order_line_id,
      product_id: prod ?? f.product_id,
      quantity: qty ? parseInt(qty, 10) || 1 : f.quantity,
    }));
  }, [params, isEdit]);

  const onLineSelect = (lineId: string) => {
    const l = soLines.find((x: any) => x.id === lineId);
    setForm(f => ({
      ...f,
      linked_sales_order_line_id: lineId,
      product_id: l?.product_id ?? f.product_id,
      quantity: l?.quantity ? Math.max(1, Math.round(Number(l.quantity))) : f.quantity,
    }));
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadReferenceImage(id ?? 'new', file);
      setForm(f => ({ ...f, reference_images: [...f.reference_images, url] }));
    } catch (e: any) {
      toast.error(e?.message ?? 'Upload failed. Create the manufacturing-references bucket?');
    } finally {
      setUploading(false);
    }
  };

  const save = async (submit: boolean) => {
    if (!form.product_id) { toast.error('Please choose a product'); return; }
    try {
      let woId = id;
      const payload = {
        product_id: form.product_id,
        quantity: form.quantity,
        size_spec: form.size_spec || null,
        colour_polish_spec: form.colour_polish_spec || null,
        fabric_spec: form.fabric_spec || null,
        customization_notes: form.customization_notes || null,
        reference_images: form.reference_images,
        linked_sales_order_id: form.linked_sales_order_id,
        linked_sales_order_line_id: form.linked_sales_order_line_id,
        assigned_factory_incharge_id: form.assigned_factory_incharge_id,
        eta_date: form.eta_date || null,
        notes: form.notes || null,
      };
      if (isEdit && id) {
        await updateMut.mutateAsync({ id, input: payload });
      } else {
        const created = await createMut.mutateAsync(payload);
        woId = created.id;
      }
      if (submit && woId) await submitMut.mutateAsync(woId);
      toast.success(submit ? 'Submitted for approval' : 'Saved');
      navigate(woId ? `/manufacturing/work-orders/${woId}` : '/manufacturing/work-orders');
    } catch (e: any) {
      toast.error(e?.message ?? 'Save failed');
    }
  };

  return (
    <AppLayout title="Manufacturing" subtitle={isEdit ? 'Edit Work Order' : 'New Work Order'} moduleNav={MANUFACTURING_NAV}>
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/manufacturing/work-orders')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-semibold">{isEdit ? 'Edit Work Order' : 'New Work Order'}</h1>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Product & Quantity</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label>Linked Sales Order (optional)</Label>
              <Select value={form.linked_sales_order_id ?? '__none'} onValueChange={(v) => setForm(f => ({ ...f, linked_sales_order_id: v === '__none' ? null : v, linked_sales_order_line_id: null }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {(sos as any[]).map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.reference}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.linked_sales_order_id && (
              <div className="grid gap-2">
                <Label>SO Line</Label>
                <Select value={form.linked_sales_order_line_id ?? ''} onValueChange={onLineSelect}>
                  <SelectTrigger><SelectValue placeholder="Select line" /></SelectTrigger>
                  <SelectContent>
                    {(soLines as any[]).map(l => (
                      <SelectItem key={l.id} value={l.id}>{l.product_name} × {l.quantity} ({l.product_source})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Product *</Label>
                <Select value={form.product_id} onValueChange={(v) => setForm(f => ({ ...f, product_id: v }))} disabled={!!form.linked_sales_order_line_id}>
                  <SelectTrigger><SelectValue placeholder="Choose product" /></SelectTrigger>
                  <SelectContent>
                    {products.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Quantity *</Label>
                <Input type="number" min={1} value={form.quantity}
                       onChange={e => setForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))}
                       disabled={!!form.linked_sales_order_line_id} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Specifications</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Size</Label>
                <Input value={form.size_spec} onChange={e => setForm(f => ({ ...f, size_spec: e.target.value }))} /></div>
              <div className="grid gap-2"><Label>Colour / Polish</Label>
                <Input value={form.colour_polish_spec} onChange={e => setForm(f => ({ ...f, colour_polish_spec: e.target.value }))} /></div>
              <div className="grid gap-2"><Label>Fabric</Label>
                <Input value={form.fabric_spec} onChange={e => setForm(f => ({ ...f, fabric_spec: e.target.value }))} /></div>
            </div>
            <div className="grid gap-2">
              <Label>Customization Notes</Label>
              <Textarea value={form.customization_notes} onChange={e => setForm(f => ({ ...f, customization_notes: e.target.value }))} rows={3} />
            </div>
            <div className="grid gap-2">
              <Label>Reference Images</Label>
              <div className="flex flex-wrap gap-2">
                {form.reference_images.map((url, i) => (
                  <div key={i} className="relative w-24 h-24 border rounded overflow-hidden">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <button type="button" className="absolute top-0 right-0 bg-black/60 text-white p-1 rounded-bl"
                            onClick={() => setForm(f => ({ ...f, reference_images: f.reference_images.filter((_, idx) => idx !== i) }))}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <label className="w-24 h-24 border-2 border-dashed rounded flex flex-col items-center justify-center cursor-pointer text-xs text-muted-foreground hover:bg-muted/40">
                  <Upload className="h-4 w-4 mb-1" />
                  {uploading ? 'Uploading…' : 'Upload'}
                  <input type="file" accept="image/*" className="hidden"
                         onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} />
                </label>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Schedule & Assignment</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>ETA Date</Label>
                <Input type="date" value={form.eta_date} onChange={e => setForm(f => ({ ...f, eta_date: e.target.value }))} /></div>
              <div className="grid gap-2">
                <Label>Assigned Factory Incharge</Label>
                <Select value={form.assigned_factory_incharge_id ?? '__none'} onValueChange={(v) => setForm(f => ({ ...f, assigned_factory_incharge_id: v === '__none' ? null : v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Unassigned</SelectItem>
                    {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate('/manufacturing/work-orders')}>Cancel</Button>
          <Button variant="secondary" onClick={() => save(false)} disabled={createMut.isPending || updateMut.isPending}>
            Save as Draft
          </Button>
          <Button onClick={() => save(true)} disabled={createMut.isPending || updateMut.isPending || submitMut.isPending}>
            Submit for Approval
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}