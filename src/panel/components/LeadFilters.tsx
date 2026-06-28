import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface LeadFiltersProps {
  minPrice: string;
  setMinPrice: (value: string) => void;
  minQuantity: string;
  setMinQuantity: (value: string) => void;
  minTimePassed: string;
  setMinTimePassed: (value: string) => void;
  selectedStates: string[];
  toggleStateSelection: (state: string) => void;
  stateOptions: readonly string[];
  isRunning: boolean;
}

export default function LeadFilters({
  minPrice,
  setMinPrice,
  minQuantity,
  setMinQuantity,
  minTimePassed,
  setMinTimePassed,
  selectedStates,
  toggleStateSelection,
  stateOptions,
  isRunning,
}: LeadFiltersProps) {
  const [statesOpen, setStatesOpen] = useState(false);

  const filterCount = [
    minPrice.trim(),
    minQuantity.trim(),
    minTimePassed.trim(),
    selectedStates.length > 0,
  ].filter(Boolean).length;

  const triggerLabel =
    selectedStates.length > 0 ? `${selectedStates.length} selected` : 'Any state';

  return (
    <Accordion type="single" collapsible className="mt-6">
      <AccordionItem value="filters" className="border-none">
        <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
          <span className="flex items-center gap-2">
            Lead filters (optional)
            {filterCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary">
                {filterCount}
              </span>
            )}
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="minPrice">Min price</Label>
                <Input
                  id="minPrice"
                  type="number"
                  min="0"
                  step="1"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  disabled={isRunning}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="minQuantity">Min quantity</Label>
                <Input
                  id="minQuantity"
                  type="number"
                  min="0"
                  step="1"
                  value={minQuantity}
                  onChange={(e) => setMinQuantity(e.target.value)}
                  disabled={isRunning}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="minTimePassed">Min age (min)</Label>
              <Input
                id="minTimePassed"
                type="number"
                min="0"
                step="1"
                value={minTimePassed}
                onChange={(e) => setMinTimePassed(e.target.value)}
                disabled={isRunning}
              />
            </div>

            <div className="space-y-2">
              <Label>States</Label>
              <Popover open={statesOpen} onOpenChange={setStatesOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between font-normal"
                    disabled={isRunning}
                    aria-haspopup="listbox"
                    aria-expanded={statesOpen}
                    aria-label="Filter by state"
                  >
                    {triggerLabel}
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="max-h-[200px] overflow-y-auto p-0" align="start">
                  <div role="listbox" aria-multiselectable="true" className="p-1">
                    {stateOptions.map((state) => (
                      <label
                        key={state}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent',
                          selectedStates.includes(state) && 'bg-accent/50'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedStates.includes(state)}
                          onChange={() => toggleStateSelection(state)}
                          className="accent-primary"
                        />
                        <span>{state}</span>
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">No states = no filter</p>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
