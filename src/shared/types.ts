// Domain types shared across the panel bundle, the service worker, and the
// page-injected helper. Panel-only view types stay in src/panel/types.

export interface LeadFilters {
  minPrice: number | null;
  minQuantity: number | null;
  minTimePassed: number | null;
  states: string[] | null;
  cities: string[] | null;
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
  GLUSR_CITY?: string | null;
  ETO_OFR_TITLE?: string | null;
}

// ---------------------------------------------------------------------------
// Entitlement / account model (account-centric schema under accounts/{email})
// ---------------------------------------------------------------------------

export type Tier = 'free' | 'paid';

// accounts/{sanitizedEmail}/profile
export interface AccountProfile {
  email: string;              // raw, un-sanitized
  uid?: string | null;        // stamped by ext/phone on first login
  businessName: string;
  gstNumber?: string | null;  // optional
}

// accounts/{sanitizedEmail}/subscription
export interface Subscription {
  tier: Tier;
  lastPaidDate?: number | null; // ms epoch; null for free/trial
  expiryDate: number;           // ms epoch; applies to both tiers
  maxComputers: number;
  maxPhones: number;
  createdAt: number;
  updatedAt: number;
}

// accounts/{sanitizedEmail}/computers/{installId}
export interface ComputerRecord {
  name: string;
  registeredAt: number;
  lastSeen: number;
}

// accounts/{sanitizedEmail}/phones/{deviceId}
export interface PhoneRecord {
  name?: string;
  fcmToken?: string;
  notificationStyle?: string;
  lastSeen?: number;
}

// Result of an entitlement check. `reason` is only meaningful when !valid.
export type EntitlementReason = 'ok' | 'no-account' | 'expired';

export interface Entitlement {
  valid: boolean;
  reason: EntitlementReason;
  tier?: Tier;
  expiryDate?: number;
  maxComputers?: number;
  maxPhones?: number;
}
