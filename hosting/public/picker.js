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
    // Required for drive.file scope to actually grant access to files this
    // app did NOT create (e.g. picked from this DocsView list) — without it,
    // PICKED still fires with a real file id, but every later Sheets API
    // call against that id 404s because the per-file grant never registers.
    // Files created via createNewSpreadsheet() above don't need this, since
    // creation grants access unconditionally.
    .setAppId('797004741619')
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
  // Picker renders its own full-page overlay with a very high z-index once
  // visible, which sits on top of normal page content — without this, the
  // button is present in the DOM but unclickable underneath that overlay.
  createBtn.style.position = 'fixed';
  createBtn.style.top = '12px';
  createBtn.style.left = '12px';
  createBtn.style.zIndex = '2147483647';
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
  picker.setVisible(true);

  // Picker injects its own overlay asynchronously (it loads an iframe), so
  // appending right after setVisible() can still race it. With equal
  // z-index the later DOM element wins ties, so wait a beat before adding
  // ours last, to land after Picker's elements are actually in the DOM.
  setTimeout(() => document.body.appendChild(createBtn), 300);
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
