// The row shape for the "IndiaMART Lead History" spreadsheet — single source
// of truth, mirroring sheetsPayload.ts's pattern for purchased leads. Built
// identically by the service worker (Drive sync writes) and the panel's CSV
// exporter, so the two can never drift apart and a sheet header change is a
// one-file edit.
//
// This is every lead the extension has ever seen (matched, rejected, or
// bought) plus the filter snapshot active when it was first seen — not just
// purchases. GRID_PARAMETERS (an opaque IndiaMART re-purchase token) is
// deliberately excluded: it has no analytic value and shouldn't leave the
// machine.

export const LEAD_HISTORY_HEADER_ROW = [
  'Lead ID',
  'Title',
  'Price (₹)',
  'Quantity',
  'Age (min)',
  'City',
  'State',
  'Category ID',
  'First Seen Date',
  'First Seen Time',
  'First Seen (UTC)',
  'Reason',
  'Filter Min Price',
  'Filter Min Qty',
  'Filter Max Age (min)',
  'Filter States',
  'Filter Cities',
  'Filter Include Kw',
  'Filter Exclude Kw',
  'Device ID',
];

// True if `values` (a sheet's A1:T1 row) starts with LEAD_HISTORY_HEADER_ROW,
// in order — extra trailing columns are ignored, same convention as
// sheetsPayload.ts's headerMatchesExpected.
export function historyHeaderMatches(values: unknown[] | undefined | null): boolean {
  if (!values) return false;
  return LEAD_HISTORY_HEADER_ROW.every((expected, i) => values[i] === expected);
}

export interface LeadHistoryFiltersSnapshot {
  minPrice?: number | null;
  minQuantity?: number | null;
  minTimePassed?: number | null;
  stateCities?: Record<string, string[]> | null;
  /** @deprecated legacy shape, read-only — written by versions <= 1.5.0. */
  states?: string[] | null;
  /** @deprecated legacy shape, read-only — written by versions <= 1.5.0. */
  cities?: string[] | null;
  includeKeywords?: string[] | null;
  excludeKeywords?: string[] | null;
}

// Deliberately independent of the panel's LeadRecord type (like
// sheetsPayload.ts's PurchasedLead) so this module has no dependency on
// panel-only types and stays importable from the plain-JS service worker.
export interface LeadHistoryInput {
  ETO_OFR_ID: string | number;
  ETO_OFR_TITLE?: string | null;
  ETO_OFR_APPROX_ORDER_VALUE?: string | number | null;
  quantity?: string | number | null;
  BLDATETIME?: string | number | null;
  GLUSR_CITY?: string | null;
  GLUSR_STATE?: string | null;
  FK_GLCAT_MCAT_ID?: string | number | null;
  firstSeenDate?: string | null;
  firstSeenTime?: string | null;
  // Epoch ms, added in the IndexedDB v2 migration — absent on rows that
  // predate it and haven't been backfilled yet.
  firstSeenAtMs?: number | null;
  reasons?: string | null;
  filtersAtFirstSeen?: LeadHistoryFiltersSnapshot | null;
}

export function buildLeadHistoryRow(lead: LeadHistoryInput, deviceId: string): (string | number)[] {
  const f = lead.filtersAtFirstSeen;
  // Filter States / Filter Cities predate the state->city nesting and their
  // format is frozen (see historyHeaderMatches — an already-synced sheet's
  // header is never rewritten, only flagged as mismatched). A row from before
  // this change still carries the flat `states`/`cities` arrays, so fall back
  // to those; a new row derives the same two flat lists from `stateCities`.
  const sc = f?.stateCities;
  const filterStates = sc ? Object.keys(sc).join(' | ') : (f?.states?.join(' | ') ?? '');
  const filterCities = sc ? Object.values(sc).flat().join(' | ') : (f?.cities?.join(' | ') ?? '');
  return [
    lead.ETO_OFR_ID,
    lead.ETO_OFR_TITLE ?? '',
    lead.ETO_OFR_APPROX_ORDER_VALUE ?? '',
    lead.quantity ?? '',
    lead.BLDATETIME ?? '',
    lead.GLUSR_CITY ?? '',
    lead.GLUSR_STATE ?? '',
    lead.FK_GLCAT_MCAT_ID ?? '',
    lead.firstSeenDate ?? '',
    lead.firstSeenTime ?? '',
    typeof lead.firstSeenAtMs === 'number' ? new Date(lead.firstSeenAtMs).toISOString() : '',
    lead.reasons ?? '',
    f?.minPrice ?? '',
    f?.minQuantity ?? '',
    f?.minTimePassed ?? '',
    filterStates,
    filterCities,
    f?.includeKeywords?.join(' | ') ?? '',
    f?.excludeKeywords?.join(' | ') ?? '',
    deviceId,
  ];
}
