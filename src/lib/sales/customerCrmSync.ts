// Unified customer/contact model: every `customers` row is auto-synced
// from its linked `crm_contacts` row by a database trigger. These helpers
// resolve the linked `customer_id` for sales documents and shape selected
// contacts into the field set the sales forms expect.
import { supabase } from '@/integrations/supabase/client';

/** Resolve (or create on demand) the `customers.id` linked to a CRM contact. */
export async function resolveCustomerIdForContact(contactId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_or_create_customer_for_contact' as any, {
    p_contact_id: contactId,
  });
  if (error) {
    console.error('resolveCustomerIdForContact failed', error);
    return null;
  }
  return (data as string) ?? null;
}

/** Build the Sales form billing/customer fields from a selection. */
export function buildCustomerPopulationFields(c: {
  id?: string; name?: string; phone?: string | null;
}) {
  const name = c?.name || '';
  return {
    customerId: c?.id,
    customerName: name,
    billingCustomerName: name,
    billingName: name,
    billingPhone1: c?.phone || '',
    deliveryName: name,
  };
}