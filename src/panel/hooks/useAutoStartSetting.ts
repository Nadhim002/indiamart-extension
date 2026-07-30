import { useState, useEffect, useRef } from 'react';

// Whether the timer should auto-start the first time an IndiaMART tab loads
// after a real Chrome browser startup. Lives in chrome.storage.local (not the
// localStorage-backed useSettings seam) since the service worker — which has
// no localStorage access — is what actually reads this at startup time.
export function useAutoStartSetting() {
  const [autoStartEnabled, setAutoStartEnabledState] = useState(false);

  const loadedRef = useRef(false);

  useEffect(() => {
    chrome.storage.local.get(['autoStartEnabled'], (r) => {
      setAutoStartEnabledState(r.autoStartEnabled === true);
      loadedRef.current = true;
    });

    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== 'local') return;
      if (changes.autoStartEnabled) {
        setAutoStartEnabledState(changes.autoStartEnabled.newValue === true);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const setAutoStartEnabled = (value: boolean) => {
    setAutoStartEnabledState(value);
    chrome.storage.local.set({ autoStartEnabled: value });
  };

  return { autoStartEnabled, setAutoStartEnabled };
}
