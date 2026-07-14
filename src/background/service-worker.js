import { FIREBASE_CONFIG } from '@shared/firebaseConfig';
import { CHANNEL_BANNER } from '@shared/channels';
import { buildExpoMessage } from '@shared/pushPayload';
import { rejectionReason } from '@shared/leadPolicy';
import { sanitizeEmail } from '@shared/email';
import { getEntitlement } from '@shared/entitlement';

function getLocal(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
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
    const body = [lead.buyerName, lead.GLUSR_CITY, lead.GLUSR_STATE].filter(Boolean).join(' — ') || 'New lead purchased!';
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
          console.log('[FCM] Sent to', token.slice(0, 30) + '...', isPhonecall ? 'phonecall(data-only)' : `banner(${CHANNEL_BANNER})`, data);
        } catch (e) {
          console.error('[FCM] Failed to send to', token.slice(0, 20), e);
        }
      })
    );
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

  const record = {
    ETO_OFR_ID: first.ETO_OFR_ID,
    ETO_OFR_TITLE: first.ETO_OFR_TITLE,
    quantity: first.quantity,
    GLUSR_CITY: first.GLUSR_CITY,
    GLUSR_STATE: first.GLUSR_STATE,
    buyerName: 'Test Buyer',
    buyerMobile: '9000000000',
  };
  await sendLeadNotifications([record]);
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

const ENABLE_LEAD_BUYING = true;

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
    // Gate automation on a valid subscription + a registered device seat.
    checkRunAllowed().then((verdict) => {
      if (!verdict.ok) {
        sendResponse({ ok: false, reason: verdict.reason });
        return;
      }
      activeTabId = message.tabId;
      activeTabUrl = message.url || null;
      timerSeconds = message.seconds || 0;
      timerRunning = true;
      cycleCount = 0;
      activeFilters = message.filters || null;
      activePhoneNumber = message.phoneNumber || null;
      activeTestMode = message.testMode === true;
      nextFireTime = Date.now() + timerSeconds * 1000;
      scheduleAlarm();
      sendResponse({ ok: true, nextFireTime, cycleCount });
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
// `enableLeadBuying` — purchases each matching lead. Returns { mappedData,
// filteredIds, purchaseDetails } to the worker. Self-contained: it may only use
// its args and page globals (window.__im_utils, fetchGlidScriptJSFile), never
// module-scope vars. Shared by the alarm tick and the TEST_REAL_LEAD handler.
async function injectedFetchAndBuy(filters, phoneNumber, enableLeadBuying) {
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

      let purchaseDetails = [];
      if (enableLeadBuying) {
        const now = new Date();
        const ptime = `${String(now.getDate()).padStart(2,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

        const purchaseResults = await Promise.allSettled(
          filteredLeads.map((lead, index) =>
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
            console.error(`[Purchase] Failed for ${filteredLeads[i].ETO_OFR_ID}:`, outcome.reason);
            return { lead: filteredLeads[i], data: null, error: outcome.reason?.message };
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
              quantity: lead.quantity,
              GLUSR_CITY: lead.GLUSR_CITY,
              GLUSR_STATE: lead.GLUSR_STATE,
              buyerMobile:
                detail?.GLUSR_USR_PH_MOBILE ??
                detail?.GLUSR_USR_PH_MOBILE_ALT ??
                null,
              buyerMobileCountry: detail?.GLUSR_USR_MOBILE_COUNTRY ?? null,
              buyerName: detail?.GLUSR_NAME ?? null,
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

  // Re-validate entitlement each cycle; stop automation if it flips invalid
  // (e.g. subscription expired or the device seat was removed).
  checkRunAllowed().then((verdict) => {
    if (!verdict.ok) {
      console.warn('[Entitlement] stopping timer:', verdict.reason);
      timerRunning = false;
      nextFireTime = null;
      chrome.alarms.clear('timer-alarm');
    }
  });

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

      chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        world: 'MAIN',
        args: [activeFilters, activePhoneNumber, ENABLE_LEAD_BUYING && !activeTestMode],
        func: injectedFetchAndBuy
      }, (results) => {
        if (chrome.runtime.lastError) {
          console.error(
            '[Background Timer] executeScript error:',
            chrome.runtime.lastError.message
          );
        }

        if (results && results[0] && !results[0].error && results[0].result) {
          const { mappedData, filteredIds, purchaseDetails = [] } = results[0].result;
          if (mappedData && filteredIds) {
            const filteredSet = new Set(filteredIds);
            const now = new Date();
            const firstSeenDate = now.toISOString().slice(0, 10);
            const firstSeenTime = now.toTimeString().slice(0, 8);
            const filtersSnapshot = activeFilters ? { ...activeFilters } : null;

            mappedData.forEach((lead) => {
              const isPurchased = filteredSet.has(lead.ETO_OFR_ID);
              const matchedReason = activeTestMode
                ? 'Matched (test mode)'
                : (ENABLE_LEAD_BUYING ? 'Purchased' : 'Passed filters (buying disabled)');
              const reasons = isPurchased
                ? matchedReason
                : rejectionReason(lead, activeFilters);

              upsertLead({
                ...lead,
                firstSeenDate,
                firstSeenTime,
                reasons,
                filtersAtFirstSeen: filtersSnapshot
              }).catch((err) => console.error('[DB] upsertLead failed:', err));
            });

            if (ENABLE_LEAD_BUYING && purchaseDetails.length > 0) {
              sendLeadNotifications(purchaseDetails);
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

function scheduleAlarm() {
  chrome.alarms.create('timer-alarm', {
    when: nextFireTime
  });
}
