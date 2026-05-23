import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ProductLite {
  id: string;
  name: string;
  barcode?: string;
  sku?: string;
  salePrice: number;
}

interface Props {
  products: ProductLite[];
  value?: string;
  selectedName?: string;
  onSelect: (productId: string) => void;
  disabled?: boolean;
}

const MAX_RESULTS = 50;

export function ProductCombobox({ products, value, selectedName, onSelect, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const { results, overflow } = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const filtered = q
      ? products.filter((p) => {
          const name = p.name?.toLowerCase() || '';
          const sku = (p.sku || '').toLowerCase();
          const barcode = (p.barcode || '').toLowerCase();
          return name.includes(q) || sku.includes(q) || barcode.includes(q);
        })
      : products;
    return {
      results: filtered.slice(0, MAX_RESULTS),
      overflow: filtered.length > MAX_RESULTS,
    };
  }, [products, debouncedSearch]);

  const label = selectedName || products.find((p) => p.id === value)?.name;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex w-full items-center justify-between gap-2 h-8 px-2 text-sm font-medium rounded',
            'border border-transparent hover:border-input focus:border-input bg-transparent text-left',
            'focus:outline-none focus:ring-1 focus:ring-ring',
            !label && 'text-muted-foreground font-normal',
          )}
        >
          <span className="truncate">{label || 'Search product...'}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b border-border px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground mr-2 shrink-0" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, SKU or barcode..."
              className="h-9 border-0 shadow-none focus-visible:ring-0 px-0 text-sm"
              autoFocus
            />
          </div>
          <CommandList className="max-h-[300px]">
            {results.length === 0 ? (
              <CommandEmpty>No products found.</CommandEmpty>
            ) : (
              <CommandGroup>
                {results.map((p) => {
                  const sub = p.sku || p.barcode;
                  const isSelected = p.id === value;
                  return (
                    <CommandItem
                      key={p.id}
                      value={p.id}
                      onSelect={() => {
                        onSelect(p.id);
                        setOpen(false);
                        setSearch('');
                      }}
                      className="flex items-start gap-2 py-2"
                    >
                      <Check
                        className={cn(
                          'h-4 w-4 mt-0.5 shrink-0',
                          isSelected ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">{p.name}</span>
                        {sub && (
                          <span className="text-xs text-muted-foreground truncate font-mono">
                            {sub}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {overflow && (
              <div className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">
                Showing first {MAX_RESULTS} — type to narrow down
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}