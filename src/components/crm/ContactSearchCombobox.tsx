import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { useContacts } from '@/hooks/crm/useCRMQueries';
import type { Contact } from '@/lib/crm/types';
import { cn } from '@/lib/utils';

export interface ContactSearchComboboxProps {
  /** Selected contact id */
  value?: string;
  /** Called with the picked contact (or null when cleared) */
  onChange: (contact: Contact | null) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Optional inline "+ Create new contact" action */
  onCreateNew?: () => void;
  /** Restrict to active contacts. Defaults to true. */
  activeOnly?: boolean;
}

/**
 * Searchable Contact combobox.
 *
 * Matches against full name, primary email/phone, company name, and any
 * entries in the `emails` / `phones` JSONB arrays. Uses the cached
 * `useContacts` query so search is instant and offline-friendly — no need
 * to round-trip Postgres on every keystroke.
 */
export function ContactSearchCombobox({
  value,
  onChange,
  disabled,
  placeholder = 'Select contact...',
  onCreateNew,
  activeOnly = true,
}: ContactSearchComboboxProps) {
  const { data: contacts = [], isLoading } = useContacts();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');

  const pool = useMemo(
    () =>
      (contacts as Contact[]).filter((c) => (activeOnly ? c.status !== 'archived' : true)),
    [contacts, activeOnly],
  );

  const selected = value ? pool.find((c) => c.id === value) : undefined;
  const selectedLabel = selected
    ? `${selected.firstName ?? ''} ${selected.lastName ?? ''}`.trim()
      || selected.companyName
      || selected.email
      || ''
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
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <span className="truncate">{selectedLabel || placeholder}</span>
          )}
          {!isLoading && <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]" align="start">
        <Command
          filter={(v, search) => {
            if (!search) return 1;
            return v.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput
            placeholder="Search by name, phone, email, company..."
            value={term}
            onValueChange={setTerm}
          />
          <CommandList>
            <CommandEmpty>
              <div className="flex flex-col items-center gap-2 py-2">
                <span className="text-sm text-muted-foreground">No contacts found</span>
                {onCreateNew && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setOpen(false);
                      onCreateNew();
                    }}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create new contact
                  </button>
                )}
              </div>
            </CommandEmpty>
            <CommandGroup>
              {pool.map((c) => {
                const fullName =
                  `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.companyName || '(No name)';
                const email = c.email || c.emails?.[0]?.email || '';
                const phone = c.phone || c.phones?.[0]?.phone || '';
                const company = c.companyName || '';
                const extraEmails = (c.emails ?? []).map((e) => e.email).join(' ');
                const extraPhones = (c.phones ?? []).map((p) => p.phone).join(' ');
                const searchValue = [
                  fullName, email, phone, company, extraEmails, extraPhones,
                ].filter(Boolean).join(' ');
                const isSelected = value === c.id;
                return (
                  <CommandItem
                    key={c.id}
                    value={searchValue}
                    onSelect={() => {
                      setOpen(false);
                      onChange(c);
                    }}
                    className="flex items-start justify-between gap-3"
                  >
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="font-semibold truncate">{fullName}</span>
                      {(email || phone) && (
                        <span className="text-xs text-muted-foreground truncate">
                          {[phone, email].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {company && (
                        <Badge variant="secondary" className="text-[10px] font-normal max-w-[140px] truncate">
                          {company}
                        </Badge>
                      )}
                      <Check className={cn('h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')} />
                    </div>
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
                className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-primary hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Plus className="h-4 w-4" />
                Create new contact
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}