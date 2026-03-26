import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Plus, X } from 'lucide-react';
import {
  type Contact,
  getContacts,
  saveContact,
} from '@/lib/data/crm';
import { CRM_NAV } from '@/lib/navigation/crm';
import { useStudioConfig } from '@/hooks/useStudioConfig';
import { useToast } from '@/hooks/use-toast';

export default function ContactForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { toast } = useToast();
  const studio = useStudioConfig('crm', 'New Contact');
  const isEdit = !!id;

  const [formData, setFormData] = useState({
    type: 'individual' as Contact['type'],
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    companyId: '',
    jobTitle: '',
    department: '',
    notes: '',
    tags: [] as string[],
  });
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    if (id) {
      const contacts = getContacts();
      const contact = contacts.find(c => c.id === id);
      if (contact) {
        setFormData({
          type: contact.type,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone || '',
          companyId: contact.companyId || '',
          jobTitle: contact.jobTitle || '',
          department: contact.department || '',
          notes: contact.notes || '',
          tags: contact.tags || [],
        });
      } else {
        navigate('/crm/contacts');
      }
    }
  }, [id, navigate]);

  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      setFormData({ ...formData, tags: [...formData.tags, newTag.trim()] });
      setNewTag('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setFormData({ ...formData, tags: formData.tags.filter(t => t !== tag) });
  };

  const handleSubmit = () => {
    if (!formData.firstName || !formData.email) {
      toast({ title: 'First name and email are required', variant: 'destructive' });
      return;
    }

    const existingContact = id ? getContacts().find(c => c.id === id) : undefined;
    saveContact({
      ...(existingContact || {}),
      ...formData,
    });

    toast({ title: isEdit ? 'Contact updated' : 'Contact created' });
    navigate('/crm/contacts');
  };

  return (
    <AppLayout title="CRM" moduleNav={CRM_NAV}>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/crm/contacts')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              {isEdit ? 'Edit Contact' : 'New Contact'}
            </h1>
            <p className="text-muted-foreground">
              {isEdit ? 'Update contact information' : 'Add a new contact to your CRM'}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {studio.isFieldVisible('firstName') && (
                <div className="grid gap-2">
                  <Label>{studio.getFieldLabel('firstName', 'First Name')} {studio.isFieldRequired('firstName', true) && '*'}</Label>
                  <Input
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    readOnly={studio.isFieldReadOnly('firstName')}
                  />
                </div>
              )}
              {studio.isFieldVisible('lastName') && (
                <div className="grid gap-2">
                  <Label>{studio.getFieldLabel('lastName', 'Last Name')}</Label>
                  <Input
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    readOnly={studio.isFieldReadOnly('lastName')}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {studio.isFieldVisible('email') && (
                <div className="grid gap-2">
                  <Label>{studio.getFieldLabel('email', 'Email')} {studio.isFieldRequired('email') && '*'}</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    readOnly={studio.isFieldReadOnly('email')}
                  />
                </div>
              )}
              {studio.isFieldVisible('phone') && (
                <div className="grid gap-2">
                  <Label>{studio.getFieldLabel('phone', 'Phone')}</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    readOnly={studio.isFieldReadOnly('phone')}
                  />
                </div>
              )}
            </div>

            {studio.isFieldVisible('company') && (
              <div className="grid gap-2">
                <Label>{studio.getFieldLabel('company', 'Company')}</Label>
                <Input
                  value={formData.companyId || ''}
                  onChange={(e) => setFormData({ ...formData, companyId: e.target.value })}
                  readOnly={studio.isFieldReadOnly('company')}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {studio.isFieldVisible('jobTitle') && (
                <div className="grid gap-2">
                  <Label>{studio.getFieldLabel('jobTitle', 'Job Title')}</Label>
                  <Input
                    value={formData.jobTitle}
                    onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                    readOnly={studio.isFieldReadOnly('jobTitle')}
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label>Department</Label>
                <Input
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                />
              </div>
            </div>

            {studio.isFieldVisible('tags') && (
              <div className="grid gap-2">
                <Label>{studio.getFieldLabel('tags', 'Tags')}</Label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {formData.tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <button onClick={() => handleRemoveTag(tag)} className="ml-1">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                  />
                  <Button type="button" variant="outline" size="icon" onClick={handleAddTag}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {studio.isFieldVisible('notes') && (
              <div className="grid gap-2">
                <Label>{studio.getFieldLabel('notes', 'Notes')}</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  readOnly={studio.isFieldReadOnly('notes')}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate('/crm/contacts')}>Cancel</Button>
          <Button onClick={handleSubmit}>{isEdit ? 'Update' : 'Create'} Contact</Button>
        </div>
      </div>
    </AppLayout>
  );
}
