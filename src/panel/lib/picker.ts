import { FIREBASE_CONFIG } from '@shared/firebaseConfig';

// Hosted on Firebase Hosting rather than shipped as a manifest sandboxed
// page — Google's Picker library needs a real, non-opaque origin to validate
// its own cross-frame messages, which a sandboxed extension page (always
// opaque by design) can never provide.
//
// The page itself is deployed from the sibling admin-dashboard repo, not this
// one. Do not run `firebase deploy` from this repo: its firebase.json still
// points hosting at a directory that no longer exists and would replace the
// live picker with an empty site.
export const PICKER_ORIGIN = 'https://indiamart-extension-notifier.firebaseapp.com';
const PICKER_URL = `${PICKER_ORIGIN}/picker.html`;

export interface PickedSheet {
  spreadsheetId: string;
  spreadsheetName: string;
}

export type PickResult =
  | ({ ok: true } & PickedSheet)
  | { ok: false; reason?: string };

// Opens the hosted Google Picker and resolves once the user picks a file,
// creates one, or closes the window.
//
// Requires the side panel, not the toolbar popup: Chrome tears an action popup
// down the instant window.open steals focus, which destroys the message
// listener below before PICKER_RESULT can arrive.
//
// Shared by the lead-bought sheet and the lead-history sheet so there is one
// handshake to keep correct, not two. Note the picker page's own "Create new"
// button always titles the file "IndiaMART Leads" and the result carries no
// flag distinguishing created-from-picked — so callers must never rename what
// comes back, or they would silently rename a user's existing spreadsheet.
export function openSheetPicker(): Promise<PickResult> {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: true }, (result) => {
      // @types/chrome declares this as GetAuthTokenResult, but Chrome hands
      // back a bare token string. Accept either rather than betting on one.
      const raw = result as unknown as string | { token?: string } | undefined;
      const token = typeof raw === 'string' ? raw : raw?.token;
      if (chrome.runtime.lastError || !token) {
        resolve({ ok: false, reason: chrome.runtime.lastError?.message ?? 'No token granted' });
        return;
      }

      const pickerWindow = window.open(PICKER_URL, '_blank', 'width=1051,height=650');
      if (!pickerWindow) {
        resolve({ ok: false, reason: 'popup-blocked' });
        return;
      }

      let settled = false;
      const finish = (r: PickResult) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        window.clearInterval(closedPoll);
        resolve(r);
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
            finish({
              ok: true,
              spreadsheetId: data.spreadsheetId,
              spreadsheetName: data.spreadsheetName,
            });
          } else {
            finish({ ok: false, reason: data.reason });
          }
        }
      };
      window.addEventListener('message', onMessage);

      // Covers the user closing the window without picking anything —
      // otherwise the caller's "busy" state would hang forever.
      const closedPoll = window.setInterval(() => {
        if (pickerWindow.closed) finish({ ok: false, reason: 'cancelled' });
      }, 500);
    });
  });
}

// Shared reason→message mapping. `cancelled` maps to null: closing the picker
// is a deliberate user action, not an error, and printing the raw reason code
// is what used to surface the literal word "cancelled" to users.
const REASON_MESSAGE: Record<string, string> = {
  'popup-blocked': 'Popup blocked — allow popups for this extension.',
  'no-token': 'Google didn’t grant access — try again.',
  'No token granted': 'Google didn’t grant access — try again.',
};

export function describePickFailure(reason: string | undefined): string | null {
  if (reason === 'cancelled') return null;
  if (!reason) return 'Pick failed.';
  return REASON_MESSAGE[reason] ?? reason;
}
