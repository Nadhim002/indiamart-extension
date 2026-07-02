import type { LeadRecord } from '@/types';

const HEADERS = [
  'Lead ID', 'Title', 'Price (₹)', 'Quantity', 'Age (min)', 'City', 'State',
  'Category ID', 'First Seen Date', 'First Seen Time', 'Reason',
  'Filter Min Price', 'Filter Min Qty', 'Filter Max Age (min)', 'Filter States',
  'Filter Include Kw', 'Filter Exclude Kw',
];

function escape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

// Pure: turns recorded leads into a CSV string. No DOM, no side effects — the
// caller handles fetching leads and triggering the download.
export function leadsToCsv(leads: LeadRecord[]): string {
  const rows = leads.map((l) =>
    [
      l.ETO_OFR_ID,
      l.ETO_OFR_TITLE,
      l.ETO_OFR_APPROX_ORDER_VALUE,
      l.quantity,
      l.BLDATETIME,
      l.GLUSR_CITY,
      l.GLUSR_STATE,
      l.FK_GLCAT_MCAT_ID,
      l.firstSeenDate,
      l.firstSeenTime,
      l.reasons,
      l.filtersAtFirstSeen?.minPrice,
      l.filtersAtFirstSeen?.minQuantity,
      l.filtersAtFirstSeen?.minTimePassed,
      l.filtersAtFirstSeen?.states?.join(' | '),
      l.filtersAtFirstSeen?.includeKeywords?.join(' | '),
      l.filtersAtFirstSeen?.excludeKeywords?.join(' | '),
    ]
      .map(escape)
      .join(',')
  );
  return [HEADERS.join(','), ...rows].join('\n');
}
