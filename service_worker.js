// Service Worker - Manages polling timer and state
let pollingState = {
  active: false,
  intervalId: null,
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

// Utility: Add log entry
function addLog(level, message) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${level} — ${message}`;
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }
  console.log(entry);
  return entry;
}

// Utility: Find active tab on seller.indiamart.com
async function getActiveSellerTab() {
  const tabs = await chrome.tabs.query({ url: '*://seller.indiamart.com/*' });
  return tabs.length > 0 ? tabs[0] : null;
}

// Main polling function
async function callGetBLDisplayData() {
  if (!pollingState.active) return;

  pollingState.call_count++;
  pollingState.last_call_time = new Date().toISOString();

  try {
    const tab = await getActiveSellerTab();
    if (!tab) {
      const msg = 'No active tab found on seller.indiamart.com';
      addLog('WARN', msg);
      return;
    }

    // Send message to content script
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'fetch_bldisplaydata'
    });

    if (response.success) {
      pollingState.success_count++;
      addLog('INFO', `getBLDisplayData OK: ${response.lead_count} leads, total=${response.total_leads}`);
      
      // Update panel
      notifyPanelUpdate();
    } else {
      pollingState.error_count++;
      pollingState.last_error = response.error;
      addLog('ERROR', `API Error: ${response.error}`);

      // Check if session expired
      if (response.code !== '200' || response.error.includes('Session')) {
        stopPolling('Session expired or invalid response');
      }
      notifyPanelUpdate();
    }
  } catch (error) {
    pollingState.error_count++;
    pollingState.last_error = error.message;
    addLog('ERROR', `Network/Execution Error: ${error.message}`);
    
    // Stop polling on critical errors
    stopPolling(error.message);
    notifyPanelUpdate();
  }
}

// Start polling
function startPolling(interval_seconds) {
  if (pollingState.active) {
    addLog('WARN', 'Polling already active');
    return { ok: true };
  }

  if (!interval_seconds || interval_seconds < 1) {
    return { ok: false, error: 'Interval must be >= 1 second' };
  }

  pollingState.active = true;
  pollingState.interval_seconds = interval_seconds;
  pollingState.call_count = 0;
  pollingState.success_count = 0;
  pollingState.error_count = 0;
  pollingState.last_error = null;

  // Set interval (multiply by 1000 for milliseconds)
  pollingState.intervalId = setInterval(callGetBLDisplayData, interval_seconds * 1000);

  addLog('INFO', `Polling started: interval ${interval_seconds}s`);
  notifyPanelUpdate();

  return { ok: true };
}

// Stop polling
function stopPolling(reason = 'User stopped') {
  if (!pollingState.active) {
    return { ok: true };
  }

  if (pollingState.intervalId) {
    clearInterval(pollingState.intervalId);
    pollingState.intervalId = null;
  }

  pollingState.active = false;

  addLog('INFO', `Polling stopped (${reason}). Total calls made: ${pollingState.call_count}, Success: ${pollingState.success_count}, Errors: ${pollingState.error_count}`);
  notifyPanelUpdate();

  return { ok: true, call_count: pollingState.call_count };
}

// Notify panel of state change
function notifyPanelUpdate() {
  chrome.runtime.sendMessage({
    action: 'polling_status_update',
    state: { ...pollingState },
    logs: [...logBuffer]
  }).catch(() => {
    // Panel might not be open, ignore
  });
}

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'start_polling':
      sendResponse(startPolling(request.interval_seconds));
      break;

    case 'stop_polling':
      sendResponse(stopPolling('User stopped'));
      break;

    case 'get_status':
      sendResponse({
        state: { ...pollingState },
        logs: [...logBuffer]
      });
      break;

    default:
      sendResponse({ error: 'Unknown action' });
  }
});

// Initialize
addLog('INFO', 'Service Worker loaded');
