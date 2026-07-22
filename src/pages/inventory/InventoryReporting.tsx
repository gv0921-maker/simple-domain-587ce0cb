import { useState, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Download,
  TrendingUp,
  Package,
  AlertTriangle,
  DollarSign,
  FileText,
} from 'lucide-react';
import { useProducts, useWarehouses } from '@/hooks/inventory';
import type { Product } from '@/lib/services/inventory';
import { INVENTORY_NAV } from '@/lib/navigation';
import { cn } from '@/lib/utils';

export default function InventoryReporting() {
  const { data: products = [] } = useProducts();
  const { data: warehouses = [] } = useWarehouses();
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('all');
  const [dateRange, setDateRange] = useState<string>('30');

  const stats = useMemo(() => {
    const totalValue = products.reduce((sum, p) => sum + p.stockOnHand * p.costPrice, 0);
    const potentialValue = products.reduce((sum, p) => sum + p.stockOnHand * p.salePrice, 0);
    const lowStock = products.filter((p) => p.stockOnHand <= p.reorderLevel).length;
    const outOfStock = products.filter((p) => p.stockOnHand === 0).length;
    const overStock = products.filter((p) => p.stockOnHand > p.reorderLevel * 3).length;

    return {
      totalValue,
      potentialValue,
      potentialProfit: potentialValue - totalValue,
      totalProducts: products.length,
      lowStock,
      outOfStock,
      overStock,
      healthyStock: products.length - lowStock - outOfStock - overStock,
    };
  }, [products]);

  const categoryBreakdown = useMemo(() => {
    const breakdown: Record<string, { count: number; value: number; quantity: number }> = {};
    products.forEach((p) => {
      if (!breakdown[p.category]) {
        breakdown[p.category] = { count: 0, value: 0, quantity: 0 };
      }
      breakdown[p.category].count++;
      breakdown[p.category].value += p.stockOnHand * p.costPrice;
      breakdown[p.category].quantity += p.stockOnHand;
    });
    return Object.entries(breakdown).map(([category, data]) => ({
      category,
      ...data,
    }));
  }, [products]);

  const stockAlerts = useMemo(() => {
    return products
      .filter((p) => p.stockOnHand <= p.reorderLevel)
      .map((p) => ({
        ...p,
        status: p.stockOnHand === 0 ? 'out' : 'low',
        deficit: p.reorderLevel - p.stockOnHand,
      }))
      .sort((a, b) => a.stockOnHand - b.stockOnHand);
  }, [products]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <AppLayout title="Inventory" moduleNav={INVENTORY_NAV}>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Inventory Reports</h1>
            <p className="text-muted-foreground">Stock valuation, alerts, and analytics</p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Warehouses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Warehouses</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">This year</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="animate-slide-up" style={{ animationDelay: '0ms' }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Total Stock Value
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(stats.totalValue)}</div>
              <p className="text-sm text-muted-foreground">{stats.totalProducts} products</p>
            </CardContent>
          </Card>
          <Card className="animate-slide-up" style={{ animationDelay: '50ms' }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-success" />
                Potential Value
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-success">{formatCurrency(stats.potentialValue)}</div>
              <p className="text-sm text-muted-foreground">
                +{formatCurrency(stats.potentialProfit)} profit
              </p>
            </CardContent>
          </Card>
          <Card className="animate-slide-up" style={{ animationDelay: '100ms' }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Low Stock Items
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-warning">{stats.lowStock}</div>
              <p className="text-sm text-muted-foreground">{stats.outOfStock} out of stock</p>
            </CardContent>
          </Card>
          <Card className="animate-slide-up" style={{ animationDelay: '150ms' }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Package className="h-4 w-4" />
                Stock Health
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{Math.round((stats.healthyStock / stats.totalProducts) * 100)}%</div>
              <Progress value={(stats.healthyStock / stats.totalProducts) * 100} className="mt-2" />
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="valuation" className="space-y-6">
          <TabsList>
            <TabsTrigger value="valuation" className="gap-2">
              <DollarSign className="h-4 w-4" />
              Stock Valuation
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-2">
              <AlertTriangle className="h-4 w-4" />
              Stock Alerts
            </TabsTrigger>
            <TabsTrigger value="category" className="gap-2">
              <FileText className="h-4 w-4" />
              By Category
            </TabsTrigger>
          </TabsList>

          {/* Stock Valuation Tab */}
          <TabsContent value="valuation" className="space-y-4 animate-fade-in">
            <Card>
              <CardHeader>
                <CardTitle>Stock Valuation by Product</CardTitle>
                <CardDescription>Current inventory value breakdown</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Cost Price</TableHead>
                      <TableHead className="text-right">Sale Price</TableHead>
                      <TableHead className="text-right">Stock Value</TableHead>
                      <TableHead className="text-right">Potential Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell className="font-medium">{product.name}</TableCell>
                        <TableCell className="text-muted-foreground">{product.sku}</TableCell>
                        <TableCell className="text-right">{product.stockOnHand}</TableCell>
                        <TableCell className="text-right">{formatCurrency(product.costPrice)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(product.salePrice)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(product.stockOnHand * product.costPrice)}
                        </TableCell>
                        <TableCell className="text-right text-success font-medium">
                          {formatCurrency(product.stockOnHand * product.salePrice)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell colSpan={5}>Total</TableCell>
                      <TableCell className="text-right">{formatCurrency(stats.totalValue)}</TableCell>
                      <TableCell className="text-right text-success">{formatCurrency(stats.potentialValue)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Stock Alerts Tab */}
          <TabsContent value="alerts" className="space-y-4 animate-fade-in">
            <Card>
              <CardHeader>
                <CardTitle>Stock Alerts</CardTitle>
                <CardDescription>Products requiring attention</CardDescription>
              </CardHeader>
              <CardContent>
                {stockAlerts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No stock alerts - all products are well stocked!</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-right">Current Stock</TableHead>
                        <TableHead className="text-right">Reorder Level</TableHead>
                        <TableHead className="text-right">Deficit</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockAlerts.map((product) => (
                        <TableRow key={product.id}>
                          <TableCell>
                            <Badge
                              className={cn(
                                product.status === 'out'
                                  ? 'bg-destructive/20 text-destructive border-destructive'
                                  : 'bg-warning/20 text-warning-foreground border-warning'
                              )}
                            >
                              {product.status === 'out' ? 'Out of Stock' : 'Low Stock'}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{product.name}</TableCell>
                          <TableCell className="text-muted-foreground">{product.sku}</TableCell>
                          <TableCell className="text-right font-bold text-destructive">
                            {product.stockOnHand}
                          </TableCell>
                          <TableCell className="text-right">{product.reorderLevel}</TableCell>
                          <TableCell className="text-right text-destructive">
                            -{product.deficit}
                          </TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline">
                              Create PO
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Category Breakdown Tab */}
          <TabsContent value="category" className="space-y-4 animate-fade-in">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Category Breakdown</CardTitle>
                  <CardDescription>Stock distribution by category</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Products</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categoryBreakdown.map((cat) => (
                        <TableRow key={cat.category}>
                          <TableCell className="font-medium">{cat.category}</TableCell>
                          <TableCell className="text-right">{cat.count}</TableCell>
                          <TableCell className="text-right">{cat.quantity}</TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(cat.value)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Value Distribution</CardTitle>
                  <CardDescription>Stock value by category</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {categoryBreakdown.map((cat, index) => {
                    const percentage = (cat.value / stats.totalValue) * 100;
                    return (
                      <div key={cat.category} className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{cat.category}</span>
                          <span className="text-muted-foreground">
                            {formatCurrency(cat.value)} ({percentage.toFixed(1)}%)
                          </span>
                        </div>
                        <Progress value={percentage} className="h-2" />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
