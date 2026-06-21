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

            console.log('Fetched data:', data.DisplayList );

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
