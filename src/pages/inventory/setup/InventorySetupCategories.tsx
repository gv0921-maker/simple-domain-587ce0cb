import { AppLayout } from '@/components/layout/AppLayout';
import { INVENTORY_NAV } from '@/lib/navigation';
import { CategoriesConfig } from '@/components/inventory/config/CategoriesConfig';

export default function InventorySetupCategories() {
  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Product Categories</h1>
          <p className="text-muted-foreground">Organize products into hierarchical categories</p>
        </div>
        <CategoriesConfig />
      </div>
    </AppLayout>
  );
}