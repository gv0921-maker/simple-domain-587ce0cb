import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { UnitsConfig } from '@/components/inventory/config/UnitsConfig';

export default function InventorySetupUnits() {
  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Units &amp; Packagings</h1>
          <p className="text-muted-foreground">Manage units of measure and their conversion ratios</p>
        </div>
        <UnitsConfig />
      </div>
    </AppLayout>
  );
}