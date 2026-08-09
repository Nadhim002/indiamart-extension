import { useState, useEffect, useRef } from 'react';
import { FIREBASE_CONFIG } from '@shared/firebaseConfig';

// Hosted on Firebase Hosting rather than shipped as a manifest sandboxed
// page — Google's Picker library needs a real, non-opaque origin to
// validate its own cross-frame messages, which a sandboxed extension page
// (always opaque by design) can never provide.
const PICKER_ORIGIN = 'https://indiamart-extension-notifier.firebaseapp.com';
const PICKER_URL = `${PICKER_ORIGIN}/picker.html`;

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Google Sheets export settings live in chrome.storage.local — not the
// localStorage-backed useSettings seam — since they're cross-context
// connection config the service worker reads directly (like
// registeredDevices/googleUID), not a per-run filter.
//
// spreadsheetId/spreadsheetName are set only via pickSheet() (Google Picker,
// drive.file scope) — the user never types a URL/ID by hand, so there's no
// parsing step and no way for the two to disagree.
export function useGoogleSheetsSettings() {
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [spreadsheetName, setSpreadsheetName] = useState('');
  const [sheetTabName, setSheetTabName] = useState('');
  const [tabs, setTabs] = useState<string[]>([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsError, setTabsError] = useState<string | null>(null);

  const loadedRef = useRef(false);

  // Lists the tabs in `id` via a non-interactive token (same cached grant
  // writeLeadsToSheet uses in the background) — never prompts, since this
  // only runs while a sheet is already connected.
  const fetchTabsFor = (id: string) => {
    setTabsLoading(true);
    setTabsError(null);
    chrome.identity.getAuthToken({ interactive: false }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        setTabsError(chrome.runtime.lastError?.message ?? 'Not connected — reconnect the sheet.');
        setTabsLoading(false);
        return;
      }
      try {
        const res = await fetch(`${SHEETS_API_BASE}/${id}?fields=sheets.properties.title`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Sheet metadata fetch failed: ${res.status}`);
        const data = await res.json();
        const titles = (data.sheets || [])
          .map((s: { properties?: { title?: string } }) => s.properties?.title)
          .filter((t: string | undefined): t is string => typeof t === 'string');
        setTabs(titles);
      } catch (e) {
        setTabsError(e instanceof Error ? e.message : 'Failed to load tabs');
      } finally {
        setTabsLoading(false);
      }
    });
  };

  // A previously-picked tab that no longer exists in the fetched list (e.g.
  // renamed/deleted directly in Sheets) must not be silently kept — clear it
  // so the panel's "select a tab" warning prompts a re-pick instead.
  useEffect(() => {
    if (sheetTabName && tabs.length > 0 && !tabs.includes(sheetTabName)) {
      setSheetTabName('');
    }
  }, [tabs, sheetTabName]);

  useEffect(() => {
    chrome.storage.local.get(['spreadsheetId', 'spreadsheetName', 'sheetTabName'], (r) => {
      if (typeof r.spreadsheetId === 'string') setSpreadsheetId(r.spreadsheetId);
      if (typeof r.spreadsheetName === 'string') setSpreadsheetName(r.spreadsheetName);
      if (typeof r.sheetTabName === 'string') setSheetTabName(r.sheetTabName);
      loadedRef.current = true;
      if (typeof r.spreadsheetId === 'string' && r.spreadsheetId) fetchTabsFor(r.spreadsheetId);
    });

    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== 'local') return;
      if (changes.spreadsheetId) {
        const next = changes.spreadsheetId.newValue;
        setSpreadsheetId(typeof next === 'string' ? next : '');
      }
      if (changes.spreadsheetName) {
        const next = changes.spreadsheetName.newValue;
        setSpreadsheetName(typeof next === 'string' ? next : '');
      }
      if (changes.sheetTabName) {
        const next = changes.sheetTabName.newValue;
        setSheetTabName(typeof next === 'string' ? next : '');
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    chrome.storage.local.set({ sheetTabName });
  }, [sheetTabName]);

  // Gets an interactive OAuth token (drive.file scope, per manifest), opens
  // the hosted Picker page in a popup (needs its own window since Picker's
  // UI needs more room than the side panel gives it), and resolves once the
  // user picks a file, creates one, or closes the popup.
  const pickSheet = (): Promise<{ ok: boolean; reason?: string }> => {
    return new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError || !token) {
          resolve({ ok: false, reason: chrome.runtime.lastError?.message ?? 'No token granted' });
          return;
        }

        const pickerWindow = window.open(PICKER_URL, '_blank', 'width=1051,height=650');
        if (!pickerWindow) {
          resolve({ ok: false, reason: 'Popup blocked — allow popups for this extension' });
          return;
        }

        let settled = false;
        const finish = (result: { ok: boolean; reason?: string }) => {
          if (settled) return;
          settled = true;
          window.removeEventListener('message', onMessage);
          window.clearInterval(closedPoll);
          resolve(result);
        };

        const onMessage = (event: MessageEvent) => {
          if (event.source !== pickerWindow || event.origin !== PICKER_ORIGIN) return;
          const data = event.data;
          if (data?.type === 'PICKER_SANDBOX_READY') {
            pickerWindow.postMessage(
              { type: 'PICKER_INIT', token, developerKey: FIREBASE_CONFIG.apiKey },
              PICKER_ORIGIN
            );
          } else if (data?.type === 'PICKER_RESULT') {
            if (data.ok) {
              const isNewSheet = data.spreadsheetId !== spreadsheetId;
              chrome.storage.local.set({
                spreadsheetId: data.spreadsheetId,
                spreadsheetName: data.spreadsheetName,
                ...(isNewSheet ? { sheetTabName: '' } : {}),
              });
              setSpreadsheetId(data.spreadsheetId);
              setSpreadsheetName(data.spreadsheetName);
              if (isNewSheet) setSheetTabName('');
              fetchTabsFor(data.spreadsheetId);
              finish({ ok: true });
            } else {
              finish({ ok: false, reason: data.reason });
            }
          }
        };
        window.addEventListener('message', onMessage);

        // Covers the user closing the popup without picking anything —
        // otherwise the panel's "busy" state would hang forever.
        const closedPoll = window.setInterval(() => {
          if (pickerWindow.closed) finish({ ok: false, reason: 'cancelled' });
        }, 500);
      });
    });
  };

  const clearSheet = () => {
    chrome.storage.local.remove(['spreadsheetId', 'spreadsheetName']);
    setSpreadsheetId('');
    setSpreadsheetName('');
    setTabs([]);
  };

  const refreshTabs = () => {
    if (spreadsheetId) fetchTabsFor(spreadsheetId);
  };

  return {
    spreadsheetId,
    spreadsheetName,
    sheetTabName,
    setSheetTabName,
    tabs,
    tabsLoading,
    tabsError,
    refreshTabs,
    connected: Boolean(spreadsheetId),
    pickSheet,
    clearSheet,
  };
}
