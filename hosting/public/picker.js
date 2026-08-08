// Hosted on Firebase Hosting (a real https:// origin) because Google's Picker
// library computes its own origin manually and requires a real, non-opaque
// origin to validate cross-frame messages — it cannot run inside a Chrome
// extension's manifest-sandboxed page, which is always opaque ('null') by
// design. The extension opens this page in a popup and talks to it purely
// via window.opener postMessage (see useGoogleSheetsSettings.ts pickSheet()).

const statusEl = document.getElementById('status');
const openerWindow = window.opener;

function setStatus(text) {
  statusEl.textContent = text;
}

function postResult(msg) {
  openerWindow.postMessage(msg, '*');
}

function loadGapiScript() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google API script'));
    document.head.appendChild(script);
  });
}

async function createNewSpreadsheet(token) {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: 'IndiaMART Leads' } }),
  });
  if (!res.ok) throw new Error(`Sheet creation failed: ${res.status}`);
  const data = await res.json();
  return { id: data.spreadsheetId, name: data.properties?.title ?? 'Untitled spreadsheet' };
}

function openPicker(token, developerKey) {
  const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setMode(
    google.picker.DocsViewMode.LIST
  );

  const picker = new google.picker.PickerBuilder()
    .setOAuthToken(token)
    .setDeveloperKey(developerKey)
    .addView(view)
    .setCallback((data) => {
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

async function init(token, developerKey) {
  try {
    setStatus('Loading picker…');
    await loadGapiScript();
    gapi.load('picker', () => openPicker(token, developerKey));
  } catch (e) {
    setStatus(e instanceof Error ? e.message : 'Failed to load picker');
    postResult({ type: 'PICKER_RESULT', ok: false, reason: 'load-failed' });
  }
}

window.addEventListener('message', (event) => {
  // event.source is a live reference to the sender window, not spoofable —
  // this proves the message came from whoever opened this popup via
  // window.open(). The origin check is defense in depth on top of that.
  if (event.source !== openerWindow) return;
  if (typeof event.origin !== 'string' || !event.origin.startsWith('chrome-extension://')) return;
  const data = event.data;
  if (data && data.type === 'PICKER_INIT') {
    init(data.token, data.developerKey);
  }
});

if (!openerWindow) {
  setStatus('This page must be opened from the Indiamart Lead Notifier extension.');
} else {
  openerWindow.postMessage({ type: 'PICKER_SANDBOX_READY' }, '*');
}
