import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface CityByStateSelectProps {
  /** Selected states -> cities ticked under each. Empty array = whole state. */
  stateCities: Record<string, string[]>;
  /** Cities the worker has actually observed, per state. */
  knownCitiesByState: Record<string, string[]>;
  onToggleCity: (state: string, city: string) => void;
  onSetStateCities: (state: string, cities: string[]) => void;
  disabled?: boolean;
}

// Renders one collapsible group per selected state, listing only the cities
// known for that state — so a city can never be picked under a state the user
// hasn't also selected. Nothing renders when no states are selected; the
// States control (a separate MultiSelect) is what puts states into
// `stateCities` in the first place.
export default function CityByStateSelect({
  stateCities,
  knownCitiesByState,
  onToggleCity,
  onSetStateCities,
  disabled,
}: CityByStateSelectProps) {
  const states = Object.keys(stateCities).sort((a, b) => a.localeCompare(b));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (states.length === 0) return null;

  return (
    <div className="space-y-2">
      <Label>Cities</Label>
      <div className="max-h-[280px] space-y-1 overflow-y-auto rounded-md border p-2">
        {states.map((state) => {
          const selectedCities = stateCities[state] ?? [];
          const cityOptions = knownCitiesByState[state] ?? [];
          const isCollapsed = collapsed[state] ?? false;
          const summary =
            selectedCities.length === 0
              ? 'Whole state'
              : `${selectedCities.length} of ${cityOptions.length} cities`;

          return (
            <div key={state} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1 text-left text-sm font-medium disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => setCollapsed((c) => ({ ...c, [state]: !isCollapsed }))}
                  aria-expanded={!isCollapsed}
                  disabled={disabled}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  )}
                  <span className="truncate">{state}</span>
                </button>
                {cityOptions.length > 0 && (
                  <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <button
                      type="button"
                      className="hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
                      disabled={disabled}
                      onClick={() => onSetStateCities(state, cityOptions)}
                    >
                      All
                    </button>
                    <span>·</span>
                    <button
                      type="button"
                      className="hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
                      disabled={disabled}
                      onClick={() => onSetStateCities(state, [])}
                    >
                      None
                    </button>
                  </div>
                )}
              </div>
              <p className="pl-[18px] text-xs text-muted-foreground">{summary}</p>
              {!isCollapsed && (
                <div className="pl-[18px]">
                  {cityOptions.length === 0 ? (
                    <p className="px-2 py-1.5 text-sm text-muted-foreground">
                      No cities seen yet for this state — they'll appear here as leads arrive.
                    </p>
                  ) : (
                    cityOptions.map((city) => (
                      <label
                        key={city}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent',
                          selectedCities.includes(city) && 'bg-accent/50'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCities.includes(city)}
                          onChange={() => onToggleCity(state, city)}
                          disabled={disabled}
                          className="accent-primary"
                        />
                        <span>{city}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">No cities under a state = whole state</p>
    </div>
  );
}
