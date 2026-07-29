import { useState, useEffect, useRef } from 'react';

// Google Sheets export settings (sheetUrl, sheetTabName) live in
// chrome.storage.local — not the localStorage-backed useSettings seam —
// since they're cross-context connection config the service worker reads
// directly (like registeredDevices/googleUID), not a per-run filter.
export function useGoogleSheetsSettings() {
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetTabName, setSheetTabName] = useState('');
  const [connected, setConnected] = useState(false);

  const loadedRef = useRef(false);

  useEffect(() => {
    chrome.storage.local.get(['sheetUrl', 'sheetTabName', 'sheetsConnected'], (r) => {
      if (typeof r.sheetUrl === 'string') setSheetUrl(r.sheetUrl);
      if (typeof r.sheetTabName === 'string') setSheetTabName(r.sheetTabName);
      if (r.sheetsConnected === true) setConnected(true);
      loadedRef.current = true;
    });

    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== 'local') return;
      if (changes.sheetUrl) {
        const next = changes.sheetUrl.newValue;
        setSheetUrl(typeof next === 'string' ? next : '');
      }
      if (changes.sheetTabName) {
        const next = changes.sheetTabName.newValue;
        setSheetTabName(typeof next === 'string' ? next : '');
      }
      if (changes.sheetsConnected) setConnected(changes.sheetsConnected.newValue === true);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    chrome.storage.local.set({ sheetUrl, sheetTabName });
  }, [sheetUrl, sheetTabName]);

  const connect = (): Promise<{ ok: boolean; reason?: string }> => {
    return new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError || !token) {
          resolve({ ok: false, reason: chrome.runtime.lastError?.message ?? 'No token granted' });
          return;
        }
        chrome.storage.local.set({ sheetsConnected: true });
        setConnected(true);
        resolve({ ok: true });
      });
    });
  };

  return { sheetUrl, setSheetUrl, sheetTabName, setSheetTabName, connected, connect };
}
