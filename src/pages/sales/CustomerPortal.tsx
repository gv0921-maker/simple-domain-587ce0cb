import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, ShoppingCart, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO } from 'date-fns';

// NOTE: Portal access uses a per-customer `portal_token` stored on
// public.customers. Data is fetched through SECURITY DEFINER RPCs
// (portal_list_quotations / portal_list_sales_orders) so unauthenticated
// customers can read only their own records. Anyone with a valid token can
// view those records — treat tokens like bearer secrets and rotate from the
// Customer form when needed.

export default function CustomerPortal() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const quotationsQ = useQuery({
    queryKey: ['portal', 'quotations', token],
    enabled: !!token,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('portal_list_quotations' as any, { _token: token });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });
  const ordersQ = useQuery({
    queryKey: ['portal', 'orders', token],
    enabled: !!token,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('portal_list_sales_orders' as any, { _token: token });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const quotations = quotationsQ.data ?? [];
  const orders = ordersQ.data ?? [];
  const loading = quotationsQ.isLoading || ordersQ.isLoading;
  const tokenInvalid = !!token && !loading && quotations.length === 0 && orders.length === 0
    && (quotationsQ.isError || ordersQ.isError);

  if (!token || tokenInvalid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">Invalid or expired portal link.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const customerName = quotations[0]?.customer_name || orders[0]?.customer_name || 'Customer';

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Customer Portal</h1>
          <p className="text-muted-foreground">Welcome, {customerName}</p>
        </div>

        {/* Quotations */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> Quotations
            </CardTitle>
          </CardHeader>
          <CardContent>
            {quotations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No quotations available.</p>
            ) : (
              <div className="space-y-2">
                {quotations.map((q: any) => (
                  <div
                    key={q.id}
                    className="flex items-center justify-between p-3 border rounded-md hover:bg-muted/50 cursor-pointer"
                    onClick={() => navigate(`/portal/quotation/${q.id}?token=${token}`)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-sm">{q.reference}</span>
                      <Badge variant="outline" className="capitalize text-xs">{q.status}</Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-sm">₹{Number(q.total ?? 0).toLocaleString('en-IN')}</span>
                      <span className="text-xs text-muted-foreground">{format(parseISO(q.date), 'MMM d, yyyy')}</span>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Orders */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="h-4 w-4" /> Sales Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders available.</p>
            ) : (
              <div className="space-y-2">
                {orders.map((o: any) => (
                  <div key={o.id} className="flex items-center justify-between p-3 border rounded-md">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-sm">{o.reference}</span>
                      <Badge variant="outline" className="capitalize text-xs">{o.status}</Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-sm">₹{Number(o.total ?? 0).toLocaleString('en-IN')}</span>
                      <span className="text-xs text-muted-foreground">{format(parseISO(o.order_date), 'MMM d, yyyy')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}