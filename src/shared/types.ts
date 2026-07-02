// Domain types shared across the panel bundle, the service worker, and the
// page-injected helper. Panel-only view types stay in src/panel/types.

export interface LeadFilters {
  minPrice: number | null;
  minQuantity: number | null;
  minTimePassed: number | null;
  states: string[] | null;
  includeKeywords: string[] | null;
  excludeKeywords: string[] | null;
}

// The subset of a mapped lead the acceptance policy reads. Mapped leads carry
// more fields; the policy only depends on these (all numeric post-parsing).
export interface EvaluableLead {
  ETO_OFR_APPROX_ORDER_VALUE?: number | null;
  quantity?: number | null;
  BLDATETIME?: number | null;
  GLUSR_STATE?: string | null;
  ETO_OFR_TITLE?: string | null;
}
