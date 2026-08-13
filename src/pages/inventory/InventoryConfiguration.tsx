import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/ui/card';
import { INVENTORY_NAV } from '@/lib/navigation';
// Tag, Ruler, Package and ArrowLeftRight went with the four config tiles.
import { Warehouse, MapPin, RefreshCw, Sliders } from 'lucide-react';

/**
 * Configuration is owned by Inventory 2 — see INVENTORY2_NAV → Setup.
 *
 * The four /inventory/setup/* tiles that used to sit here (Operation Types,
 * Product Categories, Product Attributes, Units & Packagings) are gone. They
 * pointed at the LEGACY shadcn editors, which write the very same tables as the
 * design-system editors now at /inventory2/config/*. Two live editors on one
 * set of tables is a real hazard — the two disagree about defaults, and the
 * legacy attribute editor in particular must never grow the variant features
 * being added to its replacement.
 *
 * Rule 4: the routes and files stay. /inventory/setup/attributes and its three
 * siblings are still mounted and still reachable by direct URL; only the links
 * are withdrawn. They get archived under src/_archive/ at module sign-off, not
 * before.
 *
 * Warehouses and Locations keep pointing at the legacy list pages, which are
 * separate from the config editors and are not part of this move.
 */
const SETUP_LINKS = [
  { group: 'Warehouse Management', items: [
    { label: 'Warehouses', href: '/inventory/warehouses', icon: Warehouse },
    { label: 'Locations', href: '/inventory/locations', icon: MapPin },
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
