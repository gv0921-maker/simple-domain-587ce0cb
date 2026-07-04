import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Warehouse,
  Package,
  ArrowLeftRight,
  BarChart3,
  PackageCheck,
  Truck,
  ClipboardCheck,
  ClipboardList,
  AlertTriangle,
  Repeat,
  Plus,
} from 'lucide-react';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useInventoryOverview } from '@/hooks/inventory/useInventoryOverview';

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

export default function InventoryOverview() {
  const navigate = useNavigate();
  const { data, isLoading } = useInventoryOverview();

  const kpis = [
    {
      label: 'Total Products',
      value: data?.totalProducts ?? 0,
      icon: Package,
      tone: 'primary',
      href: '/inventory/products',
    },
    {
      label: 'Warehouses',
      value: data?.activeWarehouses ?? 0,
      icon: Warehouse,
      tone: 'info',
      href: '/inventory/warehouses',
    },
    {
      label: 'Pending Transfers',
      value: data?.pendingTransfers ?? 0,
      icon: ArrowLeftRight,
      tone: 'warning',
      href: '/inventory/operations',
    },
    {
      label: 'Stock Value',
      value: inr(data?.stockValue ?? 0),
      icon: BarChart3,
      tone: 'success',
      href: '/inventory/reporting',
    },
  ] as const;

  const toneClasses: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    info: 'bg-info/10 text-info',
    warning: 'bg-warning/10 text-warning',
    success: 'bg-success/10 text-success',
  };

  const opCards = data
    ? [
        {
          title: 'Goods Receipts',
          icon: PackageCheck,
          href: '/inventory/goods-receipts',
          primary: { label: 'To Receive', count: data.goodsReceipts.draft + data.goodsReceipts.pending },
          rows: [
            { label: 'Draft', value: data.goodsReceipts.draft },
            { label: 'In Progress', value: data.goodsReceipts.pending },
            { label: 'Completed', value: data.goodsReceipts.completed },
          ],
          empty: {
            message: 'No stock received yet',
            cta: 'Create a Goods Receipt',
            href: '/inventory/goods-receipts',
          },
          isEmpty: data.goodsReceipts.total === 0,
        },
        {
          title: 'Correction Orders',
          icon: ClipboardCheck,
          href: '/inventory/correction-orders',
          primary: { label: 'Open', count: data.correctionOrders.open },
          rows: [],
          empty: {
            message: 'No correction orders',
            cta: 'View Correction Orders',
            href: '/inventory/correction-orders',
          },
          isEmpty: data.correctionOrders.open === 0,
        },
        {
          title: 'Delivery Notes',
          icon: Truck,
          href: '/inventory/delivery-notes',
          primary: { label: 'Waiting', count: data.deliveryNotes.waiting },
          rows: [
            { label: 'Delivered', value: data.deliveryNotes.delivered },
          ],
          empty: {
            message: 'No delivery notes yet',
            cta: 'View Delivery Notes',
            href: '/inventory/delivery-notes',
          },
          isEmpty: data.deliveryNotes.total === 0,
        },
        {
          title: 'Stock Counts',
          icon: ClipboardList,
          href: '/inventory/stock-counts',
          primary: { label: 'Pending', count: data.stockCounts.pending },
          rows: [],
          empty: {
            message: 'No stock counts pending',
            cta: 'Start a Stock Count',
            href: '/inventory/stock-counts',
          },
          isEmpty: data.stockCounts.pending === 0,
        },
        {
          title: 'Write-offs',
          icon: AlertTriangle,
          href: '/inventory/write-offs',
          primary: { label: 'Pending Approval', count: data.writeOffs.pending },
          rows: [],
          empty: {
            message: 'No pending write-offs',
            cta: 'View Write-offs',
            href: '/inventory/write-offs',
          },
          isEmpty: data.writeOffs.pending === 0,
        },
        {
          title: 'Internal Movements',
          icon: Repeat,
          href: '/inventory/internal-movements',
          primary: { label: 'Pending', count: data.internalMovements.pending },
          rows: [
            { label: 'Total', value: data.internalMovements.total },
          ],
          empty: {
            message: 'No internal movements',
            cta: 'Create Internal Movement',
            href: '/inventory/internal-movements',
          },
          isEmpty: data.internalMovements.total === 0,
        },
      ]
    : [];

  const showZeroProductsEmptyState = !isLoading && data?.totalProducts === 0;

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-medium text-foreground">Inventory Overview</h1>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {kpis.map((k, i) => {
            const Icon = k.icon;
            return (
              <div
                key={k.label}
                className="bg-card rounded-lg border border-border p-4 cursor-pointer hover:shadow-md transition-shadow animate-slide-up"
                style={{ animationDelay: `${i * 50}ms` }}
                onClick={() => navigate(k.href)}
              >
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${toneClasses[k.tone]}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    {isLoading ? (
                      <Skeleton className="h-7 w-16 mb-1" />
                    ) : (
                      <p className="text-2xl font-bold">{k.value}</p>
                    )}
                    <p className="text-sm text-muted-foreground">{k.label}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {showZeroProductsEmptyState && (
          <div className="bg-card rounded-lg border border-dashed border-border p-8 mb-6 text-center animate-fade-in">
            <Package className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h2 className="text-base font-semibold mb-1">No products yet</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Add your first product to start tracking stock across warehouses.
            </p>
            <Button onClick={() => navigate('/inventory/products')}>
              <Plus className="h-4 w-4 mr-2" />
              Add your first product
            </Button>
          </div>
        )}

        {/* Operational summary */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {opCards.map((card, index) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="animate-slide-up cursor-pointer"
                  style={{ animationDelay: `${(index + 4) * 60}ms` }}
                  onClick={() => navigate(card.href)}
                >
                  <div className="bg-card rounded-lg border border-border p-4 h-full flex flex-col hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-semibold text-primary uppercase tracking-wide">
                          {card.title}
                        </h3>
                      </div>
                    </div>

                    {card.isEmpty ? (
                      <div className="flex-1 flex flex-col items-start justify-center text-sm text-muted-foreground">
                        <p className="mb-2">{card.empty.message}</p>
                        <Button
                          variant="link"
                          className="h-auto p-0 text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(card.empty.href);
                          }}
                        >
                          {card.empty.cta} →
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-start gap-4 flex-1">
                        <Badge className="bg-primary text-primary-foreground">
                          {card.primary.count} {card.primary.label}
                        </Badge>
                        {card.rows.length > 0 && (
                          <div className="text-sm space-y-0.5 flex-1">
                            {card.rows.map((row) => (
                              <div key={row.label} className="flex justify-between gap-3">
                                <span className="text-muted-foreground">{row.label}</span>
                                <span className="font-medium text-foreground">{row.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}