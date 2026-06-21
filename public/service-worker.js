let activeTabId = null;
let activeTabUrl = null;
let timerSeconds = 0;
let timerRunning = false;
let nextFireTime = null;
let cycleCount = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case 'START_TIMER':
      activeTabId = message.tabId;
      activeTabUrl = message.url || null;
      timerSeconds = message.seconds || 0;
      timerRunning = true;
      cycleCount = 0;
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
      func: async () => {
        try {
          if (typeof fetchGlidScriptJSFile === 'function') {
            const result = fetchGlidScriptJSFile();

            const response = await fetch("https://seller.indiamart.com/blreact/getBLDisplayData", {
              method: "POST",
              mode: "cors",
              credentials: "include",
              referrer: "https://seller.indiamart.com/bltxn/?pref=relevant&D_L_B=1",
              headers: {
                accept: "*/*",
                "accept-language": "en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7",
                "content-type": "application/json",
                priority: "u=1, i",
                "sec-ch-ua":
                  "\"Google Chrome\";v=\"149\", \"Chromium\";v=\"149\", \"Not)A;Brand\";v=\"24\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"Windows\"",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
              },
              body: JSON.stringify({
                LocPref: "4",
                stateid: "",
                city: "",
                iso: "",
                pref_city_lead: 0,
                glusrid: result,
                inbox: "P",
                offer: "",
                offer_type: "B",
                start: 1,
                end: 20,
                UsageTyp: "",
                quantity: "",
                is_email: "",
                is_gst: "",
                is_catalog: "",
                is_mobnum: "",
                is_busname: "",
                mcatid: "",
                sov: "",
                eov: null,
                enqType: "",
              }),
            });

            const data = await response.json();

            // Helpers to convert values into numbers
            const priceMap = {
              'Above 1,000': 1000,
              'Above 10,000': 10000,
              'Above 1 Lakh': 100000,
              'Above 5 Lakh': 500000,
            };

            function parsePrice(v) {
              if (v == null) return null;
              if (typeof v === 'number') return v;
              if (priceMap[v]) return priceMap[v];
              const s = String(v).toLowerCase().replace(/,/g, '').trim();
              if (s.includes('lakh')) {
                const n = parseFloat(s.match(/(\d+(?:\.\d+)?)/)?.[0]);
                return isNaN(n) ? null : Math.round(n * 100000);
              }
              const m = s.match(/(\d+(?:\.\d+)?)/);
              return m ? Number(m[0]) : null;
            }

            function parseTimeToMinutes(v) {
              if (v == null) return null;
              const s = String(v).toLowerCase().replace(/[()]/g, '').trim();
              if (s.includes('yesterday')) return 1440;
              if (s.includes('hr') || s.includes('hrs')) {
                const n = parseFloat(s.match(/(\d+(?:\.\d+)?)/)?.[0]);
                return isNaN(n) ? null : Math.round(n * 60);
              }
              if (s.includes('min') || s.includes('mins')) {
                const n = parseFloat(s.match(/(\d+(?:\.\d+)?)/)?.[0]);
                return isNaN(n) ? null : Math.round(n);
              }
              if (s.includes('sec') || s.includes('secs')) return 0;
              const m = s.match(/(\d+(?:\.\d+)?)/);
              return m ? Number(m[0]) : null;
            }

            const mappedData = data.DisplayList.map((item) => {
              let quantity = 0;
              try {
                const enrichment = JSON.parse(item.ENRICHMENTINFO || '{}');
                const q = enrichment['1']?.find((e) => e.DESC == 'Quantity')?.RESPONSE;
                quantity = q == null ? 0 : (Number(String(q).replace(/,/g, '')) || 0);
              } catch (e) {
                quantity = 0;
              }

              return {
                ETO_OFR_ID: item.ETO_OFR_ID,
                ETO_OFR_TITLE: item.ETO_OFR_TITLE,
                BLDATETIME: parseTimeToMinutes(item.BLDATETIME),
                ETO_OFR_APPROX_ORDER_VALUE: parsePrice(item.ETO_OFR_APPROX_ORDER_VALUE),
                quantity,
                GLUSR_CITY: item.GLUSR_CITY,
                GLUSR_STATE: item.GLUSR_STATE,
              };
            });

            console.table(mappedData);

            const tableToLog = { result, time: new Date().toLocaleString(), stae: document.visibilityState };
            console.table(tableToLog); if (result && typeof result.then === 'function') {
              result.catch((error) => console.error('[Background Timer] Promise error:', error));
            }
          } else {
            console.warn('[Background Timer] fetchGlidScriptJSFile not found');
          }
        } catch (error) {
          console.error('[Background Timer] Error executing function:', error);
        }
      },
      world: 'MAIN'
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[Background Timer] executeScript error:', chrome.runtime.lastError.message);
      }
      if (timerRunning) {
        cycleCount += 1;
        nextFireTime = Date.now() + timerSeconds * 1000;
        scheduleAlarm();
      }
    });
  });
});

function scheduleAlarm() {
  if (!timerRunning || timerSeconds <= 0) return;
  chrome.alarms.create('timer-alarm', { when: nextFireTime });
}
