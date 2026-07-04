import { AppLayout } from '@/components/layout/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tag, Ruler, Package as PackageIcon, ArrowLeftRight } from 'lucide-react';
import { INVENTORY_NAV } from '@/lib/navigation';
import { CategoriesConfig } from '@/components/inventory/config/CategoriesConfig';
import { AttributesConfig } from '@/components/inventory/config/AttributesConfig';
import { UnitsConfig } from '@/components/inventory/config/UnitsConfig';
import { OperationTypesConfig } from '@/components/inventory/config/OperationTypesConfig';

export default function InventoryConfiguration() {
  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Inventory Configuration</h1>
          <p className="text-muted-foreground">Manage categories, attributes, units, and operation types</p>
        </div>

        <Tabs defaultValue="categories" className="space-y-6">
          <TabsList>
            <TabsTrigger value="categories" className="gap-2"><Tag className="h-4 w-4" />Product Categories</TabsTrigger>
            <TabsTrigger value="attributes" className="gap-2"><PackageIcon className="h-4 w-4" />Product Attributes</TabsTrigger>
            <TabsTrigger value="units" className="gap-2"><Ruler className="h-4 w-4" />Units &amp; Packagings</TabsTrigger>
            <TabsTrigger value="operations" className="gap-2"><ArrowLeftRight className="h-4 w-4" />Operation Types</TabsTrigger>
          </TabsList>

          <TabsContent value="categories" className="animate-fade-in"><CategoriesConfig /></TabsContent>
          <TabsContent value="attributes" className="animate-fade-in"><AttributesConfig /></TabsContent>
          <TabsContent value="units" className="animate-fade-in"><UnitsConfig /></TabsContent>
          <TabsContent value="operations" className="animate-fade-in"><OperationTypesConfig /></TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
