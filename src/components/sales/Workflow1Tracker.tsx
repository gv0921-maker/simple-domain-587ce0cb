import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle, Clock, ArrowRight, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useITOsForSO } from '@/hooks/inventory/internalTransfers';
import { useCanCreateDeliveryForSO } from '@/hooks/inventory/workflow1';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  salesOrderId: string;
  salesOrderStatus: string;
}

type StepState = 'done' | 'current' | 'upcoming';

interface Step {
  key: string;
  label: string;
  state: StepState;
  hint?: string;
  onClick?: () => void;
}

function useDeliveryNotesForSO(salesOrderId: string) {
  return useQuery({
    queryKey: ['workflow1', 'dns', salesOrderId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('delivery_notes')
        .select('id, reference, status')
        .eq('sales_order_id', salesOrderId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; reference: string; status: string }>;
    },
  });
}

function StateIcon({ state }: { state: StepState }) {
  if (state === 'done') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (state === 'current') return <Clock className="h-4 w-4 text-primary" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

export function Workflow1Tracker({ salesOrderId, salesOrderStatus }: Props) {
  const navigate = useNavigate();
  const { data: itos = [] } = useITOsForSO(salesOrderId);
  const { data: dns = [] } = useDeliveryNotesForSO(salesOrderId);
  const { data: gate } = useCanCreateDeliveryForSO(salesOrderId);

  const activeIto = itos.find(i => i.status !== 'cancelled');
  const itoDone = !!activeIto && activeIto.status === 'completed';
  const itoInProgress = !!activeIto && !itoDone;

  const paid = !!gate?.allowed;
  const anyDn = dns.length > 0;
  const dnDelivered = anyDn && dns.every(d => d.status === 'delivered');
  const anyDnInProgress = anyDn && !dnDelivered;

  const soConfirmed =
    salesOrderStatus !== 'draft' &&
    salesOrderStatus !== 'awaiting_advance' &&
    salesOrderStatus !== 'estimate';

  const steps: Step[] = [
    {
      key: 'confirmed',
      label: 'SO Confirmed',
      state: soConfirmed ? 'done' : 'current',
    },
    {
      key: 'ito',
      label: itoDone ? 'ITO — in transit' : 'ITO (pick + QC)',
      state: itoDone ? 'done' : itoInProgress ? 'current' : soConfirmed ? 'current' : 'upcoming',
      hint: activeIto?.ito_number,
      onClick: activeIto ? () => navigate(`/inventory/ito/${activeIto.id}`) : undefined,
    },
    {
      key: 'packed',
      label: 'Packed',
      state: itoDone ? (paid || anyDn ? 'done' : 'current') : 'upcoming',
    },
    {
      key: 'paid',
      label: 'Invoice Paid',
      state: paid ? 'done' : itoDone ? 'current' : 'upcoming',
      hint: gate && !paid
        ? `₹${gate.paidAmount.toLocaleString('en-IN')} of ₹${gate.totalAmount.toLocaleString('en-IN')}`
        : undefined,
    },
    {
      key: 'delivery',
      label: dnDelivered ? 'Delivered' : 'Delivery (scan + QC)',
      state: dnDelivered ? 'done' : anyDnInProgress ? 'current' : paid ? 'current' : 'upcoming',
      hint: dns[0]?.reference,
      onClick: dns[0] ? () => navigate(`/inventory/delivery-notes/${dns[0].id}`) : undefined,
    },
    {
      key: 'closed',
      label: 'Closed',
      state: dnDelivered && salesOrderStatus === 'delivered' ? 'done' : 'upcoming',
    },
  ];

  return (
    <Card className="max-w-4xl mx-auto w-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Truck className="h-4 w-4" /> Fulfillment Workflow
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-wrap items-stretch gap-2">
          {steps.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              <button
                type="button"
                onClick={s.onClick}
                disabled={!s.onClick}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-left',
                  s.state === 'done' && 'border-emerald-200 bg-emerald-50',
                  s.state === 'current' && 'border-primary/40 bg-primary/5',
                  s.state === 'upcoming' && 'border-muted bg-muted/30 text-muted-foreground',
                  s.onClick && 'hover:bg-accent cursor-pointer',
                  !s.onClick && 'cursor-default',
                )}
              >
                <StateIcon state={s.state} />
                <div>
                  <div className="font-medium leading-tight">{s.label}</div>
                  {s.hint && (
                    <div className="text-xs text-muted-foreground leading-tight">{s.hint}</div>
                  )}
                </div>
                {s.state === 'current' && (
                  <Badge variant="secondary" className="ml-1 text-[10px]">now</Badge>
                )}
              </button>
              {i < steps.length - 1 && (
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export default Workflow1Tracker;