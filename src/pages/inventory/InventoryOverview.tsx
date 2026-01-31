import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/dashboard/StatCard';
import { SimpleBarChart } from '@/components/dashboard/SimpleBarChart';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, ChevronLeft, ChevronRight, Settings, MoreVertical } from 'lucide-react';

const INVENTORY_NAV = [
  { label: 'Overview', href: '/inventory' },
  { label: 'Operations', href: '/inventory/operations' },
  { label: 'Products', href: '/inventory/products' },
  { label: 'Reporting', href: '/inventory/reporting' },
  { label: 'Configuration', href: '/inventory/configuration' },
];

const DASHBOARD_CARDS = [
  {
    title: 'NEW ITEMS RECEIVED',
    badge: { label: 'To Receive', count: 4, variant: 'default' as const },
    stats: [
      { label: 'Late', value: 2, type: 'late' as const },
      { label: 'Back Orders', value: 1, type: 'backorder' as const },
      { label: 'Operations', value: 7 },
    ],
    chartData: [
      { value: 40, color: 'coral' as const },
      { value: 45, color: 'coral' as const },
      { value: 35, color: 'coral' as const },
      { value: 80, color: 'orange' as const },
    ],
  },
  {
    title: 'ITEM - ESTIMATE',
    badge: { label: 'Open', count: 1, variant: 'default' as const },
    stats: [
      { label: 'Waiting', value: 36 },
      { label: 'Late', value: 8, type: 'late' as const },
      { label: 'Back Orders', value: 4, type: 'backorder' as const },
    ],
    chartData: [
      { value: 60, color: 'coral' as const },
      { value: 10, color: 'orange' as const },
      { value: 15, color: 'teal' as const },
      { value: 90, color: 'teal' as const },
    ],
  },
  {
    title: 'DELIVERY NOTE',
    badge: { label: 'Open', count: 1, variant: 'default' as const },
    stats: [
      { label: 'Waiting', value: 1 },
    ],
    chartData: [
      { value: 70, color: 'teal' as const },
      { value: 50, color: 'teal' as const },
    ],
  },
  {
    title: 'ORDERS',
    badge: { label: 'To Receive', count: 44, variant: 'default' as const },
    stats: [
      { label: 'Late', value: 14, type: 'late' as const },
      { label: 'Operations', value: 92 },
    ],
    chartData: [
      { value: 30, color: 'coral' as const },
      { value: 20, color: 'orange' as const },
      { value: 40, color: 'orange' as const },
      { value: 100, color: 'teal' as const },
    ],
  },
  {
    title: 'RETURNS',
    badge: { label: 'Open', count: 1, variant: 'default' as const },
    stats: [],
    chartData: [],
  },
  {
    title: 'KADRI - ITEM ESTIMATE',
    badge: { label: 'Open', count: 1, variant: 'default' as const },
    stats: [],
    chartData: [],
  },
];

export default function InventoryOverview() {
  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="p-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-medium text-foreground">Inventory Overview</h1>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Settings className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search..." className="pl-9" />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>1-7 / 7</span>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {DASHBOARD_CARDS.map((card, index) => (
            <div
              key={card.title}
              className="animate-slide-up"
              style={{ animationDelay: `${index * 75}ms` }}
            >
              <div className="bg-card rounded-lg border border-border p-4 h-full flex flex-col relative">
                {/* Colored left border */}
                <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg bg-destructive" />
                
                {/* Header with menu */}
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-sm font-semibold text-primary uppercase tracking-wide pl-2">
                    {card.title}
                  </h3>
                  <Button variant="ghost" size="icon" className="h-6 w-6 -mr-2 -mt-1">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </div>

                {/* Content */}
                <div className="flex items-start gap-4 pl-2 flex-1">
                  {/* Badge */}
                  <Badge className="bg-primary text-primary-foreground">
                    {card.badge.count} {card.badge.label}
                  </Badge>

                  {/* Stats */}
                  {card.stats.length > 0 && (
                    <div className="text-sm space-y-0.5">
                      {card.stats.map((stat) => (
                        <div key={stat.label} className="flex justify-between gap-3">
                          <span className={
                            stat.type === 'late' 
                              ? 'text-destructive' 
                              : stat.type === 'backorder' 
                              ? 'text-warning'
                              : 'text-muted-foreground'
                          }>
                            {stat.label}
                          </span>
                          <span className="font-medium text-foreground">{stat.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Chart */}
                {card.chartData.length > 0 && (
                  <div className="mt-4 pl-2">
                    <SimpleBarChart data={card.chartData} height={80} />
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* GLF Factory card (empty/placeholder) */}
          <div className="animate-slide-up" style={{ animationDelay: '450ms' }}>
            <div className="bg-card rounded-lg border border-border p-4 h-full relative">
              <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg bg-primary" />
              <h3 className="text-sm font-semibold text-primary uppercase tracking-wide pl-2">
                GLF FACTORY
              </h3>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
