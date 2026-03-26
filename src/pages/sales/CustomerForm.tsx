import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { getContacts, saveContact, type Contact } from '@/lib/data/sales';
import { SALES_NAV } from '@/lib/navigation/sales';
import { useToast } from '@/hooks/use-toast';

export default function CustomerForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { toast } = useToast();
  const isEdit = !!id;

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    jobTitle: '',
    address: '',
    notes: '',
  });

  useEffect(() => {
    if (id) {
      const contacts = getContacts();
      const contact = contacts.find(c => c.id === id);
      if (contact) {
        setFormData({
          name: contact.name,
          email: contact.email,
          phone: contact.phone || '',
          company: contact.company || '',
          jobTitle: contact.jobTitle || '',
          address: contact.address || '',
          notes: contact.notes || '',
        });
      } else {
        navigate('/sales/customers');
      }
    }
  }, [id, navigate]);

  const handleSubmit = () => {
    if (!formData.name || !formData.email) {
      toast({ title: 'Name and email are required', variant: 'destructive' });
      return;
    }

    const existingContact = id ? getContacts().find(c => c.id === id) : undefined;
    const contactData: Contact = {
      id: existingContact?.id || '',
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      company: formData.company,
      jobTitle: formData.jobTitle,
      address: formData.address,
      tags: existingContact?.tags || [],
      notes: formData.notes,
      createdAt: existingContact?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveContact(contactData);
    toast({ title: isEdit ? 'Customer updated' : 'Customer created' });
    navigate('/sales/customers');
  };

  return (
    <AppLayout title="Sales" moduleNav={SALES_NAV}>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/sales/customers')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              {isEdit ? 'Edit Customer' : 'New Customer'}
            </h1>
            <p className="text-muted-foreground">
              {isEdit ? 'Update customer details' : 'Add a new customer contact'}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Customer Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Phone</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Company</Label>
                <Input
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Job Title</Label>
              <Input
                value={formData.jobTitle}
                onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Address</Label>
              <Input
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate('/sales/customers')}>Cancel</Button>
          <Button onClick={handleSubmit}>{isEdit ? 'Update' : 'Create'} Customer</Button>
        </div>
      </div>
    </AppLayout>
  );
}
