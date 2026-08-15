import { useState, useEffect, useCallback, useRef } from 'react';
import type { DriveSyncState } from '@/types';
import { getDriveSyncState, syncToDrive, type SyncToDriveResult } from '@/lib/driveSync';

const INITIAL_STATE: DriveSyncState = {
  status: 'idle',
  lastDriveSyncAt: null,
  unsyncedCount: null,
  error: null,
};

// Owns *when* the sync runs and how it went — nothing about *which* sheet it
// writes to. That belongs to useHistorySheetSettings, which talks to Firebase
// directly the way useGoogleSheetsSettings does.
//
// Keeping them apart is the point: the destination used to be created by the
// sync itself, so a transient read failure was indistinguishable from "no
// sheet yet" and each computer quietly made its own duplicate spreadsheet.
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
      if (changes.lastDriveSyncAt) refresh();
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
      setLastResult(await syncToDrive());
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return { ...state, busy, lastResult, sync, refresh };
}
