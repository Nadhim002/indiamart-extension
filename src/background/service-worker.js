import { FIREBASE_CONFIG } from '@shared/firebaseConfig';
import { CHANNEL_BANNER } from '@shared/channels';
import { buildExpoMessage } from '@shared/pushPayload';
import { rejectionReason } from '@shared/leadPolicy';
import { sanitizeEmail } from '@shared/email';
import { getEntitlement } from '@shared/entitlement';
import { SHEET_HEADER_ROW, buildSheetRow, headerMatchesExpected } from '@shared/sheetsPayload';
import {
  LEAD_HISTORY_HEADER_ROW,
  buildLeadHistoryRow,
  historyHeaderMatches,
} from '@shared/leadHistoryPayload';

function getLocal(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setLocal(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

function getSession(keys) {
  return new Promise((resolve) => chrome.storage.session.get(keys, resolve));
}

function setSession(values) {
  return new Promise((resolve) => chrome.storage.session.set(values, resolve));
}

const INDIAMART_ORIGIN = 'https://seller.indiamart.com';

// How often (in timer cycles) the alarm handler re-validates entitlement.
const ENTITLEMENT_CHECK_INTERVAL = 5000;

function isIndiamartUrl(url) {
  if (!url) return false;
  try {
    return new URL(url).origin === INDIAMART_ORIGIN;
  } catch {
    return false;
  }
}

// Entitlement + device-seat gate for starting/continuing automation. Returns
// { ok } or { ok:false, reason }. Enforcement is client-side (see ADR); the
// admin email grants dashboard access only, so there is no bypass here.
async function checkRunAllowed() {
  const { googleEmail, googleIdToken, installId } = await getLocal([
    'googleEmail',
    'googleIdToken',
    'installId',
  ]);
  if (!googleEmail || !googleIdToken) return { ok: false, reason: 'no-account' };

  const entitlement = await getEntitlement(googleEmail, googleIdToken);
  if (!entitlement.valid) return { ok: false, reason: entitlement.reason };

  // This computer must hold a registered seat.
  try {
    const key = sanitizeEmail(googleEmail);
    const res = await fetch(
      `${FIREBASE_CONFIG.databaseURL}/accounts/${key}/computers.json?auth=${googleIdToken}`
    );
    if (res.ok) {
      const computers = (await res.json()) || {};
      if (!installId || !computers[installId]) return { ok: false, reason: 'device-limit' };
    }
  } catch (e) {
    // Assume Firebase is up; a rare transient error shouldn't block a valid sub.
    console.warn('[Entitlement] seat check failed, allowing:', e);
  }
  return { ok: true };
}

async function sendLeadNotifications(purchasedLeads) {
  const { registeredDevices = [], googleEmail, googleIdToken } = await getLocal([
    'registeredDevices',
    'googleEmail',
    'googleIdToken',
  ]);

  if (!googleEmail || !googleIdToken) {
    console.warn('[FCM] Not signed in — skipping notifications');
    return;
  }

  if (registeredDevices.length === 0) {
    console.warn('[FCM] No registered phones — skipping notifications');
  }

  const DB_URL = FIREBASE_CONFIG.databaseURL;
  const accountKey = sanitizeEmail(googleEmail);

  for (const lead of purchasedLeads) {
    const payload = {
      title: lead.ETO_OFR_TITLE ?? 'New Lead',
      buyerName: lead.buyerName ?? null,
      buyerMobile: lead.buyerMobile ?? null,
      quantity: lead.quantity != null ? String(lead.quantity) : null,
      price: lead.ETO_OFR_APPROX_ORDER_VALUE ?? null,
      city: lead.GLUSR_CITY ?? null,
      state: lead.GLUSR_STATE ?? null,
      timestamp: Date.now(),
    };

    // Write to Firebase so phone's real-time listener also picks it up
    try {
      await fetch(`${DB_URL}/accounts/${accountKey}/leads/new.json?auth=${googleIdToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error('[Firebase] Failed to write lead:', e);
    }

    // Push via Expo to each registered phone (covers killed-app state).
    // The message shape lives in one place — @shared/pushPayload.
    // NOTE: this fetch only works because https://exp.host/* is in the
    // manifest host_permissions — without it Chrome CORS-blocks the request.
    const body = [lead.buyerName, lead.GLUSR_CITY, lead.GLUSR_STATE].filter(Boolean).join(' — ') || 'New lead purchased!';
    const deadTokens = [];
    await Promise.all(
      registeredDevices.map(async ({ token, notificationStyle }) => {
        const isPhonecall = notificationStyle === 'phonecall';
        const expoMessage = buildExpoMessage({
          token,
          notificationStyle,
          title: payload.title,
          body,
          payload,
        });
        try {
          const res = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(expoMessage),
          });
          const data = await res.json();
          const ticket = data?.data;
          if (ticket?.status === 'error') {
            console.warn('[FCM] Expo rejected', token.slice(0, 30) + '...', ticket.message, ticket.details);
            // Dead token — the install is gone/reinstalled. Queue it for pruning.
            if (ticket.details?.error === 'DeviceNotRegistered') deadTokens.push(token);
          } else {
            console.log('[FCM] Sent to', token.slice(0, 30) + '...', isPhonecall ? 'phonecall(data-only)' : `banner(${CHANNEL_BANNER})`, ticket);
          }
        } catch (e) {
          console.error('[FCM] Failed to send to', token.slice(0, 20), e);
        }
      })
    );
    if (deadTokens.length > 0) {
      await pruneDeadTokens(DB_URL, accountKey, googleIdToken, deadTokens);
    }
  }
}

// Remove phones whose Expo token Expo reports as DeviceNotRegistered (the
// install was removed/reinstalled). The app re-registers itself on next launch
// (see usePhoneDevices), so this is self-healing and keeps the roster + seat
// count accurate instead of endlessly pushing to a dead token.
async function pruneDeadTokens(dbUrl, accountKey, idToken, deadTokens) {
  try {
    const res = await fetch(`${dbUrl}/accounts/${accountKey}/phones.json?auth=${idToken}`);
    const phones = (await res.json()) || {};
    const dead = new Set(deadTokens);
    await Promise.all(
      Object.entries(phones)
        .filter(([, p]) => p && dead.has(p.fcmToken))
        .map(([deviceId]) =>
          fetch(`${dbUrl}/accounts/${accountKey}/phones/${deviceId}.json?auth=${idToken}`, { method: 'DELETE' })
            .then(() => console.log('[FCM] Pruned dead phone token for device', deviceId))
            .catch((e) => console.error('[FCM] Prune failed for', deviceId, e))
        )
    );
  } catch (e) {
    console.error('[FCM] Could not prune dead tokens:', e);
  }
}

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// The fixed placeholder buyer mobile runRealLeadTest() always uses — the one
// signal that reliably marks a lead as a test/dummy rather than a real
// purchase, since no real buyer plausibly has this exact number.
const DUMMY_BUYER_MOBILE = '9000000000';

// Resolves the cached OAuth token for the drive.file scope, or null if the
// user hasn't picked a sheet yet (or the grant was revoked). Never prompts —
// the interactive grant only happens from the panel's "Choose sheet" button.
function getSheetsAccessToken() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) {
        console.warn('[Sheets] No cached token — not connected:', chrome.runtime.lastError?.message);
        resolve(null);
        return;
      }
      resolve(token);
    });
  });
}

// Makes sure the named tab exists (creating it if not) and that its header
// row is populated (writing it once if the tab is empty), so a first-time
// user doesn't have to set anything up in the spreadsheet by hand.
async function ensureTabAndHeader(token, spreadsheetId, tabName) {
  const authHeaders = { Authorization: `Bearer ${token}` };

  const metaRes = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: authHeaders }
  );
  if (!metaRes.ok) throw new Error(`Sheet metadata fetch failed: ${metaRes.status}`);
  const meta = await metaRes.json();
  const tabExists = (meta.sheets || []).some((s) => s.properties?.title === tabName);

  if (!tabExists) {
    const createRes = await fetch(`${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }),
    });
    if (!createRes.ok) throw new Error(`Tab creation failed: ${createRes.status}`);
  }

  const range = `${tabName}!A1:${String.fromCharCode(65 + SHEET_HEADER_ROW.length - 1)}1`;
  const headerRes = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: authHeaders }
  );
  if (!headerRes.ok) throw new Error(`Header check failed: ${headerRes.status}`);
  const headerData = await headerRes.json();

  if (!headerData.values || headerData.values.length === 0) {
    const writeHeaderRes = await fetch(
      `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [SHEET_HEADER_ROW] }),
      }
    );
    if (!writeHeaderRes.ok) throw new Error(`Header write failed: ${writeHeaderRes.status}`);
  } else if (!headerMatchesExpected(headerData.values[0])) {
    // Warn, don't block — the panel already surfaces this same mismatch as
    // a non-blocking warning at tab-selection time, and this is just the
    // write-path's safety net in case the header changed after selection.
    console.warn(
      `[Sheets] Tab "${tabName}" header doesn't match the expected columns — leads may land misaligned.`,
      headerData.values[0]
    );
  }
}

// Writes every lead bought this tick to the user's configured Google Sheet
// tab, as one batched append. Fire-and-forget like every other external call
// in this file (Firebase, Expo) — a failure here must never block or affect
// the phone-notification path.
async function writeLeadsToSheet(purchasedLeads) {
  const { spreadsheetId, sheetTabName } = await resolveLeadSheet();
  if (!spreadsheetId || !sheetTabName) return;

  const token = await getSheetsAccessToken();
  if (!token) return;

  try {
    await ensureTabAndHeader(token, spreadsheetId, sheetTabName);

    const range = `${sheetTabName}!A1`;
    const appendRes = await fetch(
      `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: purchasedLeads.map(buildSheetRow) }),
      }
    );
    if (!appendRes.ok) throw new Error(`Append failed: ${appendRes.status}`);
  } catch (e) {
    console.error('[Sheets] Failed to write leads:', e);
  }
}

// Deletes every lead identified as a test/dummy (DUMMY_BUYER_MOBILE) from
// Firebase and from the currently-connected Sheets tab. The two sides are
// independent — a failure or a "not connected" skip on one must not block
// or hide the other's result.
async function deleteDummyLeads() {
  const result = { firebaseDeleted: null, sheetsDeleted: null, errors: [] };

  const { googleEmail, googleIdToken } = await getLocal(['googleEmail', 'googleIdToken']);
  const { spreadsheetId, sheetTabName } = await resolveLeadSheet();

  if (googleEmail && googleIdToken) {
    try {
      const DB_URL = FIREBASE_CONFIG.databaseURL;
      const accountKey = sanitizeEmail(googleEmail);
      const res = await fetch(`${DB_URL}/accounts/${accountKey}/leads/new.json?auth=${googleIdToken}`);
      if (!res.ok) throw new Error(`Firebase fetch failed: ${res.status}`);
      const leads = (await res.json()) || {};
      const dummyKeys = Object.entries(leads)
        .filter(([, lead]) => lead && lead.buyerMobile === DUMMY_BUYER_MOBILE)
        .map(([key]) => key);
      await Promise.all(
        dummyKeys.map((key) =>
          fetch(`${DB_URL}/accounts/${accountKey}/leads/new/${key}.json?auth=${googleIdToken}`, {
            method: 'DELETE',
          })
        )
      );
      result.firebaseDeleted = dummyKeys.length;
    } catch (e) {
      console.error('[Cleanup] Firebase dummy-lead delete failed:', e);
      result.errors.push('Firebase: ' + (e instanceof Error ? e.message : String(e)));
    }
  } else {
    result.errors.push('Firebase: not signed in — skipped.');
  }

  if (spreadsheetId && sheetTabName) {
    try {
      const token = await getSheetsAccessToken();
      if (!token) throw new Error('Not connected — reconnect the sheet.');

      const metaRes = await fetch(
        `${SHEETS_API_BASE}/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!metaRes.ok) throw new Error(`Sheet metadata fetch failed: ${metaRes.status}`);
      const meta = await metaRes.json();
      const tab = (meta.sheets || []).find((s) => s.properties?.title === sheetTabName);
      if (!tab) throw new Error('Tab not found — reconnect the sheet.');
      const gid = tab.properties.sheetId;

      // Only the Buyer Mobile column is needed to find matching rows — one
      // narrow column read is far cheaper than pulling every column.
      const mobileCol = String.fromCharCode(65 + SHEET_HEADER_ROW.indexOf('Buyer Mobile'));
      const colRange = `${sheetTabName}!${mobileCol}2:${mobileCol}`;
      const colRes = await fetch(
        `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(colRange)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!colRes.ok) throw new Error(`Column fetch failed: ${colRes.status}`);
      const colData = await colRes.json();
      const values = colData.values || [];

      // Fetched starting at row 2 (skipping the header), so data row `i`
      // (0-based array index) sits at 0-based sheet row index `i + 1`.
      const matchingRowIndexes = [];
      values.forEach((row, i) => {
        if (row[0] === DUMMY_BUYER_MOBILE) matchingRowIndexes.push(i + 1);
      });

      if (matchingRowIndexes.length > 0) {
        // Descending order: batchUpdate applies requests in array order and
        // reindexes after each delete, so deleting bottom-up in one call
        // keeps earlier deletions from shifting the rows still to come.
        const requests = matchingRowIndexes
          .sort((a, b) => b - a)
          .map((rowIndex) => ({
            deleteDimension: {
              range: { sheetId: gid, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
            },
          }));
        const batchRes = await fetch(`${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests }),
        });
        if (!batchRes.ok) throw new Error(`Row delete failed: ${batchRes.status}`);
      }
      result.sheetsDeleted = matchingRowIndexes.length;
    } catch (e) {
      console.error('[Cleanup] Sheets dummy-lead delete failed:', e);
      result.errors.push('Sheets: ' + (e instanceof Error ? e.message : String(e)));
    }
  } else {
    result.errors.push('Sheets: no sheet connected — skipped.');
  }

  return result;
}

// One-shot "real lead" test: run the real fetch (no filtering, no purchase),
// take the first lead, and deliver a notification with its real details but a
// placeholder buyer (name "Test Buyer", phone 9000000000). Reuses
// sendLeadNotifications so it exercises BOTH the Firebase write and the Expo
// push — but deliberately skips the IndexedDB upsert and never touches the
// running-timer globals. Returns { ok } or { ok:false, reason }.
async function runRealLeadTest(tabId) {
  const { googleEmail, googleIdToken } = await getLocal(['googleEmail', 'googleIdToken']);
  if (!googleEmail || !googleIdToken) return { ok: false, reason: 'not-signed-in' };
  if (!tabId) return { ok: false, reason: 'no-tab' };

  const injected = await new Promise((resolve) => {
    chrome.scripting.executeScript(
      { target: { tabId }, files: ['utils-inject.js'], world: 'MAIN' },
      () => {
        if (chrome.runtime.lastError) {
          console.error('[Test] inject helper error:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        chrome.scripting.executeScript(
          {
            target: { tabId },
            world: 'MAIN',
            args: [null, null, false], // no filters, no phone, buying OFF
            func: injectedFetchAndBuy,
          },
          (results) => {
            if (chrome.runtime.lastError || !results || !results[0] || results[0].error) {
              resolve(null);
              return;
            }
            resolve(results[0].result);
          }
        );
      }
    );
  });

  if (!injected || !Array.isArray(injected.mappedData)) return { ok: false, reason: 'fetch-failed' };
  const first = injected.mappedData[0];
  if (!first) return { ok: false, reason: 'no-lead' };

  const now = new Date();
  const record = {
    ETO_OFR_ID: first.ETO_OFR_ID,
    ETO_OFR_TITLE: first.ETO_OFR_TITLE,
    ETO_OFR_APPROX_ORDER_VALUE: first.ETO_OFR_APPROX_ORDER_VALUE,
    quantity: first.quantity,
    GLUSR_CITY: first.GLUSR_CITY,
    GLUSR_STATE: first.GLUSR_STATE,
    buyerName: 'Test Buyer',
    buyerMobile: DUMMY_BUYER_MOBILE,
    boughtDate: now.toISOString().slice(0, 10),
    boughtTime: now.toTimeString().slice(0, 8),
  };
  await sendLeadNotifications([record]);
  await writeLeadsToSheet([record]);
  return { ok: true };
}


const DB_NAME = 'indiamart_leads';
const DB_VERSION = 2;
const STORE_NAME = 'leads';

// firstSeenDate/firstSeenTime have always been stored as separate local-time
// strings (see the write site below) with no timezone attached. Used only for
// the one-time v1->v2 backfill of firstSeenAtMs on pre-existing rows — new
// records get it directly from Date.now(), so this is a one-shot best-effort
// reconstruction, not something new code should ever need again.
function parseLocalDateTimeToMs(dateStr, timeStr) {
  if (!dateStr) return null;
  const iso = timeStr ? `${dateStr}T${timeStr}` : `${dateStr}T00:00:00`;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function openLeadsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? e.target.transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'ETO_OFR_ID' });

      if (e.oldVersion < 2) {
        // IndexedDB can't index `undefined`, so 0 is the "not yet synced to
        // Drive" sentinel used throughout — see syncedAt below.
        if (!store.indexNames.contains('syncedAt')) {
          store.createIndex('syncedAt', 'syncedAt');
        }

        // Backfill every pre-existing row so the very first Drive sync
        // pushes the complete history instead of starting from a blank slate.
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return;
          const record = cursor.value;
          if (record.firstSeenAtMs == null) {
            record.firstSeenAtMs = parseLocalDateTimeToMs(record.firstSeenDate, record.firstSeenTime);
          }
          if (record.syncedAt == null) {
            record.syncedAt = 0;
          }
          cursor.update(record);
          cursor.continue();
        };
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function upsertLead(record) {
  const db = await openLeadsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(record.ETO_OFR_ID);
    getReq.onsuccess = (e) => {
      const existing = e.target.result;
      if (!existing) {
        store.put(record);
      } else if (record.reasons === 'Purchased' && existing.reasons !== 'Purchased') {
        existing.reasons = 'Purchased';
        store.put(existing);
      }
    };
    getReq.onerror = (e) => reject(e.target.error);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// Learn the real IndiaMART city spellings by harvesting them from leads as they
// arrive. The panel's City filter offers only these observed cities, so the
// user picks from correctly-spelled options instead of guessing.
//
// This touches only the current batch (already in memory), never the whole log:
// one small read of knownCities per cycle, and a write ONLY when a never-seen
// city appears — which is rare once the list is warm.
async function harvestCities(leads) {
  const seen = leads.map((l) => (l.GLUSR_CITY || '').trim()).filter(Boolean);
  if (seen.length === 0) return;
  const { knownCities = [] } = await getLocal(['knownCities']);
  const set = new Set(knownCities);
  let changed = false;
  for (const city of seen) {
    if (!set.has(city)) {
      set.add(city);
      changed = true;
    }
  }
  if (!changed) return;
  const sorted = Array.from(set).sort((a, b) => a.localeCompare(b));
  await new Promise((resolve) => chrome.storage.local.set({ knownCities: sorted }, resolve));
}

async function getAllLeads() {
  const db = await openLeadsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

// ---------------------------------------------------------------------------
// Drive sync — pushes the lead history log to a dedicated, per-user Google
// Sheet ("IndiaMART Lead History") in the user's own Drive, so a separate
// analytics web app can read it. Reuses the drive.file grant + Sheets API
// already wired up for the purchased-leads sheet, but is otherwise fully
// independent of it: separate spreadsheet, separate storage keys, separate
// failure path. A sync failure here must never affect lead buying.
// ---------------------------------------------------------------------------

const DRIVE_SYNC_CHUNK_SIZE = 500;
const DRIVE_SYNC_STALE_MS = 24 * 60 * 60 * 1000;

let driveSyncInFlight = false;
let driveSyncLastError = null;
// In-memory only — re-verified against the API on the first call after every
// worker restart. Avoids repeating the metadata-fetch-on-every-write mistake
// the purchased-leads path makes (ensureTabAndHeader runs on every write).
let historySpreadsheetCache = null;

function getOrCreateInstallId() {
  return getLocal(['installId']).then(({ installId }) => {
    if (installId) return installId;
    const id = crypto.randomUUID();
    return setLocal({ installId: id }).then(() => id);
  });
}

// chrome.storage.local is per-Chrome-profile, not shared across computers —
// so the pointer to which spreadsheet is "the" history sheet has to live
// somewhere actually shared per account. Firebase RTDB already is (same
// place computers/phones/leads live), so it's the broker: whichever computer
// creates the spreadsheet first publishes its id here, and every other
// computer checks here before ever considering creating its own. Without
// this, each computer would create its own separate spreadsheet the first
// time it synced, defeating the point of a shared history sheet entirely.
// The worker used to borrow googleIdToken from chrome.storage.local, but the
// only writer of that key is the panel's onIdTokenChanged — which stops the
// moment the panel closes. Firebase ID tokens last an hour while Drive Sync
// runs on a 24h alarm, so background RTDB calls almost always carried a dead
// token: reads 401'd, returned null, and a second computer concluded no shared
// history sheet existed and created its own.
//
// Mint one here instead. chrome.identity already yields a Google access token
// carrying openid/email/profile (manifest oauth2.scopes), and Firebase will
// exchange that for an ID token — so the worker no longer depends on the panel
// ever having been open.
let firebaseCredsCache = null; // { idToken, email, expiresAt }

async function getFirebaseCreds({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && firebaseCredsCache && firebaseCredsCache.expiresAt > now) {
    return firebaseCredsCache;
  }

  const accessToken = await getSheetsAccessToken();
  if (accessToken) {
    try {
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_CONFIG.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            postBody: `access_token=${accessToken}&providerId=google.com`,
            requestUri: `https://${FIREBASE_CONFIG.authDomain}`,
            returnSecureToken: true,
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.idToken && data.email) {
          firebaseCredsCache = {
            idToken: data.idToken,
            email: data.email,
            // Expire two minutes early so a slow call can't straddle the edge.
            expiresAt: now + (Number(data.expiresIn) || 3600) * 1000 - 120_000,
          };
          // Mirror to storage: entitlement, push and the seat check still read
          // these keys directly, and they were going stale for the same reason.
          await setLocal({
            googleIdToken: data.idToken,
            googleEmail: data.email,
            sanitizedEmail: sanitizeEmail(data.email),
          });
          return firebaseCredsCache;
        }
      } else {
        console.warn('[Auth] Firebase token exchange failed:', res.status);
      }
    } catch (e) {
      console.warn('[Auth] Firebase token exchange threw:', e);
    }
  }

  // Fall back to whatever the panel last stored — no worse than before.
  const { googleEmail, googleIdToken } = await getLocal(['googleEmail', 'googleIdToken']);
  if (!googleEmail || !googleIdToken) return null;
  return { idToken: googleIdToken, email: googleEmail, expiresAt: 0 };
}

// RTDB REST call under accounts/{email}/, re-minting the token once on 401.
// Returns the Response so callers can distinguish "denied" from "absent" —
// conflating those is what made every failure look like "no sheet yet".
async function rtdbFetch(path, init) {
  let creds = await getFirebaseCreds();
  if (!creds) return null;
  const url = (c) =>
    `${FIREBASE_CONFIG.databaseURL}/accounts/${sanitizeEmail(c.email)}/${path}.json?auth=${c.idToken}`;
  let res = await fetch(url(creds), init);
  if (res.status === 401) {
    creds = await getFirebaseCreds({ forceRefresh: true });
    if (!creds) return null;
    res = await fetch(url(creds), init);
  }
  return res;
}

// Both sheet pointers are owned by the panel, which writes them with the
// Firebase SDK (useGoogleSheetsSettings / useHistorySheetSettings). The worker
// only ever reads them, and never creates a spreadsheet: it used to create the
// history sheet whenever it couldn't resolve one, which made a denied read
// indistinguishable from "no sheet configured" and produced a duplicate
// spreadsheet per computer.
async function getSharedSheetPointer(node, label) {
  try {
    const res = await rtdbFetch(node);
    if (!res) return null;
    if (!res.ok) {
      console.warn(`[${label}] Shared pointer read failed:`, res.status);
      return null;
    }
    const data = await res.json();
    return data?.spreadsheetId ? data : null;
  } catch (e) {
    console.warn(`[${label}] Firebase lookup failed (non-fatal):`, e);
    return null;
  }
}

// Resolves the history sheet to append to, preferring the Firebase-shared
// pointer over this device's copy and keeping the local copy in step so the
// panel doesn't lag behind a choice made on another computer. Returns null
// when nothing is configured — the caller must not invent a sheet.
async function resolveHistorySheet() {
  const shared = await getSharedSheetPointer('driveSync', 'History');
  if (shared?.spreadsheetId) {
    const local = await getLocal([
      'historySpreadsheetId',
      'historySpreadsheetName',
      'historySheetTabName',
    ]);
    // RTDB omits null-valued keys, so an older node may lack either field.
    const name = shared.spreadsheetName ?? '';
    const tabName = shared.sheetTabName ?? '';
    if (
      shared.spreadsheetId !== local.historySpreadsheetId ||
      name !== local.historySpreadsheetName ||
      tabName !== local.historySheetTabName
    ) {
      await setLocal({
        historySpreadsheetId: shared.spreadsheetId,
        historySpreadsheetName: name,
        historySheetTabName: tabName,
      });
    }
    return { spreadsheetId: shared.spreadsheetId, sheetTabName: tabName };
  }
  const local = await getLocal(['historySpreadsheetId', 'historySheetTabName']);
  if (!local.historySpreadsheetId) return null;
  return {
    spreadsheetId: local.historySpreadsheetId,
    sheetTabName: local.historySheetTabName ?? '',
  };
}

// The lead-bought sheet is picked from the panel (which writes this node
// directly via the Firebase SDK — see useGoogleSheetsSettings.ts), but this
// device's own chrome.storage.local copy can be stale if another computer
// picked a different sheet more recently. Same shared-pointer rationale as
// resolveHistorySheet above, just for a different node.
function getSharedLeadSheet() {
  return getSharedSheetPointer('leadSheet', 'Sheets');
}

// Resolves the lead-bought sheet to write to, preferring the Firebase-shared
// pointer over this device's own copy and keeping the local copy in step
// (same pattern as resolveHistorySheet) so the panel doesn't lag behind
// a pick made on another computer.
async function resolveLeadSheet() {
  const shared = await getSharedLeadSheet();
  if (shared?.spreadsheetId) {
    const local = await getLocal(['spreadsheetId', 'spreadsheetName', 'sheetTabName']);
    // RTDB omits keys whose value is null, so a node written before
    // spreadsheetName existed comes back without it — coerce both optional
    // fields rather than writing undefined into chrome.storage.local.
    const sharedTabName = shared.sheetTabName ?? '';
    const sharedName = shared.spreadsheetName ?? '';
    if (
      shared.spreadsheetId !== local.spreadsheetId ||
      sharedName !== local.spreadsheetName ||
      sharedTabName !== local.sheetTabName
    ) {
      await setLocal({
        spreadsheetId: shared.spreadsheetId,
        spreadsheetName: sharedName,
        sheetTabName: sharedTabName,
      });
    }
    return { spreadsheetId: shared.spreadsheetId, sheetTabName: sharedTabName };
  }
  return getLocal(['spreadsheetId', 'sheetTabName']);
}

function removeCachedAuthToken(token) {
  return new Promise((resolve) => {
    if (!token) {
      resolve();
      return;
    }
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

// Throws a tagged error on 401 (carrying the token that failed, for the
// retry-once path in syncLeadsToDrive) and a plain error on any other
// non-OK status. There is no other self-healing path for a stale/revoked
// cached token anywhere in this file, which is tolerable for a
// user-initiated click but not for an unattended 24h background sync.
function assertOk(res, context, token) {
  if (res.status === 401) {
    const err = new Error(`${context}: 401`);
    err.isAuthError = true;
    err.authToken = token;
    throw err;
  }
  if (!res.ok) throw new Error(`${context}: ${res.status}`);
}

// Makes sure the chosen tab exists and carries the history header, mirroring
// ensureTabAndHeader for the purchased-leads sheet. This is the write-path
// safety net the history sync never had: previously the header was validated
// once, at adopt time, and every append after that went in blind.
//
// Deliberately never creates a *spreadsheet*. Creation is an explicit user
// action in the panel (useHistorySheetSettings.createSheet). The old code
// created one here whenever it couldn't resolve a pointer, which made a denied
// RTDB read indistinguishable from "no sheet configured" and produced a
// duplicate spreadsheet on every computer.
async function ensureHistoryTabAndHeader(token, spreadsheetId, tabName) {
  if (historySpreadsheetCache && historySpreadsheetCache.id === spreadsheetId
      && historySpreadsheetCache.tabName === tabName) {
    return historySpreadsheetCache;
  }

  const authHeaders = { Authorization: `Bearer ${token}` };
  const metaRes = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}?fields=properties.title,sheets.properties(sheetId,title)`,
    { headers: authHeaders }
  );
  // 404 means the file is gone. Surface it rather than silently making a new
  // one — the panel offers "New sheet" and "Choose existing" for exactly this.
  if (metaRes.status === 404) {
    const err = new Error('History sheet no longer exists');
    err.reason = 'sheet-missing';
    throw err;
  }
  assertOk(metaRes, 'History sheet metadata fetch failed', token);
  const meta = await metaRes.json();

  let sheet = (meta.sheets || []).find((s) => s.properties?.title === tabName);
  if (!sheet) {
    const addRes = await fetch(`${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }),
    });
    assertOk(addRes, 'History tab creation failed', token);
    const added = await addRes.json();
    sheet = { properties: added.replies?.[0]?.addSheet?.properties ?? { sheetId: 0, title: tabName } };
  }

  const range = `${tabName}!A1:${String.fromCharCode(65 + LEAD_HISTORY_HEADER_ROW.length - 1)}1`;
  const headerRes = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: authHeaders }
  );
  assertOk(headerRes, 'History header check failed', token);
  const headerData = await headerRes.json();

  if (!headerData.values || headerData.values.length === 0) {
    const writeRes = await fetch(
      `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [LEAD_HISTORY_HEADER_ROW] }),
      }
    );
    assertOk(writeRes, 'History header write failed', token);
  } else if (!historyHeaderMatches(headerData.values[0])) {
    // Warn, don't block — the panel surfaces the same mismatch at tab-selection
    // time, and overwriting a header the user put there would be worse than a
    // visible misalignment they can fix.
    console.warn(
      `[History] Tab "${tabName}" header doesn't match the expected columns — rows may land misaligned.`,
      headerData.values[0]
    );
  }

  historySpreadsheetCache = {
    id: spreadsheetId,
    sheetId: sheet.properties?.sheetId ?? 0,
    tabName,
  };
  // Keep the local mirror honest about the file's current name, which is what
  // the panel's "open sheet" link and label read.
  await setLocal({
    historySpreadsheetId: spreadsheetId,
    historySpreadsheetName: meta.properties?.title ?? '',
    historySheetTabName: tabName,
  });
  return historySpreadsheetCache;
}

// Reads up to `limit` not-yet-synced records via the syncedAt index — never
// the full store, since that's exactly what doesn't scale once history
// reaches thousands of rows (see getAllLeads, which does load everything and
// is fine for the once-in-a-while CSV export but not for a routine sync).
function getUnsyncedLeadsChunk(limit) {
  return openLeadsDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const index = tx.objectStore(STORE_NAME).index('syncedAt');
        const results = [];
        const req = index.openCursor(IDBKeyRange.only(0));
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor || results.length >= limit) {
            resolve(results);
            return;
          }
          results.push(cursor.value);
          cursor.continue();
        };
        req.onerror = (e) => reject(e.target.error);
      })
  );
}

// Marks a chunk as synced in one transaction, AFTER its append already
// succeeded. This is what makes a killed mid-backfill worker resumable: MV3
// workers get terminated aggressively, and pushing thousands of backfilled
// rows will rarely finish in one lifetime. Re-running just continues from
// whatever the syncedAt index still reports as unsynced — no lost or
// duplicated rows.
function markLeadsSynced(records, syncedAt) {
  return openLeadsDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const record of records) {
          record.syncedAt = syncedAt;
          store.put(record);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      })
  );
}

// Clears every syncedAt marker so the next sync re-sends the full history.
// The markers are per-lead, not per-destination, so when the history sheet
// changes a new sheet would otherwise silently start mid-history — the user
// would be left holding two partial logs with no indication why.
function resetSyncMarkers() {
  return openLeadsDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          const record = cursor.value;
          if (record.syncedAt !== 0) {
            record.syncedAt = 0;
            cursor.update(record);
          }
          cursor.continue();
        };
        // Resolve on transaction completion, not cursor exhaustion, so the
        // queued cursor.update writes are actually flushed first.
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      })
  );
}
function getUnsyncedCount() {
  return openLeadsDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const index = tx.objectStore(STORE_NAME).index('syncedAt');
        const req = index.count(IDBKeyRange.only(0));
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
      })
  );
}

// A lead promoted to 'Purchased' after it's already synced is deliberately
// left stale in the sheet (a user decision) — this file never clears
// syncedAt on an existing record, so no re-sync happens for it.
async function runDriveSyncOnce() {
  // Resolve the destination before asking for a token: with no sheet chosen
  // there is nothing to do, and this is the path that used to silently create
  // one. Both are ordinary "not set up yet" states, not failures.
  const pointer = await resolveHistorySheet();
  if (!pointer?.spreadsheetId) return { ok: false, reason: 'no-sheet' };
  if (!pointer.sheetTabName) return { ok: false, reason: 'no-tab' };

  const token = await getSheetsAccessToken();
  if (!token) return { ok: false, reason: 'not-connected' };

  const sheet = await ensureHistoryTabAndHeader(
    token,
    pointer.spreadsheetId,
    pointer.sheetTabName
  );
  const deviceId = await getOrCreateInstallId();

  let totalSynced = 0;
  for (;;) {
    const chunk = await getUnsyncedLeadsChunk(DRIVE_SYNC_CHUNK_SIZE);
    if (chunk.length === 0) break;

    const range = `${sheet.tabName}!A1`;
    const appendRes = await fetch(
      `${SHEETS_API_BASE}/${sheet.id}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: chunk.map((lead) => buildLeadHistoryRow(lead, deviceId)) }),
      }
    );
    assertOk(appendRes, 'History append failed', token);

    await markLeadsSynced(chunk, Date.now());
    totalSynced += chunk.length;
  }

  await setLocal({ lastDriveSyncAt: Date.now() });
  return { ok: true, syncedCount: totalSynced };
}

// Entry point for every trigger (manual button, periodic alarm, on-open
// staleness check). Guards against overlapping runs, and retries exactly
// once on a 401 by clearing the stale cached token and re-fetching — the one
// failure mode background sync can't just leave silent, since there's no
// user around to click "reconnect."
async function syncLeadsToDrive() {
  if (driveSyncInFlight) return { ok: false, reason: 'already-syncing' };
  driveSyncInFlight = true;
  try {
    const result = await runDriveSyncOnce();
    driveSyncLastError = result.ok ? null : result.reason;
    return result;
  } catch (e) {
    if (e && e.isAuthError) {
      try {
        await removeCachedAuthToken(e.authToken);
        const result = await runDriveSyncOnce();
        driveSyncLastError = result.ok ? null : result.reason;
        return result;
      } catch (e2) {
        console.error('[DriveSync] failed after token retry:', e2);
        driveSyncLastError = e2 instanceof Error ? e2.message : String(e2);
        return { ok: false, reason: 'failed', error: driveSyncLastError };
      }
    }
    console.error('[DriveSync] failed:', e);
    driveSyncLastError = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: 'failed', error: driveSyncLastError };
  } finally {
    driveSyncInFlight = false;
  }
}

// The panel's "on open" trigger. MV3 workers have no lifecycle hook for
// "the user opened the extension" — the panel calling GET_DRIVE_SYNC_STATE on
// mount is the only reliable wake signal, so that handler calls this.
async function maybeStartDriveSync() {
  if (driveSyncInFlight) return;
  const { lastDriveSyncAt } = await getLocal(['lastDriveSyncAt']);
  if (lastDriveSyncAt && Date.now() - lastDriveSyncAt < DRIVE_SYNC_STALE_MS) return;
  await syncLeadsToDrive();
}

async function getDriveSyncState() {
  // Carries no sheet pointer. Which spreadsheet the history goes to is the
  // panel's business, read live from RTDB by useHistorySheetSettings — this
  // used to report the local mirror, so the panel could not actually tell
  // whether the account had a sheet configured at all.
  const { lastDriveSyncAt = null } = await getLocal(['lastDriveSyncAt']);
  const unsyncedCount = await getUnsyncedCount().catch(() => null);
  return {
    status: driveSyncInFlight ? 'syncing' : driveSyncLastError ? 'error' : 'idle',
    lastDriveSyncAt,
    unsyncedCount,
    error: driveSyncLastError,
  };
}

let activeTabId = null;
let activeTabUrl = null;
let timerSeconds = 0;
let timerRunning = false;
let nextFireTime = null;
let cycleCount = 0;
let activeFilters = null;
let activePhoneNumber = null;
let activeTestMode = false;
let activeMaxLeadsPerDay = null;

const ENABLE_LEAD_BUYING = true;

// Shared by the manual START_TIMER message handler and the auto-start trigger
// below — both just need to set the same run-state globals and schedule the
// first alarm.
function beginTimer({ tabId, url, seconds, filters, phoneNumber, testMode, maxLeadsPerDay }) {
  activeTabId = tabId;
  activeTabUrl = url || null;
  timerSeconds = seconds || 0;
  timerRunning = true;
  cycleCount = 0;
  activeFilters = filters || null;
  activePhoneNumber = phoneNumber || null;
  activeTestMode = testMode === true;
  activeMaxLeadsPerDay = maxLeadsPerDay || null;
  nextFireTime = Date.now() + timerSeconds * 1000;
  scheduleAlarm();
  return { ok: true, nextFireTime, cycleCount };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Persisted (not module-scope) so the count survives service-worker restarts,
// which Chrome does frequently. Keyed by date so it self-resets at midnight
// with no alarm of its own.
async function getTodayLeadCount() {
  const { leadsBoughtToday } = await getLocal(['leadsBoughtToday']);
  if (!leadsBoughtToday || leadsBoughtToday.date !== todayIso()) return 0;
  return leadsBoughtToday.count || 0;
}

async function incrementTodayLeadCount(by) {
  if (!by) return;
  const { leadsBoughtToday } = await getLocal(['leadsBoughtToday']);
  const today = todayIso();
  const current = leadsBoughtToday && leadsBoughtToday.date === today ? leadsBoughtToday.count || 0 : 0;
  await setLocal({ leadsBoughtToday: { date: today, count: current + by } });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'GET_ALL_LEADS') {
    getAllLeads()
      .then((leads) => sendResponse({ leads }))
      .catch((err) => {
        console.error('[DB] getAllLeads failed:', err);
        sendResponse({ leads: [] });
      });
    return true;
  }

  if (message.type === 'START_TIMER') {
    // Automation only ever runs against the IndiaMART seller dashboard —
    // host_permissions is scoped to seller.indiamart.com, so this also
    // matches what chrome.scripting.executeScript is actually allowed to touch.
    if (!isIndiamartUrl(message.url)) {
      sendResponse({ ok: false, reason: 'not-indiamart-tab' });
      return;
    }
    // Gate automation on a valid subscription + a registered device seat.
    checkRunAllowed().then((verdict) => {
      if (!verdict.ok) {
        sendResponse({ ok: false, reason: verdict.reason });
        return;
      }
      const result = beginTimer({
        tabId: message.tabId,
        url: message.url,
        seconds: message.seconds,
        filters: message.filters,
        phoneNumber: message.phoneNumber,
        testMode: message.testMode,
        maxLeadsPerDay: message.maxLeadsPerDay,
      });
      sendResponse(result);
    });
    return true; // async sendResponse
  }

  if (message.type === 'TEST_REAL_LEAD') {
    runRealLeadTest(message.tabId)
      .then((res) => sendResponse(res))
      .catch((e) => {
        console.error('[Test] real-lead test failed:', e);
        sendResponse({ ok: false, reason: 'fetch-failed' });
      });
    return true; // async sendResponse
  }

  if (message.type === 'DELETE_DUMMY_LEADS') {
    deleteDummyLeads()
      .then((res) => sendResponse(res))
      .catch((e) => {
        console.error('[Cleanup] delete dummy leads failed:', e);
        sendResponse({ firebaseDeleted: null, sheetsDeleted: null, errors: [String(e)] });
      });
    return true; // async sendResponse
  }

  if (message.type === 'SYNC_TO_DRIVE') {
    syncLeadsToDrive()
      .then((res) => sendResponse(res))
      .catch((e) => {
        console.error('[DriveSync] manual sync failed:', e);
        sendResponse({ ok: false, reason: 'failed', error: e instanceof Error ? e.message : String(e) });
      });
    return true; // async sendResponse
  }

  // The panel owns the history pointer and writes it to Firebase itself; it
  // only tells the worker afterwards so two things can happen that must stay
  // worker-side: dropping the metadata cache, and clearing the syncedAt
  // markers. Those markers are per-lead, not per-sheet, so without the reset a
  // newly chosen sheet would silently start mid-history.
  //
  // Skipped while a sync is in flight — resetting underneath a run that is
  // midway through marking a chunk against the *old* sheet would strand those
  // rows as "synced" to a sheet no longer in use.
  if (message.type === 'HISTORY_SHEET_CHANGED') {
    if (driveSyncInFlight) {
      sendResponse({ ok: false, reason: 'already-syncing' });
      return true;
    }
    historySpreadsheetCache = null;
    resetSyncMarkers()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => {
        console.error('[History] sync marker reset failed:', e);
        sendResponse({
          ok: false,
          reason: 'failed',
          error: e instanceof Error ? e.message : String(e),
        });
      });
    return true; // async sendResponse
  }

  if (message.type === 'GET_DRIVE_SYNC_STATE') {
    getDriveSyncState()
      .then((state) => sendResponse(state))
      .catch((e) => {
        console.error('[DriveSync] state fetch failed:', e);
        sendResponse({
          status: 'error',
          lastDriveSyncAt: null,
          unsyncedCount: null,
          error: String(e),
        });
      });
    // The panel calls this on mount — piggyback the "on open, sync if stale"
    // trigger here, since it's the only reliable wake signal an MV3 worker
    // gets for "the user opened the extension." Fire-and-forget: the response
    // above reflects the pre-sync state, and chrome.storage.onChanged carries
    // the update to the UI once the sync (if any) completes.
    maybeStartDriveSync().catch((e) => console.error('[DriveSync] staleness check failed:', e));
    return true; // async sendResponse
  }

  switch (message.type) {
    case 'STOP_TIMER':
      timerRunning = false;
      nextFireTime = null;
      chrome.alarms.clear('timer-alarm');
      sendResponse({ ok: true });
      break;

    case 'GET_TIMER_STATE':
      sendResponse({
        running: timerRunning,
        seconds: timerSeconds,
        tabId: activeTabId,
        url: activeTabUrl,
        nextFireTime,
        cycleCount
      });
      break;
  }
});

// Injected into the IndiaMART tab's MAIN world (so it inherits the seller's
// session). Fetches buy-leads, maps + filters them, and — only when
// `enableLeadBuying` — purchases up to `remainingSlots` of the matching leads
// (Infinity when no daily cap is set). Returns { mappedData, filteredIds,
// purchasedIds, purchaseDetails } to the worker — filteredIds is everything
// that matched, purchasedIds is the subset actually bought, so the worker can
// tell "matched but capped" apart from "purchased". Self-contained: it may
// only use its args and page globals (window.__im_utils,
// fetchGlidScriptJSFile), never module-scope vars. Shared by the alarm tick
// and the TEST_REAL_LEAD handler.
async function injectedFetchAndBuy(filters, phoneNumber, enableLeadBuying, remainingSlots) {
  try {
    if (typeof fetchGlidScriptJSFile === 'function') {

      const result = fetchGlidScriptJSFile();

      const response = await fetch(
        'https://seller.indiamart.com/blreact/getBLDisplayData',
        {
          method: 'POST',
          mode: 'cors',
          credentials: 'include',
          referrer:
            'https://seller.indiamart.com/bltxn/?pref=relevant&D_L_B=1',
          headers: {
            accept: '*/*',
            'accept-language':
              'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
            'content-type': 'application/json',
            priority: 'u=1, i',
            'sec-ch-ua':
              '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin'
          },
          body: JSON.stringify({
            LocPref: '4',
            stateid: '',
            city: '',
            iso: '',
            pref_city_lead: 0,
            glusrid: result,
            inbox: 'P',
            offer: '',
            offer_type: 'B',
            start: 1,
            end: 200,
            UsageTyp: '',
            quantity: '',
            is_email: '',
            is_gst: '',
            is_catalog: '',
            is_mobnum: '',
            is_busname: '',
            mcatid: '',
            sov: '',
            eov: null,
            enqType: ''
          })
        }
      );

      const data = await response.json();

      const mappedData = data.DisplayList.map((item) => {
        let quantity = null;

        try {
          const enrichment = JSON.parse(
            item.ENRICHMENTINFO || '{}'
          );

          const q = enrichment['1']
            ?.find((e) => e.DESC === 'Quantity')
            ?.RESPONSE;

          quantity = window.__im_utils.parseQuantity(q);
        } catch (e) {
          quantity = null;
        }

        return {
          ETO_OFR_ID: item.ETO_OFR_ID,
          ETO_OFR_TITLE: item.ETO_OFR_TITLE,
          BLDATETIME: window.__im_utils.parseTimeToMinutes(
            item.BLDATETIME
          ),
          ETO_OFR_APPROX_ORDER_VALUE:
            window.__im_utils.parsePrice(
              item.ETO_OFR_APPROX_ORDER_VALUE
            ),
          quantity,
          GLUSR_CITY: item.GLUSR_CITY,
          GLUSR_STATE: item.GLUSR_STATE,
          FK_GLCAT_MCAT_ID : item.FK_GLCAT_MCAT_ID,
          GRID_PARAMETERS : item.GRID_PARAMETERS
        };
      });

      const filteredLeads = window.__im_utils.filterLeads(mappedData, filters);
      const passedIds = new Set(filteredLeads.map((l) => l.ETO_OFR_ID));

      // One table for the whole pull, with the verdict as the leading column,
      // rather than a second table containing only the survivors — the useful
      // question is which of the leads you just saw passed, and why the rest
      // didn't, and that only reads well side by side.
      //
      // This function is injected with world: 'MAIN', so anything logged here
      // lands in IndiaMART's own page console where any script on that page
      // can read it. These are lead/business fields only: buyer name and
      // mobile number come from the purchase response, never from this list,
      // and are deliberately not logged anywhere. GRID_PARAMETERS is omitted
      // too — it's an opaque re-purchase token that shouldn't leave the
      // machine (see leadHistoryPayload.ts).
      console.log(`[Filter] ${filteredLeads.length} / ${mappedData.length} leads passed`);
      console.table(
        mappedData.map((lead) => {
          const passed = passedIds.has(lead.ETO_OFR_ID);
          return {
            Status: passed ? '✅ PASS' : '⛔ skip',
            // Optional-called: a page still holding an older __im_utils would
            // otherwise throw here and abort the whole cycle — no filtering,
            // no purchases — just because a logging helper was missing.
            // Diagnostics must never be able to take down the run.
            Why: passed ? '' : (window.__im_utils.rejectionReason?.(lead, filters) ?? '—'),
            ID: lead.ETO_OFR_ID,
            Title: lead.ETO_OFR_TITLE,
            'Price ₹': lead.ETO_OFR_APPROX_ORDER_VALUE,
            Qty: lead.quantity,
            'Age (m)': lead.BLDATETIME,
            City: lead.GLUSR_CITY,
            State: lead.GLUSR_STATE,
            Cat: lead.FK_GLCAT_MCAT_ID,
          };
        })
      );

      console.log(`[Purchase] Lead buying is ${enableLeadBuying ? 'enabled' : 'disabled'}`);

      // Cap the leads actually bought this cycle to whatever's left of the
      // daily quota (Infinity = no cap). filteredLeads stays untouched so the
      // worker still knows which leads matched, even the ones skipped here.
      const slots = Number.isFinite(remainingSlots) ? remainingSlots : Infinity;
      const leadsToBuy = enableLeadBuying ? filteredLeads.slice(0, Math.max(0, slots)) : [];
      console.log(`[Purchase] Buying ${leadsToBuy.length} / ${filteredLeads.length} matched leads (remaining daily slots: ${slots})`);

      let purchaseDetails = [];
      if (enableLeadBuying && leadsToBuy.length > 0) {
        const now = new Date();
        const ptime = `${String(now.getDate()).padStart(2,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

        const purchaseResults = await Promise.allSettled(
          leadsToBuy.map((lead, index) =>
            fetch(
              'https://seller.indiamart.com/blreact/contactBuyNow',
              {
                method: 'POST',
                mode: 'cors',
                credentials: 'include',
                referrer: 'https://seller.indiamart.com/bltxn/?pref=relevant',
                headers: {
                  accept: '*/*',
                  'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
                  'cache-control': 'no-cache',
                  'content-type': 'application/json',
                  pragma: 'no-cache',
                  'sec-ch-ua': '"Brave";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
                  'sec-ch-ua-mobile': '?0',
                  'sec-ch-ua-platform': '"macOS"',
                  'sec-fetch-dest': 'empty',
                  'sec-fetch-mode': 'cors',
                  'sec-fetch-site': 'same-origin',
                  'sec-gpc': '1',
                  'x-requested-with': 'XMLHttpRequest',
                },
                body: JSON.stringify({
                  glusrId: String(result),
                  ofrid: String(lead.ETO_OFR_ID),
                  purchasemod: 'WEB',
                  count: index + 1,
                  tsearch_text: 'latestbl_relevant_f_loc_ST',
                  serial: index + 1,
                  responseTextArea: 0,
                  bl_page_location: 'page=relevant#city=#mcatid=#locpref=',
                  matched_mcat_id: String(lead.FK_GLCAT_MCAT_ID),
                  order_value_flag: '',
                  is_bulk_order: '',
                  ofrtitle: lead.ETO_OFR_TITLE,
                  mapped_mcat_id: String(lead.FK_GLCAT_MCAT_ID),
                  GRID_PARAMETERS: lead.GRID_PARAMETERS,
                  mobile_no: phoneNumber,
                  ptime,
                  pref: 'https://seller.indiamart.com/bltxn/?pref=relevant',
                  grid_lead_pos: index + 1,
                  NIClick: 1,
                }),
              }
            ).then((res) => res.text()).then((text) => {
                try { return { lead, data: text ? JSON.parse(text) : null }; }
                catch { return { lead, data: text || null }; }
              })
          )
        );

        const purchaseData = purchaseResults.map((outcome, i) => {
          if (outcome.status === 'fulfilled') {
            // Status only — the response body holds the buyer's name and
            // mobile number, and this console belongs to IndiaMART's page.
            console.log(
              `[Purchase] ${outcome.value.lead.ETO_OFR_ID} → ${outcome.value.data?.Status ?? 'no-status'}`
            );
            return outcome.value;
          } else {
            console.error(`[Purchase] Failed for ${leadsToBuy[i].ETO_OFR_ID}:`, outcome.reason);
            return { lead: leadsToBuy[i], data: null, error: outcome.reason?.message };
          }
        });

        // Extract buyer contact info from purchase response to pass back to service worker
        purchaseDetails = purchaseData
          .filter(({ data }) => data != null)
          .map(({ lead, data }) => {
            // contactBuyNow returns buyer details nested under Data[0] on
            // success, e.g. { Status: 'Success', Flag: '1', Data: [ {...} ] }.
            const ok = data?.Status === 'Success' && data?.Flag === '1';
            const detail = ok && Array.isArray(data?.Data) ? data.Data[0] : null;

            return {
              ETO_OFR_ID: lead.ETO_OFR_ID,
              ETO_OFR_TITLE: lead.ETO_OFR_TITLE,
              ETO_OFR_APPROX_ORDER_VALUE: lead.ETO_OFR_APPROX_ORDER_VALUE,
              quantity: lead.quantity,
              GLUSR_CITY: lead.GLUSR_CITY,
              GLUSR_STATE: lead.GLUSR_STATE,
              buyerMobile:
                detail?.GLUSR_USR_PH_MOBILE ??
                detail?.GLUSR_USR_PH_MOBILE_ALT ??
                null,
              buyerMobileCountry: detail?.GLUSR_USR_MOBILE_COUNTRY ?? null,
              buyerName: detail?.GLUSR_NAME ?? null,
              // The moment the purchase actually happened, for the Sheets export row.
              boughtDate: now.toISOString().slice(0, 10),
              boughtTime: now.toTimeString().slice(0, 8),
            };
          });
      }

      // `result` is the seller's glusrid — identifying, and this console is
      // IndiaMART's. Log the cycle heartbeat without it.
      console.log(`[Cycle] ${new Date().toLocaleString()} · ${document.visibilityState}`);

      return {
        mappedData,
        filteredIds: filteredLeads.map((l) => l.ETO_OFR_ID),
        purchasedIds: leadsToBuy.map((l) => l.ETO_OFR_ID),
        purchaseDetails,
      };
    } else {
      console.warn(
        '[Background Timer] fetchGlidScriptJSFile not found'
      );
    }
  } catch (error) {
    console.error(
      '[Background Timer] Error executing function:',
      error
    );
  }
  return null;
}

const DRIVE_SYNC_ALARM_NAME = 'drive-sync-alarm';
const DRIVE_SYNC_PERIOD_MINUTES = 24 * 60;

// Only create it if it doesn't already exist — chrome.alarms.create()
// reschedules an existing alarm of the same name to fire `period` minutes
// from *now*, so calling this unconditionally on every worker wake (which
// MV3 does often) would keep pushing the 24h mark out and the alarm would
// never actually fire.
chrome.alarms.get(DRIVE_SYNC_ALARM_NAME, (alarm) => {
  if (!alarm) {
    chrome.alarms.create(DRIVE_SYNC_ALARM_NAME, { periodInMinutes: DRIVE_SYNC_PERIOD_MINUTES });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DRIVE_SYNC_ALARM_NAME) {
    syncLeadsToDrive().catch((e) => console.error('[DriveSync] periodic sync failed:', e));
    return;
  }

  if (alarm.name !== 'timer-alarm' || !timerRunning || !activeTabId) return;

  // Re-validate entitlement every ENTITLEMENT_CHECK_INTERVAL cycles (and on the
  // very first cycle); stop automation if it flips invalid (e.g. subscription
  // expired or the device seat was removed).
  if (cycleCount % ENTITLEMENT_CHECK_INTERVAL === 0) {
    checkRunAllowed().then((verdict) => {
      if (!verdict.ok) {
        console.warn('[Entitlement] stopping timer:', verdict.reason);
        timerRunning = false;
        nextFireTime = null;
        chrome.alarms.clear('timer-alarm');
      }
    });
  }

  chrome.tabs.get(activeTabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      timerRunning = false;
      nextFireTime = null;
      chrome.alarms.clear('timer-alarm');
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['utils-inject.js'],
      world: 'MAIN'
    }, () => {
      if (chrome.runtime.lastError) {
        console.error(
          '[Background Timer] inject error:',
          chrome.runtime.lastError.message
        );
      }

      const buyingActive = ENABLE_LEAD_BUYING && !activeTestMode;
      // `null` (not `Infinity`) when uncapped — executeScript args must be
      // JSON-serializable, and Infinity isn't. injectedFetchAndBuy already
      // treats any non-finite value as "no cap".
      const remainingSlotsPromise = (buyingActive && activeMaxLeadsPerDay)
        ? getTodayLeadCount().then((count) => Math.max(0, activeMaxLeadsPerDay - count))
        : Promise.resolve(null);

      remainingSlotsPromise.then((remainingSlots) => {
      chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        world: 'MAIN',
        args: [activeFilters, activePhoneNumber, buyingActive, remainingSlots],
        func: injectedFetchAndBuy
      }, (results) => {
        if (chrome.runtime.lastError) {
          console.error(
            '[Background Timer] executeScript error:',
            chrome.runtime.lastError.message
          );
        }

        if (results && results[0] && !results[0].error && results[0].result) {
          const { mappedData, filteredIds, purchasedIds = [], purchaseDetails = [] } = results[0].result;
          if (mappedData && filteredIds) {
            harvestCities(mappedData).catch((err) => console.error('[Cities] harvest failed:', err));
            const filteredSet = new Set(filteredIds);
            const purchasedSet = new Set(purchasedIds);
            const now = new Date();
            const firstSeenDate = now.toISOString().slice(0, 10);
            const firstSeenTime = now.toTimeString().slice(0, 8);
            const filtersSnapshot = activeFilters ? { ...activeFilters } : null;

            mappedData.forEach((lead) => {
              const isMatched = filteredSet.has(lead.ETO_OFR_ID);
              const isPurchased = purchasedSet.has(lead.ETO_OFR_ID);
              let reasons;
              if (isPurchased) {
                reasons = 'Purchased';
              } else if (isMatched) {
                reasons = buyingActive
                  ? 'Matched (daily cap reached)'
                  : (activeTestMode ? 'Matched (test mode)' : 'Passed filters (buying disabled)');
              } else {
                reasons = rejectionReason(lead, activeFilters);
              }

              upsertLead({
                ...lead,
                firstSeenDate,
                firstSeenTime,
                firstSeenAtMs: now.getTime(),
                reasons,
                filtersAtFirstSeen: filtersSnapshot,
                // 0 = not yet synced to the Drive history sheet. A lead later
                // promoted to 'Purchased' (see upsertLead) is deliberately
                // left as-is here — its syncedAt is never cleared, so it's
                // not re-pushed once already synced.
                syncedAt: 0
              }).catch((err) => console.error('[DB] upsertLead failed:', err));
            });

            if (purchasedIds.length > 0) {
              incrementTodayLeadCount(purchasedIds.length).catch((err) => console.error('[DailyCap] increment failed:', err));
            }

            if (ENABLE_LEAD_BUYING && purchaseDetails.length > 0) {
              sendLeadNotifications(purchaseDetails);
              writeLeadsToSheet(purchaseDetails);
            }
          }
        }

        if (timerRunning) {
          cycleCount += 1;
          nextFireTime = Date.now() + timerSeconds * 1000;
          scheduleAlarm();
        }
      });
      });
    });
  });
});

function scheduleAlarm() {
  chrome.alarms.create('timer-alarm', {
    when: nextFireTime
  });
}

// In-memory fast-path guard against a same-instance double-fire.
// chrome.storage.session.autoStartPending (cleared on browser close, but
// survives service-worker restarts within the session) is the durable source
// of truth for "has the one auto-start shot for this browser session already
// been used."
let autoStartClaimed = false;

// Runs on every tab that finishes loading seller.indiamart.com. Fires the
// saved START_TIMER payload at most once per real Chrome startup — on
// whichever qualifying tab gets there first, regardless of whether
// autoStartEnabled happens to be on at that moment (that's what makes it
// "only the first indiamart tab after opening Chrome", full stop).
async function maybeAutoStartFromTab(tabId, url) {
  if (!isIndiamartUrl(url) || timerRunning || autoStartClaimed) return;

  const { autoStartPending } = await getSession(['autoStartPending']);
  if (!autoStartPending) return; // this session's one shot is already used

  autoStartClaimed = true;
  await setSession({ autoStartPending: false }); // claim immediately, before any more awaits

  const { autoStartEnabled } = await getLocal(['autoStartEnabled']);
  if (!autoStartEnabled) return; // setting was off at the one qualifying moment

  const { autoStartPayload } = await getLocal(['autoStartPayload']);
  if (!autoStartPayload || !autoStartPayload.seconds) return; // nothing valid saved yet

  const verdict = await checkRunAllowed();
  if (!verdict.ok) return; // silent no-op, same as a failed manual Start

  if (timerRunning) return; // a manual Start may have raced ahead during the awaits above

  beginTimer({
    tabId,
    url,
    seconds: autoStartPayload.seconds,
    filters: autoStartPayload.filters,
    phoneNumber: autoStartPayload.phoneNumber,
    testMode: autoStartPayload.testMode,
    maxLeadsPerDay: autoStartPayload.maxLeadsPerDay,
  });
}

chrome.runtime.onStartup.addListener(() => {
  autoStartClaimed = false;
  maybeStartDriveSync().catch((e) => console.error('[DriveSync] startup staleness check failed:', e));
  setSession({ autoStartPending: true }).then(() => {
    // Covers a tab Chrome already restored/loaded before this listener's
    // async work finished (e.g. a fast session restore of a pinned tab).
    chrome.tabs.query({ url: `${INDIAMART_ORIGIN}/*` }, (tabs) => {
      const match = tabs.find((t) => isIndiamartUrl(t.url));
      if (match) {
        maybeAutoStartFromTab(match.id, match.url).catch((e) =>
          console.error('[AutoStart] startup fallback failed:', e)
        );
      }
    });
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  maybeAutoStartFromTab(tabId, tab.url).catch((e) =>
    console.error('[AutoStart] failed:', e)
  );
});
