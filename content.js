// Content Script - Runs on seller.indiamart.com and calls APIs

const STORAGE_KEY = 'indiamart_buy_leads';
const REDIRECT_FLAG = 'indiamart_buy_leads_redirected';
const TARGET_URL = 'https://seller.indiamart.com/bltxn/?pref=relevant';

function getStoredGlusrid() {
  const stored = localStorage.getItem(STORAGE_KEY);

  console.log('Stored glusrid:', stored);

  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.glusrid) {
        return parsed.glusrid;
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  const sellerData = localStorage.getItem('sellerData');
  if (sellerData) {
    try {
      const parsed = JSON.parse(sellerData);
      if (parsed && parsed.glusrid) {
        return parsed.glusrid;
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  return null;
}

function storeGlusrid(glusrid) {
  if (!glusrid) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ glusrid }));
  } catch (e) {
    // ignore storage errors
  }
}

function extractGlusridFromPage() {
  if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.glusrid) {
    return window.__INITIAL_STATE__.glusrid;
  }

  const sellerIdElement = document.querySelector('[data-glusrid]');
  if (sellerIdElement) {
    return sellerIdElement.getAttribute('data-glusrid');
  }

  const sellerName = document.querySelector('meta[name="seller-id"]');
  if (sellerName) {
    return sellerName.getAttribute('content');
  }

  return null;
}

async function isRedirectedOnce() {
  const result = await chrome.storage.local.get(REDIRECT_FLAG);
  return result[REDIRECT_FLAG] === true;
}

async function markRedirected() {
  try {
    await chrome.storage.local.set({ [REDIRECT_FLAG]: true });
  } catch (e) {
    // ignore
  }
}

function shouldRedirectForGlusrid(hasRedirected) {
  return !window.location.href.startsWith(TARGET_URL) && !hasRedirected;
}

// Intercept fetch to capture getBLDisplayData responses
const originalFetch = window.fetch;
window.fetch = function(...args) {
  return originalFetch.apply(this, args).then(response => {
    // Clone the response to read it
    const clonedResponse = response.clone();
    
    // Check if this is a getBLDisplayData call
    if (args[0] && typeof args[0] === 'string' && args[0].includes('getBLDisplayData')) {
      clonedResponse.json().then(data => {
        if (data && data.glusrid) {
          console.log('Captured glusrid from auto API call:', data.glusrid);
          storeGlusrid(data.glusrid);
        }
      }).catch(() => {
        // ignore parse errors
      });
    }
    
    return response;
  });
};

// Redirect on load if needed
async function handleInitialRedirect() {
  const stored = getStoredGlusrid();
  if (stored) {
    console.log('Found stored glusrid, no redirect needed');
    return; // Already have glusrid, no redirect needed
  }

  const pageGlusrid = extractGlusridFromPage();
  if (pageGlusrid) {
    console.log('Found glusrid on page:', pageGlusrid);
    storeGlusrid(pageGlusrid);
    return; // Found on page, store and done
  }

  const hasRedirected = await isRedirectedOnce();
  if (shouldRedirectForGlusrid(hasRedirected)) {
    await markRedirected();
    console.log('No glusrid found. Redirecting to relevant leads page...');
    window.location.href = TARGET_URL;
  } else if (!window.location.href.startsWith(TARGET_URL)) {
    console.log('Already redirected once but not on target URL. Waiting for API response...');
  } else {
    console.log('On target URL, waiting for auto API call to capture glusrid...');
  }
}

// Call getBLDisplayData API
async function callGetBLDisplayData() {
  // Check stored first, then page
  let glusrid = getStoredGlusrid() || extractGlusridFromPage();

  if (!glusrid) {
    return {
      success: false,
      error: 'glusrid not found. Please visit the relevant leads page first.',
      code: 'PENDING_GLUSRID'
    };
  }

  storeGlusrid(glusrid);

  const payload = {
    LocPref: '4',
    stateid: '',
    city: '',
    iso: '',
    pref_city_lead: 0,
    glusrid,
    inbox: '',
    offer: '',
    offer_type: 'B',
    start: 1,
    end: 20,
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
  };

  try {
    const response = await fetch('/blreact/getBLDisplayData', {
      method: 'POST',
      credentials: 'include', // Critical: reuses session cookies
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}`,
        code: response.status
      };
    }

    const data = await response.json();

    if (data.CODE === '200' && data.STATUS === 'Success') {
      if (data.glusrid) {
        storeGlusrid(data.glusrid);
      }
      return {
        success: true,
        lead_count: data.DisplayList ? data.DisplayList.length : 0,
        total_leads: data.Allcount,
        code: data.CODE,
        timestamp: new Date().toISOString()
      };
    } else {
      return {
        success: false,
        error: data.Msg || 'Unknown API error',
        code: data.CODE,
        timestamp: new Date().toISOString()
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      code: null
    };
  }
}

// Run redirect on load
handleInitialRedirect();

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetch_bldisplaydata') {
    callGetBLDisplayData().then(sendResponse);
    return true; // async response
  }
});

console.log('IndiaMart Buy Leads - Content Script loaded');
