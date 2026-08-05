import { FIREBASE_CONFIG } from '@shared/firebaseConfig';
import { CHANNEL_BANNER } from '@shared/channels';
import { buildExpoMessage } from '@shared/pushPayload';
import { rejectionReason } from '@shared/leadPolicy';
import { sanitizeEmail } from '@shared/email';
import { getEntitlement } from '@shared/entitlement';
import { SHEET_HEADER_ROW, buildSheetRow, parseSpreadsheetId } from '@shared/sheetsPayload';

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

// Resolves the cached OAuth token for the Sheets scope, or null if the user
// hasn't connected Google Sheets yet (or the grant was revoked). Never
// prompts — the interactive grant only happens from the panel's "Connect
// Google Sheets" button.
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
  }
}

// Writes every lead bought this tick to the user's configured Google Sheet
// tab, as one batched append. Fire-and-forget like every other external call
// in this file (Firebase, Expo) — a failure here must never block or affect
// the phone-notification path.
async function writeLeadsToSheet(purchasedLeads) {
  const { sheetUrl, sheetTabName } = await getLocal(['sheetUrl', 'sheetTabName']);
  if (!sheetUrl || !sheetTabName) return;

  const spreadsheetId = parseSpreadsheetId(sheetUrl);
  if (!spreadsheetId) {
    console.error('[Sheets] Could not parse spreadsheet ID from URL:', sheetUrl);
    return;
  }

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
    buyerMobile: '9000000000',
    boughtDate: now.toISOString().slice(0, 10),
    boughtTime: now.toTimeString().slice(0, 8),
  };
  await sendLeadNotifications([record]);
  await writeLeadsToSheet([record]);
  return { ok: true };
}


const DB_NAME = 'indiamart_leads';
const DB_VERSION = 1;
const STORE_NAME = 'leads';

function openLeadsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'ETO_OFR_ID' });
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

      console.table(mappedData)

      const filteredLeads = window.__im_utils.filterLeads(mappedData, filters);
      console.log(`[Filter] ${filteredLeads.length} / ${mappedData.length} leads passed:`, JSON.stringify(filteredLeads, null, 2));
      console.table(filteredLeads);

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
            console.log(`[Purchase] ${outcome.value.lead.ETO_OFR_ID} - ${outcome.value.lead.ETO_OFR_TITLE}`, outcome.value.data);
            return outcome.value;
          } else {
            console.error(`[Purchase] Failed for ${leadsToBuy[i].ETO_OFR_ID}:`, outcome.reason);
            return { lead: leadsToBuy[i], data: null, error: outcome.reason?.message };
          }
        });

        console.table(purchaseData.map(({ lead, data }) => ({ ofrid: lead.ETO_OFR_ID, title: lead.ETO_OFR_TITLE, response: JSON.stringify(data) })));

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

      console.table({
        result,
        time: new Date().toLocaleString(),
        state: document.visibilityState
      });

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

chrome.alarms.onAlarm.addListener((alarm) => {
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
                reasons,
                filtersAtFirstSeen: filtersSnapshot
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
