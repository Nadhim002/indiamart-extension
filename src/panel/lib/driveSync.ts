import type { DriveSyncState } from '@/types';

export interface SyncToDriveResult {
  ok: boolean;
  reason?: string;
  syncedCount?: number;
  error?: string;
}

const FALLBACK_STATE: DriveSyncState = {
  status: 'error',
  lastDriveSyncAt: null,
  unsyncedCount: null,
  historySpreadsheetId: null,
  historySpreadsheetUrl: null,
  error: 'message-failed',
};

// Asks the service worker for the current Drive sync state (last sync time,
// how many leads are still unsynced, the history sheet's id/link). The
// worker also piggybacks its "on open, sync if >24h stale" check onto this
// same call — see the GET_DRIVE_SYNC_STATE handler in service-worker.js — so
// simply calling this on mount is what makes that trigger fire.
export function getDriveSyncState(): Promise<DriveSyncState> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_DRIVE_SYNC_STATE' }, (res: DriveSyncState | undefined) => {
      if (chrome.runtime.lastError || !res) {
        resolve(FALLBACK_STATE);
        return;
      }
      resolve(res);
    });
  });
}

// Manual "Sync now" — same routine the periodic alarm and on-open check run.
export function syncToDrive(): Promise<SyncToDriveResult> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'SYNC_TO_DRIVE' }, (res: SyncToDriveResult | undefined) => {
      if (chrome.runtime.lastError || !res) {
        resolve({ ok: false, reason: 'message-failed' });
        return;
      }
      resolve(res);
    });
  });
}

const REASON_MESSAGE: Record<string, string> = {
  'not-connected': 'Not connected — choose a Google Sheet above first.',
  'already-syncing': 'A sync is already running.',
  'message-failed': "Couldn't reach the extension — try again.",
};

// Turns a SYNC_TO_DRIVE response into UI-ready feedback for the button that
// triggered it — separate from DriveSyncState, which is the ambient
// (possibly background-driven) status shown the rest of the time.
export function describeSyncResult(result: SyncToDriveResult): { ok: boolean; text: string } {
  if (result.ok) {
    const n = result.syncedCount ?? 0;
    return { ok: true, text: n > 0 ? `Synced ${n} lead${n === 1 ? '' : 's'}.` : 'Already up to date.' };
  }
  const reason = result.reason ?? 'failed';
  return {
    ok: false,
    text: REASON_MESSAGE[reason] ?? `Sync failed: ${result.error ?? reason}`,
  };
}
