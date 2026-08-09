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

// True if `values` (a sheet's A1:I1 row) is exactly SHEET_HEADER_ROW, in
// order — extra columns past I are ignored since writes only ever touch
// A:I, so an unrelated trailing column (e.g. "Notes") is harmless.
export function headerMatchesExpected(values: unknown[] | undefined | null): boolean {
  if (!values) return false;
  return SHEET_HEADER_ROW.every((expected, i) => values[i] === expected);
}

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
