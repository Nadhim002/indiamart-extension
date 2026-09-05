import { useState, useEffect } from 'react';

interface PurchaseBreaker {
  tripped?: boolean;
  lastAttemptAt?: number;
}

// Live view of the service worker's purchase circuit breaker (see
// getPurchaseGate/recordPurchaseOutcome in service-worker.js). It trips when
// IndiaMART starts rejecting purchases back-to-back — in practice almost
// always the account's lead-credit balance running out — so buying silently
// stops working for hours at a time with no signal in the UI otherwise. This
// mirrors useLeadsToday.ts: backed by chrome.storage.local (the service
// worker has no localStorage access), read live via chrome.storage.onChanged.
export function usePurchaseBreaker() {
  const [tripped, setTripped] = useState(false);

  useEffect(() => {
    const readState = (value: PurchaseBreaker | undefined) => {
      setTripped(value?.tripped === true);
    };

    chrome.storage.local.get(['purchaseBreaker'], (r: { purchaseBreaker?: PurchaseBreaker }) =>
      readState(r.purchaseBreaker)
    );

    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== 'local') return;
      if (changes.purchaseBreaker) {
        readState(changes.purchaseBreaker.newValue as PurchaseBreaker | undefined);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  return { purchasingBlocked: tripped };
}
