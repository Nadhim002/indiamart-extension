import { useState, useEffect } from 'react';

// The City filter offers only cities the worker has actually observed on real
// leads (see harvestCities in the service worker), stored under
// chrome.storage.local `knownCities`. This hook loads that list and live-updates
// when the worker appends a newly-seen city, so the dropdown grows on its own
// while the timer runs.
export function useKnownCities(): string[] {
  const [cities, setCities] = useState<string[]>([]);

  useEffect(() => {
    chrome.storage.local.get(['knownCities'], (r) => {
      if (Array.isArray(r.knownCities)) setCities(r.knownCities as string[]);
    });

    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area === 'local' && changes.knownCities) {
        const next = changes.knownCities.newValue;
        setCities(Array.isArray(next) ? (next as string[]) : []);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  return cities;
}
