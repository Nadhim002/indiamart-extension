import { useState, useEffect, useRef } from 'react';
import type { User } from 'firebase/auth/web-extension';
import { getDatabase, ref, set as dbSet, onValue } from 'firebase/database';
import { getFirebaseApp } from '@/lib/firebase';
import { openSheetPicker } from '@/lib/picker';
import { sanitizeEmail } from '@shared/email';
import { LEAD_HISTORY_HEADER_ROW, historyHeaderMatches } from '@shared/leadHistoryPayload';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

const NEW_SHEET_TITLE = 'IndiaMART Lead History';

const SYNC_WRITE_FAILED = "Saved on this computer only — couldn't sync to your other computers.";

// Column letter for the last header column, e.g. 20 columns → 'T'.
const LAST_HEADER_COL = String.fromCharCode(65 + LEAD_HISTORY_HEADER_ROW.length - 1);
const headerRange = (tabName: string) => `${tabName}!A1:${LAST_HEADER_COL}1`;

// Identity of a shared pointer, used to tell "this is the value I just
// published" apart from "another computer changed the sheet".
const pointerKey = (id: string, name: string, tab: string) => `${id} ${name} ${tab}`;

// Whether the *account* has a history sheet configured — which is the
// question the panel could not previously answer at all, because it only ever
// read this device's chrome.storage.local mirror and never the shared node.
// 'none' is a normal state, not an error: nothing is created automatically.
export type HistoryConfigState = 'checking' | 'configured' | 'none';

// The lead-history sheet, structured exactly like useGoogleSheetsSettings.
//
// The pointer lives at accounts/{email}/driveSync and is owned by the panel:
// written here with the Firebase SDK, read back through a live onValue
// subscription. The service worker is a read-only consumer (resolveHistorySheet)
// and never creates or publishes anything.
//
// That split is the point of this hook. Previously the pointer was created by
// the sync itself, so a failed RTDB read was indistinguishable from "no sheet
// yet" and each computer quietly made its own duplicate spreadsheet. Choosing
// the destination and running the sync are now separate concerns.
export function useHistorySheetSettings(user: User) {
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [spreadsheetName, setSpreadsheetName] = useState('');
  const [sheetTabName, setSheetTabName] = useState('');
  const [tabs, setTabs] = useState<string[]>([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsError, setTabsError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [sharedSource, setSharedSource] = useState(false);
  const [configState, setConfigState] = useState<HistoryConfigState>('checking');
  const [headerStatus, setHeaderStatus] = useState<
    'unknown' | 'checking' | 'empty' | 'match' | 'mismatch'
  >('unknown');

  const loadedRef = useRef(false);
  const fetchedIdRef = useRef('');
  const lastPublishedRef = useRef<string | null>(null);
  const key = user.email ? sanitizeEmail(user.email) : null;

  // Failures have to reach the panel. Fire-and-forget made a rules rejection
  // (accounts/$email is admin-write-only apart from explicit carve-outs) look
  // exactly like success — the user believed the sheet was shared while every
  // other computer read null and created its own.
  const publishHistorySheet = (id: string, name: string, tabName: string) => {
    if (!key) {
      // Returning silently here loses the user's choice with no feedback at
      // all: adopt() has already written chrome.storage.local, so the panel
      // looks configured while the shared node keeps whatever it had — and the
      // worker reads the shared node. Same user-visible consequence as a failed
      // write, so it gets the same message.
      setSyncError(SYNC_WRITE_FAILED);
      return;
    }
    lastPublishedRef.current = pointerKey(id, name, tabName);
    // Node name stays `driveSync` because the deployed security rules already
    // carve it out; the field names match leadSheet's so both pointers read
    // identically.
    dbSet(ref(getDatabase(getFirebaseApp()), `accounts/${key}/driveSync`), {
      spreadsheetId: id,
      spreadsheetName: name,
      sheetTabName: tabName,
    })
      .then(() => setSyncError(null))
      .catch((e) => {
        console.warn('[History] publish failed:', e);
        setSyncError(SYNC_WRITE_FAILED);
      });
  };

  const getToken = (interactive: boolean): Promise<string | null> =>
    new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive }, (result) => {
        // @types/chrome declares this as GetAuthTokenResult, but Chrome hands
        // back a bare token string. Accept either rather than betting on one.
        const raw = result as unknown as string | { token?: string } | undefined;
        const token = typeof raw === 'string' ? raw : raw?.token;
        resolve(chrome.runtime.lastError || !token ? null : token);
      });
    });

  // The file's own title is captured at pick time, so renaming it in Drive
  // would otherwise leave every computer showing a name that no longer exists.
  // Google is authoritative here, so this publishes — unlike hydration, which
  // must never write back.
  const syncSpreadsheetName = (id: string, liveName: string) => {
    chrome.storage.local.get(
      ['historySpreadsheetId', 'historySpreadsheetName', 'historySheetTabName'],
      (r) => {
        if (r.historySpreadsheetId !== id) return; // sheet changed mid-flight
        if (r.historySpreadsheetName === liveName) return; // already current
        chrome.storage.local.set({ historySpreadsheetName: liveName });
        setSpreadsheetName(liveName);
        publishHistorySheet(
          id,
          liveName,
          typeof r.historySheetTabName === 'string' ? r.historySheetTabName : ''
        );
      }
    );
  };

  // Lists the tabs in `id` via a non-interactive token — never prompts, since
  // sign-in already obtained the interactive grant for this Chrome profile.
  // The same call returns the file's title, so the rename check is free.
  const fetchTabsFor = (id: string) => {
    setTabsLoading(true);
    setTabsError(null);
    void getToken(false).then(async (token) => {
      if (!token) {
        setTabsError('Not connected — reconnect the sheet.');
        setTabsLoading(false);
        return;
      }
      try {
        const res = await fetch(
          `${SHEETS_API_BASE}/${id}?fields=properties.title,sheets.properties.title`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (res.status === 404) throw new Error('This sheet no longer exists.');
        if (!res.ok) throw new Error(`Sheet metadata fetch failed: ${res.status}`);
        const data = await res.json();
        const titles = (data.sheets || [])
          .map((s: { properties?: { title?: string } }) => s.properties?.title)
          .filter((t: string | undefined): t is string => typeof t === 'string');
        setTabs(titles);
        const liveName = data.properties?.title;
        if (typeof liveName === 'string' && liveName) syncSpreadsheetName(id, liveName);
      } catch (e) {
        setTabsError(e instanceof Error ? e.message : 'Failed to load tabs');
      } finally {
        setTabsLoading(false);
      }
    });
  };

  // Selecting a tab is the only place a tab change reaches the shared node.
  // Deliberately not an effect on [sheetTabName]: that shape meant hydration
  // also published, so a computer that failed to read Firebase immediately
  // wrote its own stale values back over the shared pointer.
  const selectTab = (name: string) => {
    setSheetTabName(name);
    chrome.storage.local.set({ historySheetTabName: name });
    if (spreadsheetId) publishHistorySheet(spreadsheetId, spreadsheetName, name);
  };

  // A previously-picked tab that no longer exists must not be silently kept.
  // This publishes too: `tabs` is only non-empty after a successful fetch, so
  // reaching here means Google confirmed the tab is gone and every other
  // computer would otherwise keep writing to it. A failed fetch leaves `tabs`
  // empty and never gets here, which keeps this off the clobber path.
  useEffect(() => {
    if (sheetTabName && tabs.length > 0 && !tabs.includes(sheetTabName)) {
      setSheetTabName('');
      chrome.storage.local.set({ historySheetTabName: '' });
      if (spreadsheetId) publishHistorySheet(spreadsheetId, spreadsheetName, '');
    }
  }, [tabs, sheetTabName, spreadsheetId, spreadsheetName]);

  // Checks the selected tab's header row so the panel can warn — without
  // blocking — if rows would land under the wrong columns. The worker's
  // ensureHistoryTabAndHeader is the write-time counterpart.
  useEffect(() => {
    if (!spreadsheetId || !sheetTabName) {
      setHeaderStatus('unknown');
      return;
    }
    let cancelled = false;
    setHeaderStatus('checking');
    void getToken(false).then(async (token) => {
      if (cancelled) return;
      if (!token) {
        setHeaderStatus('unknown');
        return;
      }
      try {
        const res = await fetch(
          `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(headerRange(sheetTabName))}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) throw new Error(`Header check failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.values || data.values.length === 0) setHeaderStatus('empty');
        else setHeaderStatus(historyHeaderMatches(data.values[0]) ? 'match' : 'mismatch');
      } catch {
        if (!cancelled) setHeaderStatus('unknown');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [spreadsheetId, sheetTabName]);

  // Firebase is the source of truth and wins over the local copy, so a sheet
  // chosen on one computer shows up on every other one without a re-pick.
  //
  // onValue rather than a one-shot read: with a single read an already-open
  // panel keeps writing to the old sheet until reloaded, the exact drift this
  // shared node exists to prevent.
  //
  // The read *outcome* decides whether the local copy may be published:
  //   value        → adopt it
  //   null, first  → nothing shared yet, so seed the node from local
  //   null, later  → another computer disconnected; follow it
  //   error        → fall back to local but NEVER publish. Treating a denied
  //                  read as "no sheet" is what used to spawn duplicates.
  useEffect(() => {
    const LOCAL_KEYS = [
      'historySpreadsheetId',
      'historySpreadsheetName',
      'historySheetTabName',
    ];

    const loadFromLocal = ({ seedShared }: { seedShared: boolean }) => {
      chrome.storage.local.get(LOCAL_KEYS, (r) => {
        const id = typeof r.historySpreadsheetId === 'string' ? r.historySpreadsheetId : '';
        const name = typeof r.historySpreadsheetName === 'string' ? r.historySpreadsheetName : '';
        const tab = typeof r.historySheetTabName === 'string' ? r.historySheetTabName : '';
        setSpreadsheetId(id);
        setSpreadsheetName(name);
        setSheetTabName(tab);
        setSharedSource(false);
        setConfigState(id ? 'configured' : 'none');
        loadedRef.current = true;
        if (id && fetchedIdRef.current !== id) {
          fetchedIdRef.current = id;
          fetchTabsFor(id);
        }
        if (id && seedShared) publishHistorySheet(id, name, tab);
      });
    };

    const forgetSheet = () => {
      chrome.storage.local.remove(LOCAL_KEYS);
      setSpreadsheetId('');
      setSpreadsheetName('');
      setSheetTabName('');
      setTabs([]);
      setSharedSource(false);
      setConfigState('none');
      fetchedIdRef.current = '';
    };

    let unsubscribe: (() => void) | undefined;

    if (!key) {
      loadFromLocal({ seedShared: false });
    } else {
      unsubscribe = onValue(
        ref(getDatabase(getFirebaseApp()), `accounts/${key}/driveSync`),
        (snap) => {
          const shared = snap.val() as
            | { spreadsheetId?: string; spreadsheetName?: string; sheetTabName?: string }
            | null;

          if (!shared?.spreadsheetId) {
            if (loadedRef.current) forgetSheet();
            else loadFromLocal({ seedShared: true });
            return;
          }

          // RTDB omits null-valued keys, so an older node may lack either field.
          const resolvedName = shared.spreadsheetName ?? '';
          const resolvedTabName = shared.sheetTabName ?? '';
          chrome.storage.local.set({
            historySpreadsheetId: shared.spreadsheetId,
            historySpreadsheetName: resolvedName,
            historySheetTabName: resolvedTabName,
          });
          setSpreadsheetId(shared.spreadsheetId);
          setSpreadsheetName(resolvedName);
          setSheetTabName(resolvedTabName);
          setConfigState('configured');
          // Only label it as coming from elsewhere when it isn't the value this
          // computer just published — our own write echoes back through onValue.
          setSharedSource(
            pointerKey(shared.spreadsheetId, resolvedName, resolvedTabName) !==
              lastPublishedRef.current
          );
          loadedRef.current = true;
          if (fetchedIdRef.current !== shared.spreadsheetId) {
            fetchedIdRef.current = shared.spreadsheetId;
            fetchTabsFor(shared.spreadsheetId);
          }
        },
        (e) => {
          console.warn('[History] Firebase subscription failed (non-fatal):', e);
          loadFromLocal({ seedShared: false });
        }
      );
    }

    const onChanged = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== 'local') return;
      if (changes.historySpreadsheetId) {
        const next = changes.historySpreadsheetId.newValue;
        setSpreadsheetId(typeof next === 'string' ? next : '');
      }
      if (changes.historySpreadsheetName) {
        const next = changes.historySpreadsheetName.newValue;
        setSpreadsheetName(typeof next === 'string' ? next : '');
      }
      if (changes.historySheetTabName) {
        const next = changes.historySheetTabName.newValue;
        setSheetTabName(typeof next === 'string' ? next : '');
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      unsubscribe?.();
    };
  }, [key]);

  // Adopting a new destination invalidates every syncedAt marker: they are
  // per-lead, not per-sheet, so without this the new sheet would silently
  // start mid-history. IndexedDB lives in the worker, hence the message.
  const notifyWorker = (): Promise<void> =>
    new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'HISTORY_SHEET_CHANGED' }, () => {
        void chrome.runtime.lastError; // worker asleep is not an error worth surfacing
        resolve();
      });
    });

  const adopt = async (id: string, name: string, tabName: string) => {
    chrome.storage.local.set({
      historySpreadsheetId: id,
      historySpreadsheetName: name,
      historySheetTabName: tabName,
    });
    setSpreadsheetId(id);
    setSpreadsheetName(name);
    setSheetTabName(tabName);
    setConfigState('configured');
    setSharedSource(false);
    publishHistorySheet(id, name, tabName);
    fetchedIdRef.current = id;
    fetchTabsFor(id);
    await notifyWorker();
  };

  // Creates the sheet the extension expects: correct title, header row, and a
  // warningOnly protected range over it. Lives here rather than in the worker
  // so the panel owns the pointer end to end, the way the bought sheet does.
  // Nothing is ever created without an explicit click.
  const createSheet = async (): Promise<{ ok: boolean; reason?: string }> => {
    const token = await getToken(true);
    if (!token) return { ok: false, reason: 'no-token' };
    const authJson = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    try {
      const createRes = await fetch(SHEETS_API_BASE, {
        method: 'POST',
        headers: authJson,
        body: JSON.stringify({ properties: { title: NEW_SHEET_TITLE } }),
      });
      if (!createRes.ok) throw new Error(`Create failed: ${createRes.status}`);
      const created = await createRes.json();
      const id: string = created.spreadsheetId;
      const sheet = created.sheets?.[0];
      const sheetId: number = sheet?.properties?.sheetId ?? 0;
      const tabName: string = sheet?.properties?.title ?? 'Sheet1';

      const headerRes = await fetch(
        `${SHEETS_API_BASE}/${id}/values/${encodeURIComponent(headerRange(tabName))}?valueInputOption=RAW`,
        { method: 'PUT', headers: authJson, body: JSON.stringify({ values: [LEAD_HISTORY_HEADER_ROW] }) }
      );
      if (!headerRes.ok) throw new Error(`Header write failed: ${headerRes.status}`);

      // A deterrent, not a guarantee — the user owns the file and can always
      // edit or unprotect it. Never fatal.
      try {
        await fetch(`${SHEETS_API_BASE}/${id}:batchUpdate`, {
          method: 'POST',
          headers: authJson,
          body: JSON.stringify({
            requests: [
              {
                addProtectedRange: {
                  protectedRange: {
                    range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                    description: 'Lead history header',
                    warningOnly: true,
                  },
                },
              },
            ],
          }),
        });
      } catch (e) {
        console.warn('[History] header protection failed (non-fatal):', e);
      }

      await adopt(id, NEW_SHEET_TITLE, tabName);
      return { ok: true };
    } catch (e) {
      console.error('[History] create failed:', e);
      return { ok: false, reason: e instanceof Error ? e.message : 'create-failed' };
    }
  };

  // Picks an existing sheet. The tab is left unset on purpose: the user must
  // choose which worksheet receives the log rather than silently inheriting
  // sheets[0], which is how rows used to land in the wrong place.
  const pickSheet = async (): Promise<{ ok: boolean; reason?: string }> => {
    const picked = await openSheetPicker();
    if (!picked.ok) return { ok: false, reason: picked.reason };
    await adopt(picked.spreadsheetId, picked.spreadsheetName, '');
    return { ok: true };
  };

  return {
    spreadsheetId,
    spreadsheetName,
    sheetTabName,
    selectTab,
    tabs,
    tabsLoading,
    tabsError,
    syncError,
    sharedSource,
    configState,
    headerStatus,
    connected: Boolean(spreadsheetId),
    ready: Boolean(spreadsheetId && sheetTabName),
    refreshTabs: () => {
      if (spreadsheetId) fetchTabsFor(spreadsheetId);
    },
    createSheet,
    pickSheet,
  };
}
