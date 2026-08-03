// The Google Sheets row shape for a purchased lead — single source of truth,
// mirroring pushPayload.ts. Built identically by the service worker
// (production writes) and the panel's test-notification button, so the
// header row and the appended rows can never drift out of column order.

export const SHEET_HEADER_ROW = [
  'Lead Bought Date',
  'Lead Bought Time',
  'Title',
  'Price',
  'Qty',
  'Buyer Mobile',
  'Buyer Name',
  'City',
  'State',
];

export interface PurchasedLead {
  boughtDate?: string | null;
  boughtTime?: string | null;
  ETO_OFR_TITLE?: string | null;
  ETO_OFR_APPROX_ORDER_VALUE?: string | number | null;
  quantity?: string | number | null;
  buyerMobile?: string | null;
  buyerName?: string | null;
  GLUSR_CITY?: string | null;
  GLUSR_STATE?: string | null;
}

export function buildSheetRow(lead: PurchasedLead): (string | number)[] {
  return [
    lead.boughtDate ?? '',
    lead.boughtTime ?? '',
    lead.ETO_OFR_TITLE ?? '',
    lead.ETO_OFR_APPROX_ORDER_VALUE ?? '',
    lead.quantity ?? '',
    lead.buyerMobile ?? '',
    lead.buyerName ?? '',
    lead.GLUSR_CITY ?? '',
    lead.GLUSR_STATE ?? '',
  ];
}

// Extracts the spreadsheet ID out of a normal Google Sheets URL, e.g.
// https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0 → <ID>.
export function parseSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}
