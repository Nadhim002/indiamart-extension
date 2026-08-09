import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import MultiSelect from '@/components/ui/multi-select';
import TagInput from '@/components/ui/tag-input';

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
  selectedCities: string[];
  toggleCitySelection: (city: string) => void;
  cityOptions: readonly string[];
  includeKeywords: string[];
  setIncludeKeywords: (value: string[]) => void;
  excludeKeywords: string[];
  setExcludeKeywords: (value: string[]) => void;
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
  selectedCities,
  toggleCitySelection,
  cityOptions,
  includeKeywords,
  setIncludeKeywords,
  excludeKeywords,
  setExcludeKeywords,
  isRunning,
}: LeadFiltersProps) {
  return (
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

      <MultiSelect
        label="States"
        options={stateOptions}
        selected={selectedStates}
        onToggle={toggleStateSelection}
        disabled={isRunning}
        placeholder="Any state"
        hint="No states = no filter"
      />

      <MultiSelect
        label="Cities"
        options={cityOptions}
        selected={selectedCities}
        onToggle={toggleCitySelection}
        disabled={isRunning}
        placeholder="Any city"
        searchable
        emptyText="No cities seen yet — they appear here as leads arrive."
        hint="No cities = no filter"
      />

      <TagInput
        id="includeKeywords"
        label="Title must include (any)"
        value={includeKeywords}
        onChange={setIncludeKeywords}
        placeholder="e.g. bag, backpack"
        disabled={isRunning}
        hint="No keywords = no filter"
      />

      <TagInput
        id="excludeKeywords"
        label="Title must not include"
        value={excludeKeywords}
        onChange={setExcludeKeywords}
        placeholder="e.g. plastic"
        disabled={isRunning}
        hint="No keywords = no filter"
      />
    </div>
  );
}
