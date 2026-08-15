import { useState, useEffect, useRef } from 'react';
import type { User } from 'firebase/auth/web-extension';
import { getDatabase, ref, set as dbSet, get as dbGet } from 'firebase/database';
import { getFirebaseApp } from '@/lib/firebase';
import { sanitizeEmail } from '@shared/email';
import { FIREBASE_CONFIG } from '@shared/firebaseConfig';
import { SHEET_HEADER_ROW, headerMatchesExpected } from '@shared/sheetsPayload';

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
//
// Also mirrored to Firebase RTDB at accounts/{email}/leadSheet, the same way
// historySpreadsheetId is mirrored for Drive Sync (see service-worker.js's
// getSharedHistorySpreadsheetId) — so a sheet picked on one computer is the
// same sheet every other computer on the account writes to, instead of each
// one accumulating its own separate pick.
export function useGoogleSheetsSettings(user: User) {
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [spreadsheetName, setSpreadsheetName] = useState('');
  const [sheetTabName, setSheetTabName] = useState('');
  const [tabs, setTabs] = useState<string[]>([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsError, setTabsError] = useState<string | null>(null);
  const [headerStatus, setHeaderStatus] = useState<'unknown' | 'checking' | 'empty' | 'match' | 'mismatch'>(
    'unknown'
  );

  const loadedRef = useRef(false);
  const key = user.email ? sanitizeEmail(user.email) : null;

  const publishLeadSheet = (id: string, name: string, tabName: string) => {
    if (!key) return;
    dbSet(ref(getDatabase(getFirebaseApp()), `accounts/${key}/leadSheet`), {
      spreadsheetId: id,
      spreadsheetName: name,
      sheetTabName: tabName,
    });
  };

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

  // Checks the selected tab's header row so the panel can warn (without
  // blocking — see ensureTabAndHeader's write-time counterpart) if leads
  // would land under the wrong columns. Only the selected tab is checked,
  // not every tab in the dropdown, to keep this to one extra call.
  useEffect(() => {
    if (!spreadsheetId || !sheetTabName) {
      setHeaderStatus('unknown');
      return;
    }
    let cancelled = false;
    setHeaderStatus('checking');
    const range = `${sheetTabName}!A1:${String.fromCharCode(65 + SHEET_HEADER_ROW.length - 1)}1`;
    chrome.identity.getAuthToken({ interactive: false }, async (token) => {
      if (cancelled) return;
      if (chrome.runtime.lastError || !token) {
        setHeaderStatus('unknown');
        return;
      }
      try {
        const res = await fetch(
          `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) throw new Error(`Header check failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.values || data.values.length === 0) {
          setHeaderStatus('empty');
        } else {
          setHeaderStatus(headerMatchesExpected(data.values[0]) ? 'match' : 'mismatch');
        }
      } catch {
        if (!cancelled) setHeaderStatus('unknown');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [spreadsheetId, sheetTabName]);

  // Firebase is checked first and wins over the local copy — the same
  // priority order service-worker.js's ensureHistorySpreadsheet uses — so a
  // sheet picked on another computer shows up here without a re-pick. Only
  // once Firebase has nothing (no key yet, offline, or a fresh account) does
  // this fall back to whatever chrome.storage.local already has.
  useEffect(() => {
    const loadFromLocal = () => {
      chrome.storage.local.get(['spreadsheetId', 'spreadsheetName', 'sheetTabName'], (r) => {
        if (typeof r.spreadsheetId === 'string') setSpreadsheetId(r.spreadsheetId);
        if (typeof r.spreadsheetName === 'string') setSpreadsheetName(r.spreadsheetName);
        if (typeof r.sheetTabName === 'string') setSheetTabName(r.sheetTabName);
        loadedRef.current = true;
        if (typeof r.spreadsheetId === 'string' && r.spreadsheetId) fetchTabsFor(r.spreadsheetId);
      });
    };

    if (!key) {
      loadFromLocal();
    } else {
      dbGet(ref(getDatabase(getFirebaseApp()), `accounts/${key}/leadSheet`))
        .then((snap) => {
          const shared = snap.val() as
            | { spreadsheetId?: string; spreadsheetName?: string; sheetTabName?: string }
            | null;
          if (!shared?.spreadsheetId) {
            loadFromLocal();
            return;
          }
          const resolvedTabName = shared.sheetTabName ?? '';
          chrome.storage.local.set({
            spreadsheetId: shared.spreadsheetId,
            spreadsheetName: shared.spreadsheetName ?? '',
            sheetTabName: resolvedTabName,
          });
          setSpreadsheetId(shared.spreadsheetId);
          setSpreadsheetName(shared.spreadsheetName ?? '');
          setSheetTabName(resolvedTabName);
          loadedRef.current = true;
          fetchTabsFor(shared.spreadsheetId);
        })
        .catch((e) => {
          console.warn('[Sheets] Firebase lookup failed (non-fatal):', e);
          loadFromLocal();
        });
    }

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
  }, [key]);

  useEffect(() => {
    if (!loadedRef.current) return;
    chrome.storage.local.set({ sheetTabName });
    if (spreadsheetId) publishLeadSheet(spreadsheetId, spreadsheetName, sheetTabName);
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
              const nextTabName = isNewSheet ? '' : sheetTabName;
              chrome.storage.local.set({
                spreadsheetId: data.spreadsheetId,
                spreadsheetName: data.spreadsheetName,
                ...(isNewSheet ? { sheetTabName: '' } : {}),
              });
              setSpreadsheetId(data.spreadsheetId);
              setSpreadsheetName(data.spreadsheetName);
              if (isNewSheet) setSheetTabName('');
              publishLeadSheet(data.spreadsheetId, data.spreadsheetName, nextTabName);
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
    if (key) dbSet(ref(getDatabase(getFirebaseApp()), `accounts/${key}/leadSheet`), null);
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
    headerStatus,
    connected: Boolean(spreadsheetId),
    pickSheet,
    clearSheet,
  };
}
