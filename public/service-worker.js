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
      func: () => {
        try {
          if (typeof fetchGlidScriptJSFile === 'function') {
            const result = fetchGlidScriptJSFile();
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
