import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ACCOUNTING_NAV } from '@/lib/navigation/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft } from 'lucide-react';
import { getAccounts, createAccount, updateAccount, type Account } from '@/lib/data/accounting';
import { toast } from 'sonner';

export default function AccountForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    type: 'asset' as Account['type'],
    isReconcilable: false,
    isActive: true,
  });

  useEffect(() => {
    if (id) {
      const accounts = getAccounts();
      const account = accounts.find(a => a.id === id);
      if (account) {
        setFormData({
          code: account.code,
          name: account.name,
          type: account.type,
          isReconcilable: account.isReconcilable,
          isActive: account.isActive,
        });
      } else {
        navigate('/accounting/chart');
      }
    }
  }, [id, navigate]);

  const handleSubmit = () => {
    if (!formData.code || !formData.name) {
      toast.error('Please fill in required fields');
      return;
    }

    if (isEdit && id) {
      updateAccount(id, formData);
      toast.success('Account updated');
    } else {
      createAccount(formData);
      toast.success('Account created');
    }
    navigate('/accounting/chart');
  };

  return (
    <AppLayout title="Accounting" subtitle={isEdit ? 'Edit Account' : 'New Account'} moduleNav={ACCOUNTING_NAV}>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/accounting/chart')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              {isEdit ? 'Edit Account' : 'New Account'}
            </h1>
            <p className="text-muted-foreground">
              {isEdit ? 'Update account details' : 'Create a new ledger account'}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Account Code *</Label>
                <Input
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Account Type</Label>
                <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v as Account['type'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asset">Asset</SelectItem>
                    <SelectItem value="liability">Liability</SelectItem>
                    <SelectItem value="equity">Equity</SelectItem>
                    <SelectItem value="revenue">Revenue</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Account Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Reconcilable</Label>
              <Switch checked={formData.isReconcilable} onCheckedChange={(v) => setFormData({ ...formData, isReconcilable: v })} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={formData.isActive} onCheckedChange={(v) => setFormData({ ...formData, isActive: v })} />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate('/accounting/chart')}>Cancel</Button>
          <Button onClick={handleSubmit}>{isEdit ? 'Update' : 'Create'} Account</Button>
        </div>
      </div>
    </AppLayout>
  );
}
