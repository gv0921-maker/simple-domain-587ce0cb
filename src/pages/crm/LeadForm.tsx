import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft } from 'lucide-react';
import { getLeads, saveLead, type Lead, type LeadSource, type LeadPriority } from '@/lib/data/crm';
import { CRM_NAV } from '@/lib/navigation/crm';
import { useStudioConfig } from '@/hooks/useStudioConfig';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export default function LeadForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const studio = useStudioConfig('crm', 'New Lead');
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<Lead>>({
    title: '',
    contactName: '',
    email: '',
    phone: '',
    companyName: '',
    source: 'manual',
    priority: 'medium',
    expectedRevenue: 0,
  });

  useEffect(() => {
    if (id) {
      const leads = getLeads();
      const lead = leads.find(l => l.id === id);
      if (lead) {
        setFormData(lead);
      } else {
        navigate('/crm');
      }
    }
  }, [id, navigate]);

  const handleSubmit = () => {
    if (!formData.title) {
      toast({ title: 'Lead name is required', variant: 'destructive' });
      return;
    }

    saveLead({ ...formData, createdBy: formData.createdBy || user?.name || 'Unknown' });
    toast({ title: isEdit ? 'Lead updated' : 'Lead created' });
    navigate('/crm');
  };

  return (
    <AppLayout title="CRM" moduleNav={CRM_NAV}>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/crm')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              {isEdit ? 'Edit Lead' : 'New Lead'}
            </h1>
            <p className="text-muted-foreground">
              {isEdit ? 'Update lead information' : 'Create a new sales lead'}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Lead Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {studio.isFieldVisible('name') && (
              <div className="grid gap-2">
                <Label>{studio.getFieldLabel('name', 'Lead Name')} {studio.isFieldRequired('name', true) && '*'}</Label>
                <Input
                  value={formData.title || ''}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  readOnly={studio.isFieldReadOnly('name')}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {studio.isFieldVisible('contactName') && (
                <div className="grid gap-2">
                  <Label>{studio.getFieldLabel('contactName', 'Contact Name')}</Label>
                  <Input
                    value={formData.contactName || ''}
                    onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                    readOnly={studio.isFieldReadOnly('contactName')}
                  />
                </div>
              )}
              {studio.isFieldVisible('email') && (
                <div className="grid gap-2">
                  <Label>{studio.getFieldLabel('email', 'Email')}</Label>
                  <Input
                    type="email"
                    value={formData.email || ''}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    readOnly={studio.isFieldReadOnly('email')}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {studio.isFieldVisible('phone') && (
                <div className="grid gap-2">
                  <Label>{studio.getFieldLabel('phone', 'Phone')}</Label>
                  <Input
                    value={formData.phone || ''}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    readOnly={studio.isFieldReadOnly('phone')}
                  />
                </div>
              )}
              {studio.isFieldVisible('company') && (
                <div className="grid gap-2">
                  <Label>{studio.getFieldLabel('company', 'Company')}</Label>
                  <Input
                    value={formData.companyName || ''}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    readOnly={studio.isFieldReadOnly('company')}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4">
              {studio.isFieldVisible('source') && (
                <div className="grid gap-2">
                  <Label>{studio.getFieldLabel('source', 'Source')}</Label>
                  <Select
                    value={formData.source}
                    onValueChange={(v) => setFormData({ ...formData, source: v as LeadSource })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="website">Website</SelectItem>
                      <SelectItem value="referral">Referral</SelectItem>
                      <SelectItem value="social_media">Social Media</SelectItem>
                      <SelectItem value="trade_show">Trade Show</SelectItem>
                      <SelectItem value="cold_call">Cold Call</SelectItem>
                      <SelectItem value="email_campaign">Email Campaign</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {studio.isFieldVisible('priority') && (
                <div className="grid gap-2">
                  <Label>{studio.getFieldLabel('priority', 'Priority')}</Label>
                  <Select
                    value={formData.priority}
                    onValueChange={(v) => setFormData({ ...formData, priority: v as LeadPriority })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {studio.isFieldVisible('expectedRevenue') && (
                <div className="grid gap-2">
                  <Label>{studio.getFieldLabel('expectedRevenue', 'Expected Revenue')}</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
                    <Input
                      type="number"
                      value={formData.expectedRevenue || ''}
                      onChange={(e) => setFormData({ ...formData, expectedRevenue: parseFloat(e.target.value) || 0 })}
                      className="pl-8"
                      readOnly={studio.isFieldReadOnly('expectedRevenue')}
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate('/crm')}>Cancel</Button>
          <Button onClick={handleSubmit}>{isEdit ? 'Update' : 'Create'} Lead</Button>
        </div>
      </div>
    </AppLayout>
  );
}
