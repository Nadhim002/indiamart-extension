import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface MultiSelectProps {
  label: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  disabled?: boolean;
  /** Trigger label shown when nothing is selected. */
  placeholder?: string;
  /** Show an in-popover text filter (useful for long option lists). */
  searchable?: boolean;
  /** Message shown when there are no options to choose from. */
  emptyText?: string;
  /** Small helper text under the trigger. */
  hint?: string;
}

// A checkbox multi-select in a popover. Backs both the States filter (fixed
// list) and the City filter (learned list — hence `searchable` + `emptyText`).
export default function MultiSelect({
  label,
  options,
  selected,
  onToggle,
  disabled,
  placeholder = 'Any',
  searchable = false,
  emptyText = 'No options yet',
  hint,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const triggerLabel = selected.length > 0 ? `${selected.length} selected` : placeholder;

  const visible = searchable && query.trim()
    ? options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between font-normal"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`Filter by ${label.toLowerCase()}`}
          >
            {triggerLabel}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0" align="start">
          {searchable && options.length > 0 && (
            <div className="border-b p-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="h-8"
                aria-label={`Search ${label.toLowerCase()}`}
              />
            </div>
          )}
          <div role="listbox" aria-multiselectable="true" className="max-h-[200px] overflow-y-auto p-1">
            {options.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">{emptyText}</p>
            ) : visible.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">No matches</p>
            ) : (
              visible.map((option) => (
                <label
                  key={option}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent',
                    selected.includes(option) && 'bg-accent/50'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={() => onToggle(option)}
                    className="accent-primary"
                  />
                  <span>{option}</span>
                </label>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
