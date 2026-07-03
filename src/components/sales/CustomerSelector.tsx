import { ContactSearchCombobox } from '@/components/crm/ContactSearchCombobox';
import { useContacts } from '@/hooks/crm/useCRMQueries';
import { resolveCustomerIdForContact } from '@/lib/sales/customerCrmSync';
import { useState } from 'react';
import type { Contact } from '@/lib/crm/types';

interface CustomerSelectorProps {
  value?: string;
  onChange: (customer: any) => void;
  disabled?: boolean;
  placeholder?: string;
  onCreateNew?: () => void;
}

/**
 * Sales-form wrapper around `ContactSearchCombobox`.
 * The picker's `value` is a `customers.id` (FK on sales docs); on selection
 * we resolve the matching customer via `get_or_create_customer_for_contact`.
 */
export function CustomerSelector({
  value,
  onChange,
  disabled,
  placeholder = 'Select customer...',
  onCreateNew,
}: CustomerSelectorProps) {
  const { data: contacts = [] } = useContacts();
  const [resolving, setResolving] = useState(false);

  // Reverse-map: sales docs store customers.id; find the linked contact for display.
  const selectedContactId = value
    ? (contacts as any[]).find((x) => x.linkedCustomerId === value)?.id
    : undefined;

  return (
    <ContactSearchCombobox
      value={selectedContactId}
      disabled={disabled || resolving}
      placeholder={placeholder}
      onCreateNew={onCreateNew}
      onChange={async (c: Contact | null) => {
        if (!c) { onChange(null); return; }
        setResolving(true);
        try {
          const customerId = await resolveCustomerIdForContact(c.id);
          if (customerId) {
            const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.companyName || '';
            onChange({
              id: customerId,
              name,
              phone: c.phone || c.phones?.[0]?.phone || '',
              email: c.email || c.emails?.[0]?.email || '',
              company: c.companyName || '',
            });
          }
        } finally {
          setResolving(false);
        }
      }}
    />
  );
}