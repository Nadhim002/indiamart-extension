// Runs inside the manifest's `sandbox` page (picker-sandbox.html), which gets
// a relaxed CSP that can load Google's remotely-hosted Picker script — the
// extension's normal `script-src 'self'` CSP blocks that everywhere else.
// Sandboxed pages have no chrome.* access, so this talks to the panel purely
// via window.opener postMessage (see useGoogleSheetsSettings.ts pickSheet()).

declare const gapi: any;
declare const google: any;

type InitMessage = { type: 'PICKER_INIT'; token: string; developerKey: string };
type ResultMessage =
  | { type: 'PICKER_RESULT'; ok: true; spreadsheetId: string; spreadsheetName: string }
  | { type: 'PICKER_RESULT'; ok: false; reason: string };

const statusEl = document.getElementById('status')!;
const openerWindow = window.opener as Window | null;

function setStatus(text: string) {
  statusEl.textContent = text;
}

function postResult(msg: ResultMessage) {
  openerWindow?.postMessage(msg, '*');
}

function loadGapiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google API script'));
    document.head.appendChild(script);
  });
}

async function createNewSpreadsheet(token: string): Promise<{ id: string; name: string }> {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: 'IndiaMART Leads' } }),
  });
  if (!res.ok) throw new Error(`Sheet creation failed: ${res.status}`);
  const data = await res.json();
  return { id: data.spreadsheetId, name: data.properties?.title ?? 'Untitled spreadsheet' };
}

function openPicker(token: string, developerKey: string) {
  const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setMode(
    google.picker.DocsViewMode.LIST
  );

  const picker = new google.picker.PickerBuilder()
    .setOAuthToken(token)
    .setDeveloperKey(developerKey)
    .addView(view)
    .setCallback((data: any) => {
      if (data.action === google.picker.Action.PICKED) {
        const doc = data.docs[0];
        postResult({ type: 'PICKER_RESULT', ok: true, spreadsheetId: doc.id, spreadsheetName: doc.name });
        window.close();
      } else if (data.action === google.picker.Action.CANCEL) {
        postResult({ type: 'PICKER_RESULT', ok: false, reason: 'cancelled' });
        window.close();
      }
    })
    .build();

  setStatus('');
  const createBtn = document.createElement('button');
  createBtn.textContent = 'Create a new spreadsheet instead';
  createBtn.onclick = async () => {
    createBtn.disabled = true;
    setStatus('Creating spreadsheet…');
    try {
      const { id, name } = await createNewSpreadsheet(token);
      postResult({ type: 'PICKER_RESULT', ok: true, spreadsheetId: id, spreadsheetName: name });
      window.close();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Failed to create spreadsheet');
      createBtn.disabled = false;
    }
  };
  document.body.appendChild(createBtn);

  picker.setVisible(true);
}

async function init(token: string, developerKey: string) {
  try {
    setStatus('Loading picker…');
    await loadGapiScript();
    gapi.load('picker', () => openPicker(token, developerKey));
  } catch (e) {
    setStatus(e instanceof Error ? e.message : 'Failed to load picker');
    postResult({ type: 'PICKER_RESULT', ok: false, reason: 'load-failed' });
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== openerWindow) return;
  const data = event.data as InitMessage;
  if (data?.type === 'PICKER_INIT') {
    init(data.token, data.developerKey);
  }
});

if (!openerWindow) {
  setStatus('This page must be opened from the extension panel.');
} else {
  openerWindow.postMessage({ type: 'PICKER_SANDBOX_READY' }, '*');
}
