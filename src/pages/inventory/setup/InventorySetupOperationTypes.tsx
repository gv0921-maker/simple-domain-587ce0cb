import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { OperationTypesConfig } from '@/components/inventory/config/OperationTypesConfig';

export default function InventorySetupOperationTypes() {
  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Operation Types</h1>
          <p className="text-muted-foreground">Configure warehouse operations like receipts, deliveries and internal transfers</p>
        </div>
        <OperationTypesConfig />
      </div>
    </AppLayout>
  );
}