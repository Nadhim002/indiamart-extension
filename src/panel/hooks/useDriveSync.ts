import { useState, useEffect, useCallback, useRef } from 'react';
import type { DriveSyncState } from '@/types';
import { getDriveSyncState, syncToDrive, type SyncToDriveResult } from '@/lib/driveSync';

const INITIAL_STATE: DriveSyncState = {
  status: 'idle',
  lastDriveSyncAt: null,
  unsyncedCount: null,
  historySpreadsheetId: null,
  historySpreadsheetUrl: null,
  error: null,
};

// Mirrors useGoogleSheetsSettings' shape: hydrate on mount, then stay live
// via chrome.storage.onChanged so a background sync (the periodic alarm, or
// the on-open staleness check the mount call below triggers) updates the
// panel without polling.
export function useDriveSync() {
  const [state, setState] = useState<DriveSyncState>(INITIAL_STATE);
  const [busy, setBusy] = useState(false);
  // Outcome of the last *manual* "Sync now" click this panel session — kept
  // separate from `state`, which also reflects background syncs (the alarm,
  // the on-open check) and would otherwise overwrite this the moment either
  // of those runs.
  const [lastResult, setLastResult] = useState<SyncToDriveResult | null>(null);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(() => {
    getDriveSyncState().then(setState);
  }, []);

  useEffect(() => {
    refresh();

    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== 'local') return;
      if (changes.lastDriveSyncAt || changes.historySpreadsheetId || changes.historySpreadsheetUrl) {
        refresh();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refresh]);

  // While a sync is in flight (manual or background), poll briefly so the
  // "Syncing…" state clears promptly instead of waiting for the next
  // storage.onChanged event or panel remount.
  useEffect(() => {
    if (state.status !== 'syncing') {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = window.setInterval(refresh, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [state.status, refresh]);

  const sync = async () => {
    setBusy(true);
    setLastResult(null);
    setState((s) => ({ ...s, status: 'syncing' }));
    try {
      const result = await syncToDrive();
      setLastResult(result);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return { ...state, busy, lastResult, sync };
}
