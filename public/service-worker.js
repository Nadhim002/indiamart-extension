let activeTabId = null;
let activeTabUrl = null;
let timerSeconds = 0;
let timerRunning = false;
let nextFireTime = null;
let cycleCount = 0;
let activeFilters = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case 'START_TIMER':
      activeTabId = message.tabId;
      activeTabUrl = message.url || null;
      timerSeconds = message.seconds || 0;
      timerRunning = true;
      cycleCount = 0;
      activeFilters = message.filters || null;
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
        args: [activeFilters],
        func: async (filters) => {
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

              // console.table(mappedData);

              const filteredLeads = window.__im_utils.filterLeads(mappedData, filters);
              console.log(`[Filter] ${filteredLeads.length} / ${mappedData.length} leads passed`);
              console.table(filteredLeads);

              console.table({
                result,
                time: new Date().toLocaleString(),
                state: document.visibilityState
              });
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
        }
      }, () => {
        if (chrome.runtime.lastError) {
          console.error(
            '[Background Timer] executeScript error:',
            chrome.runtime.lastError.message
          );
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