import { useState, useEffect } from 'react';

interface LeadsBoughtToday {
  date?: string;
  count?: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Live view of how many leads the service worker has purchased so far today.
// Backed by chrome.storage.local (the service worker has no localStorage
// access), keyed by date so a stale count from a previous day reads as 0.
export function useLeadsToday() {
  const [leadsBoughtToday, setLeadsBoughtToday] = useState(0);

  useEffect(() => {
    const readCount = (value: LeadsBoughtToday | undefined) => {
      setLeadsBoughtToday(value?.date === todayIso() ? value.count || 0 : 0);
    };

    chrome.storage.local.get(['leadsBoughtToday'], (r: { leadsBoughtToday?: LeadsBoughtToday }) =>
      readCount(r.leadsBoughtToday)
    );

    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== 'local') return;
      if (changes.leadsBoughtToday) {
        readCount(changes.leadsBoughtToday.newValue as LeadsBoughtToday | undefined);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  return { leadsBoughtToday };
}
