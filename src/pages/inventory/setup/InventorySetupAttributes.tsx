import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { AttributesConfig } from '@/components/inventory/config/AttributesConfig';

export default function InventorySetupAttributes() {
  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Product Attributes</h1>
          <p className="text-muted-foreground">Define global attributes like Size, Colour, Fabric and Polish</p>
        </div>
        <AttributesConfig />
      </div>
    </AppLayout>
  );
}