// Value parsers for raw IndiaMART lead fields. Pure functions — no DOM, no
// globals — so the same code runs in the panel bundle and, inlined, inside the
// page-injected helper (window.__im_utils) via the inject build.

export function parsePrice(v: unknown): number | null {
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

export function parseTimeToMinutes(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).toLowerCase().replace(/[()]/g, '').trim();
  if (s.includes('yesterday')) return 1440;
  if (s.includes('hr') || s.includes('hrs')) {
    const n = parseFloat(s.match(/(\d+(?:\.\d+)?)/)?.[0] ?? '');
    return isNaN(n) ? null : Math.round(n * 60);
  }
  if (s.includes('min') || s.includes('mins')) {
    const n = parseFloat(s.match(/(\d+(?:\.\d+)?)/)?.[0] ?? '');
    return isNaN(n) ? null : Math.round(n);
  }
  if (s.includes('sec') || s.includes('secs')) return 0;
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[0]) : null;
}

export function parseQuantity(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).replace(/ /g, ' ').trim();
  const m = s.match(/(\d[\d,.]*)/);
  if (!m) return null;
  const numStr = m[1].replace(/,/g, '');
  const n = parseFloat(numStr);
  return isNaN(n) ? null : Math.round(n);
}
