import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ACCOUNTING_NAV } from '@/lib/navigation/accounting';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getAccounts, type Account } from '@/lib/services/accounting';
import { Plus, Search, Edit, Wallet, TrendingUp, TrendingDown, Building2, DollarSign } from 'lucide-react';

const typeIcons: Record<string, React.ReactNode> = {
  asset: <Wallet className="h-4 w-4 text-info" />,
  liability: <Building2 className="h-4 w-4 text-warning" />,
  equity: <DollarSign className="h-4 w-4 text-primary" />,
  revenue: <TrendingUp className="h-4 w-4 text-success" />,
  expense: <TrendingDown className="h-4 w-4 text-destructive" />,
};

export default function ChartOfAccounts() {
  const navigate = useNavigate();
  const [accounts] = useState(getAccounts());
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  const filteredAccounts = accounts.filter(acc => {
    const matchesSearch = acc.name.toLowerCase().includes(search.toLowerCase()) ||
                          acc.code.includes(search);
    const matchesTab = activeTab === 'all' || acc.type === activeTab;
    return matchesSearch && matchesTab;
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };

  const totals = {
    asset: accounts.filter(a => a.type === 'asset').reduce((sum, a) => sum + a.balance, 0),
    liability: accounts.filter(a => a.type === 'liability').reduce((sum, a) => sum + a.balance, 0),
    equity: accounts.filter(a => a.type === 'equity').reduce((sum, a) => sum + a.balance, 0),
    revenue: accounts.filter(a => a.type === 'revenue').reduce((sum, a) => sum + a.balance, 0),
    expense: accounts.filter(a => a.type === 'expense').reduce((sum, a) => sum + a.balance, 0),
  };

  return (
    <AppLayout title="Accounting" subtitle="Chart of Accounts" moduleNav={ACCOUNTING_NAV}>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Chart of Accounts</h1>
          <Button onClick={() => navigate('/accounting/chart/new')}>
            <Plus className="h-4 w-4 mr-2" />
            New Account
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Object.entries(totals).map(([type, total]) => (
            <Card key={type}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  {typeIcons[type]}
                  <span className="text-sm text-muted-foreground capitalize">{type}</span>
                </div>
                <p className="text-lg font-bold mt-1">{formatCurrency(total)}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search accounts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="border-b px-4">
                <TabsList className="h-12">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="asset">Assets</TabsTrigger>
                  <TabsTrigger value="liability">Liabilities</TabsTrigger>
                  <TabsTrigger value="equity">Equity</TabsTrigger>
                  <TabsTrigger value="revenue">Revenue</TabsTrigger>
                  <TabsTrigger value="expense">Expenses</TabsTrigger>
                </TabsList>
              </div>
              
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Reconcilable</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts.map((account) => (
                    <TableRow key={account.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/accounting/chart/${account.id}/edit`)}>
                      <TableCell className="font-mono">{account.code}</TableCell>
                      <TableCell className="font-medium">{account.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {typeIcons[account.type]}
                          <span className="capitalize">{account.type}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(account.balance)}
                      </TableCell>
                      <TableCell>
                        {account.isReconcilable ? (
                          <Badge variant="outline">Yes</Badge>
                        ) : (
                          <span className="text-muted-foreground">No</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={account.isActive ? 'default' : 'secondary'}>
                          {account.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`/accounting/chart/${account.id}/edit`); }}>
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
