// Content Script - Runs on seller.indiamart.com and calls APIs

// Utility: Extract glusrid from page context
function extractGlusrid() {
  // Try to extract from page globals or window object
  if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.glusrid) {
    return window.__INITIAL_STATE__.glusrid;
  }

  // Try to find from analytics window object
  if (window.gtag && window.gtag.getClientID) {
    // Not ideal, but check if embedded in dataLayer
  }

  // Try to extract from page HTML (seller profile section)
  const sellerIdElement = document.querySelector('[data-glusrid]');
  if (sellerIdElement) {
    return sellerIdElement.getAttribute('data-glusrid');
  }

  // Try to get from localStorage (IndiaMart stores seller data)
  const localStorageData = localStorage.getItem('sellerData');
  if (localStorageData) {
    try {
      const parsed = JSON.parse(localStorageData);
      if (parsed.glusrid) return parsed.glusrid;
    } catch (e) {
      // ignore parse error
    }
  }

  // Last resort: look for it in page URL or meta tags
  const sellerName = document.querySelector('meta[name="seller-id"]');
  if (sellerName) {
    return sellerName.getAttribute('content');
  }

  return null;
}

// Call getBLDisplayData API
async function callGetBLDisplayData() {
  const glusrid = extractGlusrid();

  if (!glusrid) {
    return {
      success: false,
      error: 'Could not identify seller (glusrid)',
      code: null
    };
  }

  const payload = {
    LocPref: '4',
    stateid: '',
    city: '',
    iso: '',
    pref_city_lead: 0,
    glusrid: glusrid,
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

    // Check response structure
    if (data.CODE === '200' && data.STATUS === 'Success') {
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

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetch_bldisplaydata') {
    callGetBLDisplayData().then(sendResponse);
    return true; // async response
  }
});

console.log('IndiaMart Buy Leads - Content Script loaded');
