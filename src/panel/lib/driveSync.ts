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
  error: 'message-failed',
};

// Asks the service worker for the current Drive sync state (last sync time,
// how many leads are still unsynced). The worker also piggybacks its "on open,
// sync if >24h stale" check onto this same call — see the GET_DRIVE_SYNC_STATE
// handler in service-worker.js — so simply calling this on mount is what makes
// that trigger fire. MV3 has no "user opened the extension" lifecycle hook.
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

// One map for every reason code this feature can produce, so no code path
// prints a raw slug. The ambient-error path used to interpolate the reason
// directly and would literally render "Sync failed: not-connected".
const REASON_MESSAGE: Record<string, string> = {
  'no-sheet': 'No history sheet yet — create one or choose an existing sheet below.',
  'no-tab': 'Choose which tab to log to before syncing.',
  'not-connected': 'Google access expired — reopen the panel to reconnect.',
  'already-syncing': 'A sync is already running.',
  'message-failed': "Couldn't reach the extension — try again.",
};

export function describeSyncReason(reason: string | null | undefined, error?: string): string {
  if (!reason) return error ?? 'Sync failed.';
  return REASON_MESSAGE[reason] ?? `Sync failed: ${error ?? reason}`;
}

// Turns a SYNC_TO_DRIVE response into UI-ready feedback for the button that
// triggered it — separate from DriveSyncState, which is the ambient
// (possibly background-driven) status shown the rest of the time.
export function describeSyncResult(result: SyncToDriveResult): { ok: boolean; text: string } {
  if (result.ok) {
    const n = result.syncedCount ?? 0;
    return { ok: true, text: n > 0 ? `Synced ${n} lead${n === 1 ? '' : 's'}.` : 'Already up to date.' };
  }
  return { ok: false, text: describeSyncReason(result.reason, result.error) };
}
