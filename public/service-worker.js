import { FIREBASE_CONFIG } from './firebase-config.js';

async function sendLeadNotifications(purchasedLeads) {
  const { registeredDevices = [], googleUID, googleIdToken } = await new Promise((resolve) =>
    chrome.storage.local.get(['registeredDevices', 'googleUID', 'googleIdToken'], resolve)
  );

  if (!googleUID || !googleIdToken) {
    console.warn('[FCM] Not signed in — skipping notifications');
    return;
  }

  if (registeredDevices.length === 0) {
    console.warn('[FCM] No registered phones — skipping notifications');
  }

  const DB_URL = FIREBASE_CONFIG.databaseURL;

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
      await fetch(`${DB_URL}/leads/${googleUID}/new.json?auth=${googleIdToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error('[Firebase] Failed to write lead:', e);
    }

    // Push via Expo to each registered phone (covers killed-app state)
    const body = [lead.buyerName, lead.GLUSR_CITY, lead.GLUSR_STATE].filter(Boolean).join(' — ');
    await Promise.all(
      registeredDevices.map(async ({ token, notificationStyle }) => {
        const channelId = notificationStyle === 'phonecall' ? 'lead-alerts-phonecall' : 'lead-alerts-v2';
        try {
          const res = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: token,
              title: payload.title,
              body: body || 'New lead purchased!',
              channelId,
              priority: 'high',
              sound: 'default',
              data: payload,
            }),
          });
          const data = await res.json();
          console.log('[FCM] Sent to', token.slice(0, 30) + '...', 'channel:', channelId, data);
        } catch (e) {
          console.error('[FCM] Failed to send to', token.slice(0, 20), e);
        }
      })
    );
  }
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

const ENABLE_LEAD_BUYING = true;

function computeRejectionReasons(lead, filters) {
  if (!filters) return 'No filters set';
  const reasons = [];
  const { minPrice, minQuantity, minTimePassed, states } = filters;

  if (minPrice != null || minQuantity != null) {
    const priceOk = minPrice != null && lead.ETO_OFR_APPROX_ORDER_VALUE != null && lead.ETO_OFR_APPROX_ORDER_VALUE >= minPrice;
    const quantityOk = minQuantity != null && lead.quantity != null && lead.quantity >= minQuantity;
    if (!priceOk && !quantityOk) {
      if (minPrice != null) reasons.push('Price too low');
      if (minQuantity != null) reasons.push('Quantity too low');
    }
  }

  if (minTimePassed != null && minTimePassed > 0) {
    if (lead.BLDATETIME == null || lead.BLDATETIME > minTimePassed) {
      reasons.push('Lead too old');
    }
  }

  if (states && states.length > 0) {
    if (!states.includes(lead.GLUSR_STATE)) {
      reasons.push('State not selected');
    }
  }

  return reasons.length > 0 ? reasons.join(', ') : 'Passed filters';
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

  switch (message.type) {
    case 'START_TIMER':
      activeTabId = message.tabId;
      activeTabUrl = message.url || null;
      timerSeconds = message.seconds || 0;
      timerRunning = true;
      cycleCount = 0;
      activeFilters = message.filters || null;
      activePhoneNumber = message.phoneNumber || null;
      nextFireTime = Date.now() + timerSeconds * 1000;
      scheduleAlarm();
      sendResponse({ ok: true, nextFireTime, cycleCount });
      break;

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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'timer-alarm' || !timerRunning || !activeTabId) return;

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
        args: [activeFilters, activePhoneNumber, ENABLE_LEAD_BUYING],
        func: async (filters, phoneNumber, enableLeadBuying) => {
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
              console.log(`[Filter] ${filteredLeads.length} / ${mappedData.length} leads passed`);
              console.table(filteredLeads);

              console.log(`[Purchase] Lead buying is ${enableLeadBuying ? 'enabled' : 'disabled'}`);

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
                const purchaseDetails = purchaseData
                  .filter(({ data }) => data != null)
                  .map(({ lead, data }) => ({
                    ETO_OFR_ID: lead.ETO_OFR_ID,
                    ETO_OFR_TITLE: lead.ETO_OFR_TITLE,
                    quantity: lead.quantity,
                    GLUSR_CITY: lead.GLUSR_CITY,
                    GLUSR_STATE: lead.GLUSR_STATE,
                    buyerMobile: data?.MOBNO ?? data?.mobile ?? data?.mob ?? null,
                    buyerName: data?.CNAME ?? data?.name ?? data?.buyer_name ?? null,
                  }));
              }

              console.table({
                result,
                time: new Date().toLocaleString(),
                state: document.visibilityState
              });

              return {
                mappedData,
                filteredIds: filteredLeads.map((l) => l.ETO_OFR_ID),
                purchaseDetails: typeof purchaseDetails !== 'undefined' ? purchaseDetails : [],
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
              const reasons = isPurchased
                ? (ENABLE_LEAD_BUYING ? 'Purchased' : 'Passed filters (buying disabled)')
                : computeRejectionReasons(lead, activeFilters);

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
