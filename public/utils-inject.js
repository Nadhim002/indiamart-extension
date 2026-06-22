// Utilities injected into page context for parsing values.
// They attach a small namespace to `window` to avoid globals collisions.
(function () {
  if (window.__im_utils) return; // already injected

  function parsePrice(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    let s = String(v).toLowerCase().trim();
    s = s.replace(/[,₹$€£]/g, '').replace(/rs\.?/g, '').replace(/above|approx|around|more than|greater than|>/g, '').trim();
    const lakhMatch = s.match(/(\d+(?:\.\d+)?)\s*(lakh|lac)/);
    if (lakhMatch) return Math.round(parseFloat(lakhMatch[1]) * 100000);
    const kMatch = s.match(/(\d+(?:\.\d+)?)\s*(k|thousand)/);
    if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
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

  function parseQuantity(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Math.round(v);
    let s = String(v).replace(/\u00A0/g, ' ').trim();
    const m = s.match(/(\d[\d,\.]*)/);
    if (!m) return null;
    const numStr = m[1].replace(/,/g, '');
    const n = parseFloat(numStr);
    return isNaN(n) ? null : Math.round(n);
  }

  function filterLeads(leads, filters) {
    if (!filters) return leads;
    const { minPrice, minQuantity, minTimePassed, states } = filters;

    return leads.filter((lead) => {
      // Price OR Quantity — skip this check if neither threshold is configured
      if (minPrice != null || minQuantity != null) {
        const priceOk = minPrice != null && lead.ETO_OFR_APPROX_ORDER_VALUE != null && lead.ETO_OFR_APPROX_ORDER_VALUE >= minPrice;
        const quantityOk = minQuantity != null && lead.quantity != null && lead.quantity >= minQuantity;
        if (!priceOk && !quantityOk) return false;
      }

      // Time passed — lead must have been posted within minTimePassed minutes
      if (minTimePassed != null && minTimePassed > 0) {
        if (lead.BLDATETIME == null || lead.BLDATETIME > minTimePassed) return false;
      }

      // State — lead's state must be in the selected list
      if (states && states.length > 0) {
        if (!states.includes(lead.GLUSR_STATE)) return false;
      }

      return true;
    });
  }

  window.__im_utils = { parsePrice, parseTimeToMinutes, parseQuantity, filterLeads };
})();
