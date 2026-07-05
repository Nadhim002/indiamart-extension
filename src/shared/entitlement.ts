// Client-side entitlement check. The account-centric schema stores the source
// of truth at accounts/{sanitizedEmail}/subscription; this module reads it and
// decides whether the signed-in user may run the product.
//
// Enforcement is deliberately client-side (see the ADR): the extension runs in
// the seller's own browser session, so there is no server to proxy through.
// Firebase security rules keep the subscription read-only to the user and
// writable only by the admin, which stops casual abuse.
//
// Reads use the RTDB REST API so this works unchanged in BOTH the panel and the
// service worker (the worker has no firebase/database SDK). The panel also
// subscribes live via onValue for instant lock/unlock — see App.tsx.
//
// NOTE: the admin email grants dashboard management only, NOT product access, so
// there is intentionally no admin bypass here — the admin must be onboarded like
// any other user to run the extension.

import { FIREBASE_CONFIG } from '@shared/firebaseConfig';
import { sanitizeEmail } from '@shared/email';
import type { Entitlement, Subscription } from '@shared/types';

const CACHE_KEY = 'entitlementCache';
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CachedEntitlement {
  entitlement: Entitlement;
  checkedAt: number;
  email: string; // guard: a different signed-in account must not reuse this
}

// Pure: turn a subscription record (or null) into an entitlement verdict.
// Tier is just a label — validity is purely "record exists and not expired".
export function evaluateSubscription(sub: Subscription | null, now: number): Entitlement {
  if (!sub || typeof sub.expiryDate !== 'number') {
    return { valid: false, reason: 'no-account' };
  }
  const fields = {
    tier: sub.tier,
    expiryDate: sub.expiryDate,
    maxComputers: sub.maxComputers,
    maxPhones: sub.maxPhones,
  };
  if (sub.expiryDate <= now) {
    return { valid: false, reason: 'expired', ...fields };
  }
  return { valid: true, reason: 'ok', ...fields };
}

// Point-read of a subscription via RTDB REST. Requires the Firebase ID token.
export async function fetchSubscription(email: string, idToken: string): Promise<Subscription | null> {
  const DB_URL = FIREBASE_CONFIG.databaseURL;
  const key = sanitizeEmail(email);
  const res = await fetch(`${DB_URL}/accounts/${key}/subscription.json?auth=${idToken}`);
  if (!res.ok) throw new Error(`subscription fetch failed: ${res.status}`);
  return (await res.json()) as Subscription | null;
}

function readCache(): Promise<CachedEntitlement | null> {
  return new Promise((resolve) =>
    chrome.storage.local.get([CACHE_KEY], (r) => resolve((r[CACHE_KEY] as CachedEntitlement) ?? null))
  );
}

function writeCache(value: CachedEntitlement): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set({ [CACHE_KEY]: value }, () => resolve()));
}

export function clearEntitlementCache(): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.remove([CACHE_KEY], () => resolve()));
}

// Write a fresh verdict into the shared cache. Called by the panel's live
// onValue subscription so the service worker's cached reads stay current.
export function cacheEntitlement(email: string, entitlement: Entitlement): Promise<void> {
  return writeCache({ entitlement, checkedAt: Date.now(), email });
}

// Cached entitlement check. Serves cache within CACHE_TTL_MS; otherwise
// re-validates against Firebase. On a rare transient network error, falls back
// to the last-known cache for the same account (we assume Firebase is up).
export async function getEntitlement(
  email: string,
  idToken: string,
  opts: { force?: boolean } = {}
): Promise<Entitlement> {
  const now = Date.now();
  const cached = await readCache();
  const cacheFresh = cached && cached.email === email && now - cached.checkedAt < CACHE_TTL_MS;
  if (!opts.force && cacheFresh) {
    return cached!.entitlement;
  }
  try {
    const sub = await fetchSubscription(email, idToken);
    const entitlement = evaluateSubscription(sub, now);
    await writeCache({ entitlement, checkedAt: now, email });
    return entitlement;
  } catch (e) {
    if (cached && cached.email === email) return cached.entitlement;
    throw e;
  }
}
