import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PackageCheck,
  Truck,
  ClipboardCheck,
  ClipboardList,
  AlertTriangle,
  Repeat,
  BarChart3,
  ShieldCheck,
  Boxes,
  ChevronRight,
  Plus,
  Package,
} from 'lucide-react';
import { INVENTORY_NAV } from '@/lib/navigation';
import { useInventoryOverview } from '@/hooks/inventory/useInventoryOverview';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';

export default function InventoryOverview() {
  const navigate = useNavigate();
  const { data, isLoading } = useInventoryOverview();
  const { isAdmin } = useIsSuperAdmin();

  const gr = data?.goodsReceipts;
  const ito = data?.pendingTransfers ?? 0;
  const dn = data?.deliveryNotes;
  const co = data?.correctionOrders;
  const sc = data?.stockCounts;
  const wo = data?.writeOffs;

  interface OpCard {
    key: string;
    title: string;
    icon: any;
    count: number;
    hint: string;
    href: string;
    subtle?: string;
    admin?: boolean;
  }

  const opCards: OpCard[] = [
    {
      key: 'gr',
      title: 'Goods Receipts',
      icon: PackageCheck,
      count: (gr?.draft ?? 0) + (gr?.pending ?? 0),
      hint: 'to process',
      href: '/inventory/goods-receipts',
      subtle: gr ? `${gr.completed} completed` : undefined,
    },
    {
      key: 'ito',
      title: 'Internal Transfers',
      icon: Repeat,
      count: ito,
      hint: 'in transit / scanning',
      href: '/inventory/operations',
    },
    {
      key: 'dn',
      title: 'Deliveries',
      icon: Truck,
      count: dn?.waiting ?? 0,
      hint: 'waiting for handoff',
      href: '/inventory/delivery-notes',
      subtle: dn ? `${dn.delivered} delivered` : undefined,
    },
    {
      key: 'co',
      title: 'Corrections',
      icon: ClipboardCheck,
      count: co?.open ?? 0,
      hint: 'open with vendor',
      href: '/inventory/correction-orders',
    },
    {
      key: 'sc',
      title: 'Stock Counts',
      icon: ClipboardList,
      count: sc?.pending ?? 0,
      hint: 'in progress',
      href: '/inventory/stock-counts',
    },
    {
      key: 'wo',
      title: 'Write-offs',
      icon: AlertTriangle,
      count: wo?.pending ?? 0,
      hint: 'awaiting approval',
      href: '/inventory/write-offs',
      admin: true,
    },
  ];

  const visibleOpCards = opCards.filter((c) => !c.admin || isAdmin);

  const utilityTiles: OpCard[] = [
    {
      key: 'stock',
      title: 'Stock On-Hand',
      icon: Boxes,
      count: data?.totalProducts ?? 0,
      hint: 'products across warehouses',
      href: '/inventory/stock-dashboard',
    },
    {
      key: 'reports',
      title: 'Reports',
      icon: BarChart3,
      count: 0,
      hint: 'inventory analytics',
      href: '/inventory/reporting',
    },
    {
      key: 'health',
      title: 'Data Health',
      icon: ShieldCheck,
      count: 0,
      hint: 'reconciliation checks',
      href: '/admin/data-health',
      admin: true,
    },
  ];

  const visibleUtility = utilityTiles.filter((c) => !c.admin || isAdmin);

  const showEmpty = !isLoading && (data?.totalProducts ?? 0) === 0;

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-lg sm:text-xl font-semibold text-foreground">Inventory Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            What needs your attention today
          </p>
        </div>

        {showEmpty && (
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

        <section aria-label="Operations">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Operations
          </h2>
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {visibleOpCards.map((card, i) => {
                const Icon = card.icon;
                const empty = card.count === 0;
                return (
                  <button
                    key={card.key}
                    onClick={() => navigate(card.href)}
                    className="text-left bg-card rounded-lg border border-border p-4 hover:shadow-md hover:border-primary/40 transition-all animate-slide-up min-h-[112px] flex flex-col justify-between focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="font-semibold text-sm text-foreground">{card.title}</div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                    <div className="mt-3">
                      {empty ? (
                        <div className="text-sm text-muted-foreground">Nothing pending</div>
                      ) : (
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold text-foreground leading-none">
                            {card.count}
                          </span>
                          <span className="text-sm text-muted-foreground">{card.hint}</span>
                        </div>
                      )}
                      {card.subtle && !empty && (
                        <div className="text-xs text-muted-foreground mt-1">{card.subtle}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section aria-label="Stock & Insights" className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Stock &amp; Insights
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {visibleUtility.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.key}
                  onClick={() => navigate(card.href)}
                  className="text-left bg-card rounded-lg border border-border p-4 hover:shadow-md hover:border-primary/40 transition-all min-h-[88px] flex items-center justify-between gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-md bg-muted text-foreground flex items-center justify-center">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-foreground">{card.title}</div>
                      <div className="text-xs text-muted-foreground">{card.hint}</div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}


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