import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/ui/card';
import { INVENTORY_NAV } from '@/lib/navigation';
import { Tag, Ruler, Package as PackageIcon, ArrowLeftRight, Warehouse, MapPin, RefreshCw, Sliders } from 'lucide-react';

const SETUP_LINKS = [
  { group: 'Warehouse Management', items: [
    { label: 'Warehouses', href: '/inventory/warehouses', icon: Warehouse },
    { label: 'Locations', href: '/inventory/locations', icon: MapPin },
    { label: 'Operation Types', href: '/inventory/setup/operation-types', icon: ArrowLeftRight },
  ]},
  { group: 'Products', items: [
    { label: 'Product Categories', href: '/inventory/setup/categories', icon: Tag },
    { label: 'Product Attributes', href: '/inventory/setup/attributes', icon: PackageIcon },
    { label: 'Units & Packagings', href: '/inventory/setup/units', icon: Ruler },
  ]},
  { group: 'Replenishment', items: [
    { label: 'Reorder Rules', href: '/inventory/reorder-rules', icon: RefreshCw },
    { label: 'Adjustments', href: '/inventory/adjustments', icon: Sliders },
  ]},
];

export default function InventoryConfiguration() {
  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Inventory Settings</h1>
          <p className="text-muted-foreground">Configure inventory master data and operational settings</p>
        </div>

        <div className="space-y-8">
          {SETUP_LINKS.map((section) => (
            <div key={section.group} className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.group}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {section.items.map((it) => {
                  const Icon = it.icon;
                  return (
                    <Link key={it.href} to={it.href}>
                      <Card className="p-4 hover:border-primary/40 transition-colors flex items-center gap-3">
                        <Icon className="h-5 w-5 text-primary" />
                        <span className="font-medium">{it.label}</span>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
