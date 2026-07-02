// The Lead acceptance policy — the single source of truth for which leads pass
// the filters and why. Previously this logic lived in three places: the
// page-injected `filterLeads`, the service worker's `computeRejectionReasons`,
// and the panel's mental model of the rules. Now filtering and rejection
// reasons are both derived from one function, so they can never disagree.
//
// `evaluateLead` returns the reasons a lead is rejected, in a stable order.
// Empty array = the lead passed. `filterLeads` and `rejectionReason` are thin
// views over it.

import type { EvaluableLead, LeadFilters } from './types';

export function evaluateLead(lead: EvaluableLead, filters: LeadFilters): string[] {
  const reasons: string[] = [];
  const { minPrice, minQuantity, minTimePassed, states, includeKeywords, excludeKeywords } = filters;

  // Price OR Quantity — the check only applies if at least one threshold is set.
  if (minPrice != null || minQuantity != null) {
    const priceOk = minPrice != null && lead.ETO_OFR_APPROX_ORDER_VALUE != null && lead.ETO_OFR_APPROX_ORDER_VALUE >= minPrice;
    const quantityOk = minQuantity != null && lead.quantity != null && lead.quantity >= minQuantity;
    if (!priceOk && !quantityOk) {
      if (minPrice != null) reasons.push('Price too low');
      if (minQuantity != null) reasons.push('Quantity too low');
    }
  }

  // Time passed — lead must have been posted within minTimePassed minutes.
  if (minTimePassed != null && minTimePassed > 0) {
    if (lead.BLDATETIME == null || lead.BLDATETIME > minTimePassed) {
      reasons.push('Lead too old');
    }
  }

  // State — lead's state must be in the selected list.
  if (states && states.length > 0) {
    if (!states.includes(lead.GLUSR_STATE ?? '')) {
      reasons.push('State not selected');
    }
  }

  // Title keywords — exclude is a hard veto; include requires at least one match.
  const title = (lead.ETO_OFR_TITLE || '').toLowerCase();
  if (excludeKeywords && excludeKeywords.length > 0) {
    if (excludeKeywords.some((kw) => title.includes(String(kw).toLowerCase()))) {
      reasons.push('Title excluded by keyword');
    }
  }
  if (includeKeywords && includeKeywords.length > 0) {
    if (!includeKeywords.some((kw) => title.includes(String(kw).toLowerCase()))) {
      reasons.push('Title keyword not matched');
    }
  }

  return reasons;
}

// Keep only the leads that pass every rule. With no filters, everything passes.
export function filterLeads<T extends EvaluableLead>(leads: T[], filters: LeadFilters | null): T[] {
  if (!filters) return leads;
  return leads.filter((lead) => evaluateLead(lead, filters).length === 0);
}

// Human-readable reason string for a single lead (used for the CSV export).
export function rejectionReason(lead: EvaluableLead, filters: LeadFilters | null): string {
  if (!filters) return 'No filters set';
  const reasons = evaluateLead(lead, filters);
  return reasons.length > 0 ? reasons.join(', ') : 'Passed filters';
}
