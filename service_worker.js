// Service Worker - Minimal boilerplate and UI/message hooks

let pollingState = {
  active: false,
  interval_seconds: null,
  call_count: 0,
  success_count: 0,
  error_count: 0,
  last_call_time: null,
  last_error: null
};

// Log buffer (last 100 entries)
let logBuffer = [];
const MAX_LOGS = 100;

// Simple logging helper retained for debugging/UI
function addLog(level, message) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${level} — ${message}`;
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
  console.log(entry);
  return entry;
}

// Notify panel stub (keeps UI hook intact)
function notifyPanelUpdate() {
  try {
    chrome.runtime.sendMessage({
      action: 'polling_status_update',
      state: { ...pollingState },
      logs: [...logBuffer]
    });
  } catch (e) {
    // panel may not be open
  }
}

// Minimal message listener: UI/popup can call these actions; implement logic by hand
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'start_polling':
      sendResponse({ ok: false, error: 'Not implemented' });
      break;

    case 'stop_polling':
      sendResponse({ ok: false, error: 'Not implemented' });
      break;

    case 'get_status':
      sendResponse({ state: { ...pollingState }, logs: [...logBuffer] });
      break;

    default:
      sendResponse({ error: 'Unknown action' });
  }
});

addLog('INFO', 'Service Worker boilerplate loaded');
