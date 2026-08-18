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
  const { minPrice, minQuantity, minTimePassed, stateCities, states, cities, includeKeywords, excludeKeywords } = filters;

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

  // Location — per-state scoping. `stateCities` maps each selected state to the
  // cities ticked under it; an empty array means "whole state". Unlike the old
  // two independent arrays, this shape makes an orphan city (one selected under
  // no selected state, so it matched nothing) structurally impossible. Options
  // are harvested from real leads (see knownCitiesByState in the worker), so
  // exact-match is safe: the user never types a city, so a spelling can never
  // diverge from IndiaMART's data.
  if (stateCities && Object.keys(stateCities).length > 0) {
    const scoped = stateCities[lead.GLUSR_STATE ?? ''];
    if (scoped === undefined) {
      reasons.push('State not selected');
    } else if (scoped.length > 0 && !scoped.includes(lead.GLUSR_CITY ?? '')) {
      reasons.push('City not selected');
    }
  } else if ((states && states.length > 0) || (cities && cities.length > 0)) {
    // Legacy payload — a persisted autoStartPayload written before this version
    // can auto-start the worker before the panel is ever opened (see
    // maybeAutoStart in the service worker). Apply the old independent-AND
    // rules so that one run behaves exactly as it did pre-update, rather than
    // silently dropping the location filter entirely. onInstalled rewrites the
    // payload, so this path is needed for at most one cycle.
    if (states && states.length > 0 && !states.includes(lead.GLUSR_STATE ?? '')) {
      reasons.push('State not selected');
    }
    if (cities && cities.length > 0 && !cities.includes(lead.GLUSR_CITY ?? '')) {
      reasons.push('City not selected');
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
