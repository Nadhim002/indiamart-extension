import { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';
import { getDatabase, ref, onValue } from 'firebase/database';
import { getFirebaseApp } from '@/lib/firebase';
import { sanitizeEmail } from '@shared/email';
import { evaluateSubscription, cacheEntitlement } from '@shared/entitlement';
import type { Entitlement, Subscription } from '@shared/types';

// Live entitlement for the signed-in user. Subscribes to the subscription node
// so admin changes lock/unlock the UI instantly, and mirrors each verdict into
// the shared chrome.storage.local cache that the service worker reads. Returns
// `null` while the first value is still loading.
export function useEntitlement(user: User | null): Entitlement | null {
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);

  useEffect(() => {
    setEntitlement(null);
    if (!user) return;
    const email = user.email;
    if (!email) {
      setEntitlement({ valid: false, reason: 'no-account' });
      return;
    }

    const db = getDatabase(getFirebaseApp());
    const subRef = ref(db, `accounts/${sanitizeEmail(email)}/subscription`);

    const unsub = onValue(
      subRef,
      (snap) => {
        const sub = (snap.val() ?? null) as Subscription | null;
        const ent = evaluateSubscription(sub, Date.now());
        setEntitlement(ent);
        void cacheEntitlement(email, ent);
      },
      () => {
        // Read error — keep any prior verdict; only fall back to locked if we
        // never had one (we assume Firebase is up, so this is rare).
        setEntitlement((prev) => prev ?? { valid: false, reason: 'no-account' });
      }
    );

    return () => unsub();
  }, [user]);

  return entitlement;
}
