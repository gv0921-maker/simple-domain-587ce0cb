import { useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { useContacts } from '@/hooks/crm/useCRMQueries';
import { resolveCustomerIdForContact } from '@/lib/sales/customerCrmSync';
import { cn } from '@/lib/utils';

interface CustomerSelectorProps {
  value?: string;
  onChange: (customer: any) => void;
  disabled?: boolean;
  placeholder?: string;
  onCreateNew?: () => void;
}

/**
 * Shared searchable Customer combobox for Sales forms.
 * Loads rows from `crm_contacts` (the unified customer/contact source) and
 * resolves the matching `customers.id` via an RPC on selection — that's
 * the FK stored on `quotations.customer_id` / `sales_orders.customer_id`.
 */
export function CustomerSelector({
  value,
  onChange,
  disabled,
  placeholder = 'Select customer...',
  onCreateNew,
}: CustomerSelectorProps) {
  const { data: contacts = [], isLoading } = useContacts();
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);

  // `value` is a customers.id (FK); look up the linked contact for display.
  const selectedLabel =
    value
      ? (() => {
          const c = (contacts as any[]).find((x) => x.linkedCustomerId === value);
          if (c) return `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.companyName || c.email || '';
          return '';
        })()
      : '';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled || isLoading}
          className="w-full justify-between font-normal"
        >
          {isLoading || resolving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <span className="truncate">{selectedLabel || placeholder}</span>
          )}
          {!isLoading && !resolving && <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command
          filter={(v, search) => {
            if (!search) return 1;
            return v.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search by name, email, phone..." />
          <CommandList>
            <CommandEmpty>No customer found.</CommandEmpty>
            <CommandGroup>
              {contacts.map((c: any) => {
                const fullName =
                  `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.companyName || '(No name)';
                const email = c.email || '';
                const phone = c.phone || '';
                const company = c.companyName || '';
                const searchValue = `${fullName} ${email} ${phone} ${company}`;
                return (
                  <CommandItem
                    key={c.id}
                    value={searchValue}
                    onSelect={async () => {
                      setOpen(false);
                      setResolving(true);
                      try {
                        const customerId = await resolveCustomerIdForContact(c.id);
                        if (customerId) {
                          onChange({ id: customerId, name: fullName, phone, email, company });
                        }
                      } finally {
                        setResolving(false);
                      }
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold truncate">{fullName}</span>
                      {email && (
                        <span className="text-xs text-muted-foreground truncate">{email}</span>
                      )}
                    </div>
                    <Check
                      className={cn(
                        'h-4 w-4 shrink-0',
                        'opacity-0',
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {onCreateNew && (
            <div className="border-t bg-popover">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  onCreateNew();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-primary hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Create New Customer
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}