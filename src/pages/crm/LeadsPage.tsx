// CRM Leads — quick-capture by phone number.
// Ten-box phone entry looks up an existing customer/contact; if none is found,
// the user enters a name and we create both a contact and a lead. Each lead
// can be one-click converted into a New Opportunity (prefilled).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { CRM_NAV } from '@/lib/navigation/crm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ArrowRight, Loader2, UserPlus, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useContacts, useSaveContact } from '@/hooks/crm/useCRMQueries';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface LeadRow {
  id: string;
  contact_id: string | null;
  contact_name: string;
  phone: string | null;
  created_by: string | null;
  created_at: string;
  converted_to_opportunity_id: string | null;
}

const DIGIT_COUNT = 10;

function normalizePhone(p: string | null | undefined) {
  return (p || '').replace(/\D/g, '').slice(-10);
}

export default function LeadsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: contacts = [] } = useContacts();
  const saveContact = useSaveContact();

  const [digits, setDigits] = useState<string[]>(Array(DIGIT_COUNT).fill(''));
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const phone = digits.join('');
  const isComplete = phone.length === DIGIT_COUNT;

  const match = useMemo(() => {
    if (!isComplete) return null;
    return contacts.find((c) => normalizePhone(c.phone) === phone) || null;
  }, [isComplete, phone, contacts]);

  async function loadLeads() {
    setLoadingLeads(true);
    const { data, error } = await supabase
      .from('crm_leads')
      .select('id, contact_id, contact_name, phone, created_by, created_at, converted_to_opportunity_id')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      toast.error('Failed to load leads', { description: error.message });
    } else {
      setLeads((data ?? []) as LeadRow[]);
    }
    setLoadingLeads(false);
  }

  useEffect(() => { loadLeads(); }, []);

  function updateDigit(idx: number, val: string) {
    const clean = val.replace(/\D/g, '');
    if (!clean) {
      const next = [...digits];
      next[idx] = '';
      setDigits(next);
      return;
    }
    // Support paste of multiple digits
    const chars = clean.split('');
    const next = [...digits];
    let cursor = idx;
    for (const ch of chars) {
      if (cursor >= DIGIT_COUNT) break;
      next[cursor] = ch;
      cursor++;
    }
    setDigits(next);
    const focusTarget = Math.min(cursor, DIGIT_COUNT - 1);
    inputsRef.current[focusTarget]?.focus();
    inputsRef.current[focusTarget]?.select();
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      const next = [...digits];
      next[idx - 1] = '';
      setDigits(next);
      inputsRef.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < DIGIT_COUNT - 1) {
      inputsRef.current[idx + 1]?.focus();
    }
  }

  function resetForm() {
    setDigits(Array(DIGIT_COUNT).fill(''));
    setName('');
    inputsRef.current[0]?.focus();
  }

  async function insertLead(contactId: string, contactName: string, phoneStr: string) {
    const { error } = await supabase.from('crm_leads').insert({
      title: contactName,
      contact_id: contactId,
      contact_name: contactName,
      phone: phoneStr,
      created_by: user?.email || user?.name || null,
      source: 'manual',
      status: 'new',
    } as never);
    if (error) throw error;
  }

  async function handleSaveLead() {
    if (!isComplete) return;
    setSaving(true);
    try {
      let contactId = match?.id;
      let contactName = match ? `${match.firstName} ${match.lastName}`.trim() : name.trim();
      const phoneStr = `+91 ${phone}`;

      if (!contactId) {
        if (!contactName) {
          toast.error('Enter a name');
          setSaving(false);
          return;
        }
        const [firstName, ...rest] = contactName.split(' ');
        const saved = await saveContact.mutateAsync({
          type: 'individual',
          firstName: firstName || contactName,
          lastName: rest.join(' '),
          email: '',
          phone: phoneStr,
          addresses: [],
          tags: [],
          status: 'active',
          score: 0,
        });
        contactId = saved.id;
      }
      await insertLead(contactId!, contactName, phoneStr);
      toast.success('Lead saved');
      resetForm();
      await loadLeads();
    } catch (err) {
      const msg = (err as { message?: string })?.message || 'Failed to save lead';
      toast.error('Save lead failed', { description: msg });
    } finally {
      setSaving(false);
    }
  }

  function handleConvert(lead: LeadRow) {
    const prefill = {
      name: lead.contact_name,
      contactId: lead.contact_id || '',
      expectedRevenue: 0,
      expectedCloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
      leadId: lead.id,
    };
    navigate(
      `/crm/opportunities/new?restoredData=${encodeURIComponent(JSON.stringify(prefill))}`,
    );
  }

  const nameNeeded = isComplete && !match;
  const canSave = isComplete && (match || name.trim().length > 0);

  return (
    <AppLayout title="CRM" moduleNav={CRM_NAV}>
      <div className="p-3 md:p-6 max-w-5xl mx-auto space-y-4 md:space-y-6">
        <Card>
          <CardHeader className="p-4 md:p-6 pb-2 md:pb-4">
            <CardTitle className="text-base md:text-lg">Capture Lead</CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-2 md:pt-2 space-y-4 md:space-y-6">
            <div>
              <Label className="mb-2 block text-sm">Phone number</Label>
              <div className="flex items-center gap-1 md:gap-2">
                <span className="text-xs md:text-sm text-muted-foreground shrink-0 mr-0.5">+91</span>
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => (inputsRef.current[i] = el)}
                    type="tel"
                    inputMode="numeric"
                    maxLength={i === 0 ? DIGIT_COUNT : 1}
                    value={d}
                    onChange={(e) => updateDigit(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    onFocus={(e) => e.currentTarget.select()}
                    className={cn(
                      'h-11 w-7 md:h-14 md:w-12 min-w-0 flex-1 md:flex-none rounded-md border border-input bg-background text-center text-base md:text-lg font-medium p-0',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring',
                    )}
                    aria-label={`Phone digit ${i + 1}`}
                  />
                ))}
              </div>
            </div>

            {isComplete && match && (
              <Card className="border-primary/40 bg-primary/5">
                <CardContent className="p-4 md:pt-6 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-primary mb-1">
                      <CheckCircle2 className="h-4 w-4" />
                      Existing contact
                    </div>
                    <div className="font-semibold text-base md:text-lg truncate">
                      {match.firstName} {match.lastName}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">{match.phone}</div>
                    {match.email && (
                      <div className="text-sm text-muted-foreground truncate">{match.email}</div>
                    )}
                    {match.companyName && (
                      <div className="text-sm text-muted-foreground truncate">{match.companyName}</div>
                    )}
                  </div>
                  <Badge variant="secondary" className="shrink-0">Match</Badge>
                </CardContent>
              </Card>
            )}

            {nameNeeded && (
              <Card className="border-dashed">
                <CardContent className="p-4 md:pt-6 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <UserPlus className="h-4 w-4" />
                    <span>No customer with this number — create a new one</span>
                  </div>
                  <div>
                    <Label htmlFor="lead-name">Name</Label>
                    <Input
                      id="lead-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder=""
                      autoFocus
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end">
              <Button onClick={handleSaveLead} disabled={!canSave || saving} className="w-full md:w-auto">
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Lead
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 md:p-6 pb-2 md:pb-4">
            <CardTitle className="text-base md:text-lg">Leads</CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0 md:pt-0">
            {loadingLeads ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
              </div>
            ) : leads.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No leads yet. Capture one above.
              </div>
            ) : (
              <>
                {/* Desktop */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Date created</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leads.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="font-medium">{l.contact_name}</TableCell>
                          <TableCell>{l.phone || '—'}</TableCell>
                          <TableCell>{l.created_by || '—'}</TableCell>
                          <TableCell>{new Date(l.created_at).toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            {l.converted_to_opportunity_id ? (
                              <Badge variant="secondary">Converted</Badge>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => handleConvert(l)}>
                                Convert <ArrowRight className="h-4 w-4 ml-1" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {/* Mobile */}
                <div className="md:hidden space-y-2">
                  {leads.map((l) => (
                    <div key={l.id} className="border rounded-md p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{l.contact_name}</div>
                          <div className="text-sm text-muted-foreground truncate">{l.phone || '—'}</div>
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            {l.created_by || '—'} · {new Date(l.created_at).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="shrink-0">
                          {l.converted_to_opportunity_id ? (
                            <Badge variant="secondary">Converted</Badge>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => handleConvert(l)}>
                              Convert <ArrowRight className="h-4 w-4 ml-1" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}