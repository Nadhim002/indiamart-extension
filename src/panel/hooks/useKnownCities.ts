import { useState, useEffect } from 'react';

// The Cities filter offers only cities the worker has actually observed on
// real leads, keyed by the state they belong to (see harvestCitiesByState in
// the service worker), stored under chrome.storage.local `knownCitiesByState`.
// This hook loads that map and live-updates when the worker appends a
// newly-seen state/city, so the nested list grows on its own while the timer
// runs.
export function useKnownCities(): Record<string, string[]> {
  const [citiesByState, setCitiesByState] = useState<Record<string, string[]>>({});

  useEffect(() => {
    chrome.storage.local.get(['knownCitiesByState'], (r) => {
      if (r.knownCitiesByState && typeof r.knownCitiesByState === 'object') {
        setCitiesByState(r.knownCitiesByState as Record<string, string[]>);
      }
    });

    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area === 'local' && changes.knownCitiesByState) {
        const next = changes.knownCitiesByState.newValue;
        setCitiesByState(next && typeof next === 'object' ? (next as Record<string, string[]>) : {});
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  return citiesByState;
}
